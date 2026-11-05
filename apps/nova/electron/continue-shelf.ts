import type { StorageDriver } from "@vestra/storage";
import {
  continueDismissalsSchema,
  continueKey,
  type ContinueDismissals,
  type ContinueTarget,
} from "../shared/continue-shelf";

/** Dismissal is local presentation state; progress/history and AniList are untouched. */
export class ContinueShelf {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private driver: StorageDriver,
    private now = () => Date.now(),
  ) {}
  async list(): Promise<ContinueDismissals> {
    await this.writes;
    const value = await this.driver.read("continue-shelf-dismissals-v1");
    return value == null ? {} : continueDismissalsSchema.parse(value);
  }
  change(
    target: ContinueTarget,
    dismiss: boolean,
  ): Promise<ContinueDismissals> {
    const work = this.writes.then(async () => {
      const value = await this.driver.read("continue-shelf-dismissals-v1");
      const rows = value == null ? {} : continueDismissalsSchema.parse(value);
      const key = continueKey(target);
      if (!dismiss && !Object.hasOwn(rows, key)) return rows;
      if (dismiss) rows[key] = this.now();
      else delete rows[key];
      const bounded = Object.fromEntries(
        Object.entries(rows)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2000),
      );
      await this.driver.write("continue-shelf-dismissals-v1", bounded);
      return bounded;
    });
    this.writes = work.catch(() => undefined);
    return work;
  }
}

const shelves = new WeakMap<StorageDriver, ContinueShelf>();
export function getContinueShelf(driver: StorageDriver) {
  let shelf = shelves.get(driver);
  if (!shelf) {
    shelf = new ContinueShelf(driver);
    shelves.set(driver, shelf);
  }
  return shelf;
}
