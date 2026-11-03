/** Only pages already split into lazy chunks need code preloading. */
export function preloadDestination(to: string) {
  if (to === "/settings") return import("@/routes/system");
  if (to === "/downloads") return import("@/routes/downloads");
  return Promise.resolve();
}
