import Link from "next/link";
import { Plus } from "lucide-react";
import type { RecentNote } from "@/lib/student-today";
import { cn } from "@/lib/utils";
import { formatKstDot } from "@/lib/kst-format";
import { LEDGER_ADD_ROW_CLASS, LEDGER_ROW_CLASS } from "./HomeSection";

/**
 * 최근 노트: 넓은 화면은 제목·미리보기·날짜 한 줄, 좁은 화면은 제목과 날짜 아래 미리보기 두 줄.
 * 넓은 화면은 목록 끝에 새 노트 행을 둔다(좁은 화면은 위쪽 막대 새로 만들기).
 */
export function RecentNotesList({
  notes,
  referenceTime,
  returnTo,
  newNoteHref,
}: {
  notes: RecentNote[];
  referenceTime: Date;
  returnTo: string;
  newNoteHref: string;
}) {
  return (
    <>
      {notes.length > 0 ? (
        <ul>
          {notes.map(({ item, preview }) => (
            <li key={item.id}>
              <Link
                href={`/dashboard/notes/${encodeURIComponent(item.id)}?returnTo=${encodeURIComponent(returnTo)}`}
                className={cn(
                  LEDGER_ROW_CLASS,
                  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-3 md:flex md:items-baseline md:px-1",
                )}
              >
                <span className="min-w-0 truncate text-md font-medium md:max-w-[55%] md:shrink-0 md:text-body">
                  {item.title || "제목 없음"}
                </span>
                <span className="col-span-2 row-start-2 min-w-0 truncate text-ui text-muted-foreground max-md:empty:hidden md:flex-1">
                  {preview}
                </span>
                <span className="col-start-2 row-start-1 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {formatKstDot(item.date, { referenceTime })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <Link href={newNoteHref} className={cn(LEDGER_ADD_ROW_CLASS, "hidden md:inline-flex")}>
        <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
        새 노트
      </Link>
    </>
  );
}
