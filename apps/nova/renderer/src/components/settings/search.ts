import { createContext, useContext } from "react";
export const SettingsSearchContext = createContext("");
export function useSettingMatch(label: string, description = "") {
  const search = useContext(SettingsSearchContext).trim().toLowerCase();
  return !search || `${label} ${description}`.toLowerCase().includes(search);
}
