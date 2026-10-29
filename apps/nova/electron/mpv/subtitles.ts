import type { RemotePlayback } from "../remote-playback";
type Connection = {
  command(...args: unknown[]): Promise<unknown>;
  getProperty<T>(name: string): Promise<T>;
};

/** Track metadata is attached only after its own video file has loaded. */
export class ExternalSubtitleLoader {
  private generation = 0;
  private pending: {
    path: string;
    tracks: RemotePlayback["subtitles"];
  } | null = null;
  begin(path: string, tracks: RemotePlayback["subtitles"] = []): number {
    this.generation++;
    this.pending = { path, tracks };
    return this.generation;
  }
  current(generation: number): boolean {
    return generation === this.generation;
  }
  get revision(): number {
    return this.generation;
  }
  cancel(): void {
    this.generation++;
    this.pending = null;
  }
  async attach(connection: Connection): Promise<string[]> {
    const pending = this.pending;
    const generation = this.generation;
    if (!pending?.tracks.length) return [];
    const path = await connection.getProperty<string>("path");
    if (!this.current(generation) || path !== pending.path) return [];
    this.pending = null;
    const unique = new Map<string, RemotePlayback["subtitles"][number]>();
    for (const track of [...pending.tracks].sort(
      (a, b) => Number(!!b.isDefault) - Number(!!a.isDefault),
    ))
      if (!unique.has(track.url)) unique.set(track.url, track);
    const tracks = [...unique.values()];
    const preferred = tracks.find((track) => track.isDefault);
    const ordered = [
      ...tracks.filter((track) => track !== preferred),
      ...(preferred ? [preferred] : []),
    ];
    const errors: string[] = [];
    for (const track of ordered) {
      if (!this.current(generation)) return [];
      try {
        await connection.command(
          "sub-add",
          track.url,
          track === preferred ? "select" : "auto",
          track.title || track.language,
          track.language,
        );
      } catch {
        if (this.current(generation))
          errors.push(
            `Could not load subtitle: ${track.title || track.language}.`,
          );
      }
    }
    return this.current(generation) ? errors : [];
  }
}
