import Link from "next/link";
import { describeAgendaKind, type AgendaEntry } from "@/lib/student-today";
import { getUnifiedItemColor } from "@/lib/utils/unifiedItemUtils";
import { cn } from "@/lib/utils";
import { LEDGER_ROW_CLASS } from "./HomeSection";
import { WithinPageLink } from "./WithinPageLink";

const ROW_VARIANT_CLASS = {
  // 오늘: 44px(좁은 화면 48px) 행과 아래 선
  today: cn(LEDGER_ROW_CLASS, "min-h-12 py-2.5 md:h-11 md:min-h-0 md:py-0 md:px-1"),
  // 다가오는 일정: 선 없는 40px 행(좁은 화면은 터치 높이 48px)
  upcoming: "min-h-12 py-2.5 md:h-10 md:min-h-0 md:py-0 text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-sidebar focus-visible:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none md:px-1",
} as const;

/** 일정 한 줄: 시각 · 유형 색 점 · 제목 · 유형 이름. 노트는 문서로, 일정은 캘린더로 연결한다. */
export function AgendaRow({
  entry,
  when,
  calendarHref,
  returnTo,
  variant = "today",
}: {
  entry: AgendaEntry;
  when: string;
  calendarHref: string;
  returnTo: string;
  variant?: keyof typeof ROW_VARIANT_CLASS;
}) {
  const { item } = entry;
  const kind = describeAgendaKind(item);
  const title = item.title || "제목 없음";
  // 좁은 화면(B 묶음 ⑥): 제목은 두 줄까지, 종류는 시각 아래로 옮겨 제목 폭을 넓힌다. 넓은 화면은 한 줄 그대로.
  const className = cn("flex min-w-0 items-start gap-3 md:items-center", ROW_VARIANT_CLASS[variant]);
  const content = (
    <>
      <span className="flex w-10 shrink-0 flex-col gap-0.5 md:w-11">
        <span className="font-mono text-xs leading-[22px] tabular-nums text-muted-foreground md:leading-normal">{when}</span>
        <span className="truncate text-[11px] leading-4 text-muted-foreground md:hidden">{kind}</span>
      </span>
      <span
        className="mt-2 size-1.5 shrink-0 rounded-full md:mt-0"
        style={{ backgroundColor: getUnifiedItemColor(item) }}
        aria-hidden="true"
      />
      <span className={cn("line-clamp-2 min-w-0 flex-1 md:line-clamp-none md:truncate", variant === "today" ? "text-md leading-[22px] md:text-body md:leading-normal" : "text-body leading-[22px] md:leading-normal")}>{title}</span>
      <span className="hidden max-w-[9rem] shrink-0 truncate text-xs text-muted-foreground md:inline">{kind}</span>
    </>
  );

  if (item.type === "NOTE") {
    return (
      <Link
        href={`/dashboard/notes/${encodeURIComponent(item.id)}?returnTo=${encodeURIComponent(returnTo)}`}
        className={className}
      >
        {content}
      </Link>
    );
  }
  return (
    <WithinPageLink href={calendarHref} className={className} aria-label={`${title}, ${kind}, ${when} — 캘린더에서 보기`}>
      {content}
    </WithinPageLink>
  );
}
