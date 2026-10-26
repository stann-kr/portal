import Link from "next/link";
import { describeAgendaKind, type AgendaEntry } from "@/lib/student-today";
import { getUnifiedItemColor } from "@/lib/utils/unifiedItemUtils";
import { cn } from "@/lib/utils";
import { LEDGER_ROW_CLASS } from "./HomeSection";
import { WithinPageLink } from "./WithinPageLink";

const ROW_VARIANT_CLASS = {
  // 오늘: 44px(좁은 화면 48px) 행과 아래 선
  today: cn(LEDGER_ROW_CLASS, "h-12 md:h-11 md:px-1"),
  // 다가오는 일정: 선 없는 40px 행(좁은 화면은 터치 높이 48px)
  upcoming: "h-12 md:h-10 text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-sidebar focus-visible:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none md:px-1",
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
  const className = cn("flex min-w-0 items-center gap-3", ROW_VARIANT_CLASS[variant]);
  const content = (
    <>
      <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-muted-foreground md:w-11">{when}</span>
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: getUnifiedItemColor(item) }}
        aria-hidden="true"
      />
      <span className={cn("min-w-0 flex-1 truncate", variant === "today" ? "text-md md:text-body" : "text-body")}>{title}</span>
      <span className="max-w-[9rem] shrink-0 truncate text-xs text-muted-foreground">{kind}</span>
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
