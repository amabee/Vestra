import { settingsPatchSchema, type Settings } from "@vestra/types";
import { getSettings, saveSettings, type StorageDriver } from "@vestra/storage";
/** Serialize read/merge/write so rapid controls and multiple windows cannot lose patches. */
export function createSettingsPatcher(
  driver: StorageDriver,
  changed: (value: Settings) => void = () => {},
) {
  let queue = Promise.resolve();
  return (raw: unknown): Promise<Settings> => {
    const patch = settingsPatchSchema.parse(raw);
    const result = queue.then(async () => {
      const current = await getSettings(driver);
      const next = { ...current };
      for (const section of Object.keys(patch) as (keyof typeof patch)[]) {
        Object.assign(next, {
          [section]: { ...current[section], ...patch[section] },
        });
      }
      const saved = await saveSettings(driver, next);
      changed(saved);
      return saved;
    });
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
