import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Trusted compiler only; provider code is transformed, never imported into Node. */
export function transpileProvider(source: string, filename: string): string {
  if (!/\.tsx?$/i.test(filename)) return source;
  const bundled = join(__dirname, "provider-typescript.cjs");
  let ts: typeof import("typescript");
  try {
    ts = createRequire(__filename)(
      existsSync(bundled) ? bundled : "typescript",
    ) as typeof import("typescript");
  } catch {
    throw new Error(
      "The TypeScript provider compiler is missing. Rebuild or reinstall Vestra.",
    );
  }
  const result = ts.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
    },
  });
  const errors =
    result.diagnostics?.filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    ) ?? [];
  if (errors.length)
    throw new Error(
      ts.flattenDiagnosticMessageText(errors[0]!.messageText, "\n"),
    );
  // Global Provider scripts only: module imports cannot be resolved by this runtime.
  if (/^\s*(?:import\s|export\s)/m.test(result.outputText))
    throw new Error(
      "Provider modules/imports are unsupported; supply a global Provider class.",
    );
  return result.outputText;
}
