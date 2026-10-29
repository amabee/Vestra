import { createRequire } from "node:module";

/** Trusted compiler only; provider code is transformed, never imported into Node. */
export function transpileProvider(source: string, filename: string): string {
  if (!/\.tsx?$/i.test(filename)) return source;
  const ts = createRequire(__filename)(
    "typescript",
  ) as typeof import("typescript");
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
