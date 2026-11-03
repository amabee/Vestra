import { z } from "zod";
import {
  listChangeSchema,
  remoteEntryFields,
  remoteListEntrySchema,
  syncStateSchema,
  type AniListChange,
} from "../shared/anilist-sync";

export type ListSyncState = z.infer<typeof syncStateSchema>;
type Query = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<unknown>;
export const changeKey = (
  change: Pick<AniListChange, "type" | "source" | "sourceId">,
) => JSON.stringify([change.type, change.source, change.sourceId]);
const normalise = (title: string) =>
  title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Mutations only send fields owned by this action. Scores, notes, privacy and custom lists stay intact. */
export async function applyListChange(change: AniListChange, query: Query) {
  let mediaId = change.mediaId;
  if (!mediaId) {
    if (!change.title.trim()) return null;
    const found = z
      .object({
        Page: z.object({
          media: z
            .array(
              z.object({
                id: z.number().int().positive(),
                title: z.object({
                  english: z.string().nullish(),
                  romaji: z.string().nullish(),
                  native: z.string().nullish(),
                }),
                synonyms: z.array(z.string()).nullish(),
                seasonYear: z.number().int().nullish(),
              }),
            )
            .max(10),
        }),
      })
      .parse(
        await query(
          `query VestraSyncMatch($search:String!,$type:MediaType!) { Page(page:1,perPage:10) { media(search:$search,type:$type) { id title { english romaji native } synonyms seasonYear } } }`,
          { search: change.title, type: change.type },
        ),
      );
    const matches = found.Page.media.filter(
      (row) =>
        (!change.year || row.seasonYear === change.year) &&
        [...Object.values(row.title), ...(row.synonyms ?? [])].some(
          (title) => title && normalise(title) === normalise(change.title),
        ),
    );
    if (matches.length !== 1) return null;
    mediaId = matches[0]!.id;
  }
  const { Media: media } = z
    .object({
      Media: z.object({
        id: z.number().int().positive(),
        type: z.enum(["ANIME", "MANGA"]),
        episodes: z.number().int().nullable(),
        chapters: z.number().int().nullable(),
        mediaListEntry: remoteListEntrySchema.nullable(),
      }),
    })
    .parse(
      await query(
        `query VestraSyncEntry($id:Int!,$type:MediaType!) { Media(id:$id,type:$type) { id type episodes chapters mediaListEntry { ${remoteEntryFields} } } }`,
        { id: mediaId, type: change.type },
      ),
    );
  if (media.id !== mediaId || media.type !== change.type)
    throw Error("AniList returned a different title.");
  const entry = media.mediaListEntry;
  if (change.action === "remove") {
    if (entry) {
      const deleted = z
        .object({ DeleteMediaListEntry: z.object({ deleted: z.boolean() }) })
        .parse(
          await query(
            `mutation VestraSyncRemove($id:Int!) { DeleteMediaListEntry(id:$id) { deleted } }`,
            { id: entry.id },
          ),
        );
      if (!deleted.DeleteMediaListEntry.deleted)
        throw Error("AniList did not remove this list entry.");
    }
    return { mediaId, entry: null };
  }
  const variables: Record<string, unknown> = { mediaId };
  if (change.action === "ensure") {
    if (!entry) variables.status = change.status ?? "PLANNING";
  } else if (change.action === "status") {
    variables.status = change.status;
    if (change.progress !== undefined) variables.progress = change.progress;
    else if (change.status === "COMPLETED") {
      const total = change.type === "ANIME" ? media.episodes : media.chapters;
      if (total !== null)
        variables.progress = Math.max(total, entry?.progress ?? 0);
    }
  } else {
    const progress = Math.max(entry?.progress ?? 0, change.progress ?? 0);
    if (progress !== entry?.progress) variables.progress = progress;
    const total = change.type === "ANIME" ? media.episodes : media.chapters;
    const status =
      total && progress >= total
        ? "COMPLETED"
        : entry && ["COMPLETED", "REPEATING"].includes(entry.status)
          ? entry.status
          : "CURRENT";
    if (status !== entry?.status) variables.status = status;
  }
  if (variables.status === "COMPLETED" && variables.progress === undefined) {
    const total = change.type === "ANIME" ? media.episodes : media.chapters;
    if (total !== null)
      variables.progress = Math.max(total, entry?.progress ?? 0);
  }
  if (
    entry &&
    (variables.status === undefined || variables.status === entry.status) &&
    (variables.progress === undefined || variables.progress === entry.progress)
  )
    return { mediaId, entry };
  const result = z
    .object({ SaveMediaListEntry: remoteListEntrySchema })
    .parse(
      await query(
        `mutation VestraSyncSave($mediaId:Int!,$status:MediaListStatus,$progress:Int) { SaveMediaListEntry(mediaId:$mediaId,status:$status,progress:$progress) { ${remoteEntryFields} } }`,
        variables,
      ),
    );
  if (
    result.SaveMediaListEntry.mediaId !== mediaId ||
    result.SaveMediaListEntry.media.type !== change.type
  )
    throw Error("AniList returned a different list entry.");
  return { mediaId, entry: result.SaveMediaListEntry };
}

export async function fetchListMirror(query: Query, userId: number) {
  const entries = new Map<number, z.infer<typeof remoteListEntrySchema>>();
  for (const type of ["ANIME", "MANGA"]) {
    let complete = false;
    for (let page = 1; page <= 1000; page++) {
      const data = z
        .object({
          Page: z.object({
            pageInfo: z.object({ hasNextPage: z.boolean() }),
            mediaList: z.array(remoteListEntrySchema).max(50),
          }),
        })
        .parse(
          await query(
            `query VestraSyncLists($userId:Int!,$type:MediaType!,$page:Int!) { Page(page:$page,perPage:50) { pageInfo { hasNextPage } mediaList(userId:$userId,type:$type,sort:MEDIA_ID) { ${remoteEntryFields} } } }`,
            { userId, type, page },
          ),
        );
      for (const entry of data.Page.mediaList) {
        if (entry.media.type !== type)
          throw Error("AniList returned an invalid list type.");
        entries.set(entry.mediaId, entry);
      }
      if (!data.Page.pageInfo.hasNextPage) {
        complete = true;
        break;
      }
    }
    if (!complete)
      throw Error(
        "AniList list exceeds the supported sync size. Previous lists were kept.",
      );
  }
  return [...entries.values()];
}

export function appendListChange(
  state: ListSyncState,
  raw: AniListChange,
): ListSyncState {
  const change = listChangeSchema.parse(raw);
  const key = changeKey(change);
  const prior = state.pending.find((row) => changeKey(row) === key);
  if (change.action === "progress" && prior?.action === "remove") return state;
  if (change.action === "progress" && prior?.action === "status") {
    change.action = "status";
    change.status = prior.status;
    change.progress = Math.max(change.progress ?? 0, prior.progress ?? 0);
  }
  if (!change.title && prior) change.title = prior.title;
  if (prior?.action === "progress" && change.action === "progress")
    change.progress = Math.max(prior.progress ?? 0, change.progress ?? 0);
  if (
    change.action === "status" &&
    change.progress === undefined &&
    prior?.action === "progress"
  )
    change.progress = prior.progress;
  // Saving a playlist must never replace a pending explicit status/progress update.
  if (change.action === "ensure" && prior && prior.action !== "remove")
    return state;
  const pending = state.pending.filter((row) => changeKey(row) !== key);
  if (pending.length >= 1000)
    throw Error("AniList sync queue is full. Sync pending changes first.");
  return { ...state, pending: [...pending, change] };
}
