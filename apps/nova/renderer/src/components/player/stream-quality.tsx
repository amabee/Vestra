import { useMutation } from "@tanstack/react-query";
import { bridge } from "@/lib/bridge";

export function StreamQuality({
  locator,
  busy,
  onSelect,
}: {
  locator: string;
  busy: boolean;
  onSelect: (choice: string) => void;
}) {
  const choices = useMutation({
    mutationFn: () => bridge.media.streamQualities(locator),
  });
  if (!locator.startsWith("vestra-stream://")) return null;
  return (
    <details className="relative text-xs">
      <summary
        className="cursor-pointer rounded-field border rule px-3 py-1.5"
        onClick={() => {
          if (!choices.data && !choices.isPending && !busy) choices.mutate();
        }}
      >
        Quality
      </summary>
      <div className="absolute right-0 top-full z-30 mt-2 grid w-72 max-w-[80vw] gap-2 rounded-lg border rule bg-base-100 p-3 shadow-xl">
        {choices.isPending && <p role="status">Resolving qualities…</p>}
        {choices.error && (
          <p role="alert">
            {choices.error.message}{" "}
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => choices.mutate()}
            >
              Retry
            </button>
          </p>
        )}
        {choices.data?.map((choice) => (
          <button
            key={choice.locator}
            type="button"
            className="btn btn-sm justify-start text-left"
            disabled={busy || choices.isPending}
            onClick={() => onSelect(choice.locator)}
          >
            {choice.label}
          </button>
        ))}
        {choices.data?.length === 0 && <p>No renditions are available.</p>}
        {choices.data && (
          <button
            className="btn btn-xs"
            type="button"
            disabled={busy || choices.isPending}
            onClick={() => choices.mutate()}
          >
            Refresh qualities
          </button>
        )}
      </div>
    </details>
  );
}
