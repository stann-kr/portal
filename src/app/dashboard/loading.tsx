export default function DashboardLoading() {
  return (
    <div aria-label="포털 불러오는 중" aria-busy="true" className="min-h-[100dvh]">
      <div className="h-14 border-b border-border bg-background" />
      <div className="mx-auto max-w-[1180px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-3">
          <div className="h-4 w-28 animate-pulse rounded-sm bg-muted" />
          <div className="h-8 w-64 max-w-full animate-pulse rounded-md bg-muted" />
        </div>
        <div className="h-44 animate-pulse rounded-lg border border-border bg-surface" />
        <div className="grid gap-8 md:grid-cols-2">
          <div className="h-56 animate-pulse rounded-lg border border-border bg-surface" />
          <div className="h-56 animate-pulse rounded-lg border border-border bg-surface" />
        </div>
      </div>
      <span className="sr-only" role="status">포털 데이터를 불러오고 있습니다.</span>
    </div>
  );
}
