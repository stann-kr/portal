import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { formatKstShortDate } from "@/lib/kst-format";
import type { RecentNote } from "@/lib/student-today";
import { HOME_ROW_CLASS } from "./HomeSection";

/** 최근 노트: 제목·미리보기·날짜 한 줄씩, 마지막 행은 새 노트 작성. */
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
    <ul className="space-y-0.5">
      {notes.map(({ item, preview }) => (
        <li key={item.id}>
          <Link
            href={`/dashboard/notes/${encodeURIComponent(item.id)}?returnTo=${encodeURIComponent(returnTo)}`}
            className={`${HOME_ROW_CLASS} items-start`}
          >
            <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground">{item.title || "제목 없음"}</span>
              {preview ? (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{preview}</span>
              ) : null}
            </span>
            <span className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatKstShortDate(item.date, "", referenceTime)}
            </span>
          </Link>
        </li>
      ))}
      <li>
        <Link href={newNoteHref} className={`${HOME_ROW_CLASS} text-muted-foreground hover:text-foreground`}>
          <Plus className="size-4 shrink-0" aria-hidden="true" />
          새 노트
        </Link>
      </li>
    </ul>
  );
}
