import { LoadingKpis, LoadingPanel, Spinner } from "@/components/ui";

/** Shown while the campaign itself is being fetched, before any of its figures are asked for. */
export default function Loading() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="h-4 w-28 animate-pulse rounded bg-surface-alt" />
        <span className="flex items-center gap-3">
          <span className="h-9 w-48 animate-pulse rounded bg-surface-alt" />
          <Spinner label="Loading the campaign" />
        </span>
      </div>
      <LoadingKpis />
      <LoadingPanel title="Outcomes" lines={4} />
      <LoadingPanel title="Leads" lines={4} />
    </>
  );
}
