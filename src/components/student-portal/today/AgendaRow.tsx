import Link from "next/link";
import { describeAgendaKind, type AgendaEntry } from "@/lib/student-today";
import { getUnifiedItemColor } from "@/lib/utils/unifiedItemUtils";
import { HOME_ROW_CLASS } from "./HomeSection";
import { WithinPageLink } from "./WithinPageLink";

/** 일정 한 줄: 시각 · 유형 색 점 · 제목 · 유형 이름. 노트는 문서로, 일정은 캘린더로 연결한다. */
export function AgendaRow({
  entry,
  when,
  calendarHref,
  returnTo,
}: {
  entry: AgendaEntry;
  when: string;
  calendarHref: string;
  returnTo: string;
}) {
  const { item } = entry;
  const kind = describeAgendaKind(item);
  const content = (
    <>
      <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{when}</span>
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: getUnifiedItemColor(item) }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-foreground">{item.title || "제목 없음"}</span>
      <span className="hidden max-w-[9rem] shrink-0 truncate text-xs text-muted-foreground min-[420px]:inline">
        {kind}
      </span>
    </>
  );

  if (item.type === "NOTE") {
    return (
      <Link
        href={`/dashboard/notes/${encodeURIComponent(item.id)}?returnTo=${encodeURIComponent(returnTo)}`}
        className={HOME_ROW_CLASS}
      >
        {content}
      </Link>
    );
  }
  return (
    <WithinPageLink href={calendarHref} className={HOME_ROW_CLASS} aria-label={`${item.title || "제목 없음"}, ${kind}, ${when} — 캘린더에서 보기`}>
      {content}
    </WithinPageLink>
  );
}
