import { settingsPatchSchema, type Settings } from "@vestra/types";
import { getSettings, saveSettings, type StorageDriver } from "@vestra/storage";
/** One queue for patches and trusted folder mutations, including broadcasts. */
export function createSettingsPatcher(
  driver: StorageDriver,
  changed: (value: Settings) => void = () => {},
) {
  let queue = Promise.resolve();
  const transform = (
    apply: (current: Settings) => Settings,
  ): Promise<Settings> => {
    const result = queue.then(async () => {
      const saved = await saveSettings(
        driver,
        apply(await getSettings(driver)),
      );
      changed(saved);
      return saved;
    });
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const patch = (raw: unknown): Promise<Settings> => {
    const value = settingsPatchSchema.parse(raw);
    return transform((current) => {
      const next = { ...current };
      for (const section of Object.keys(value) as (keyof typeof value)[])
        Object.assign(next, {
          [section]: { ...current[section], ...value[section] },
        });
      return next;
    });
  };
  return Object.assign(patch, { transform });
}
