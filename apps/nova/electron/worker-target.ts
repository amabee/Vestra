import { resolve } from "node:path";

export function resolveWorkerTarget(options: {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform: string;
  arch: string;
  dllOverride?: string;
}): string {
  if (options.packaged) {
    if (options.platform !== "win32" || options.arch !== "x64")
      throw new Error("The bundled C# worker currently supports Windows x64.");
    // Installed applications always use their own worker, never a development override.
    return resolve(options.resourcesPath, "server", "Vestra.Server.exe");
  }
  return (
    options.dllOverride ??
    resolve(options.appPath, "../server/bin/Release/net10.0/Vestra.Server.dll")
  );
}
