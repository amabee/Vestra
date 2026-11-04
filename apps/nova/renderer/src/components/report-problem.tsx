import { useState } from "react";
import { bridge } from "@/lib/bridge";
import {
  problemReportUrl,
  type ProblemReportContext,
} from "@/lib/problem-report";

export function ReportProblem(context: ProblemReportContext) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        title="Open a GitHub issue draft with the app version, source and public error code. Review it before submitting."
        onClick={async () => {
          setPending(true);
          setFailed(false);
          try {
            const version = await bridge.app.version();
            await bridge.shell.openExternal(
              problemReportUrl(context, version, bridge.platform()),
            );
          } catch {
            setFailed(true);
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Opening report…" : "Report problem"}
      </button>
      {failed && (
        <span role="alert" className="text-sm">
          Could not open GitHub. Try again.
        </span>
      )}
    </span>
  );
}
