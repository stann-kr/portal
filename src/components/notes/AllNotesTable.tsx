/**
 * 관리자 전체 노트 표(개선 2차 시안 3번): 제목(링크) · 학생 · 종류 · 수정 시각.
 * 넓은 화면은 표, 좁은 화면은 같은 행을 두 줄 목록으로 접는다. 행 데이터는 서버가 권한을 확인한 노트만 받는다.
 */
import Link from "next/link";
import { FileText } from "lucide-react";
import { UnifiedItemStudentChip } from "@/components/ui/unified-item-type";
import type { NotesDatabaseRow } from "@/lib/notes-database";
import { buildPrivateNoteHref } from "./PrivateNoteList";
import { formatListUpdatedLabel } from "./note-display";

export type AllNotesTableRow = NotesDatabaseRow & {
  studentLabel: string;
  kindLabel: string;
};

export function AllNotesTable({ rows, returnTo, now }: { rows: AllNotesTableRow[]; returnTo: string; now?: number }) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full table-fixed border-collapse text-body">
          <caption className="sr-only">전체 학생 노트 표. 최근 수정순입니다.</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="h-9 px-2 text-left text-xs font-normal text-muted-foreground">제목</th>
              <th scope="col" className="w-[140px] px-2 text-left text-xs font-normal text-muted-foreground">학생</th>
              <th scope="col" className="w-[110px] px-2 text-left text-xs font-normal text-muted-foreground">종류</th>
              <th scope="col" aria-sort="descending" className="w-[150px] px-2 text-left text-xs font-medium text-foreground">수정 ↓</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="relative border-b border-muted transition-colors hover:bg-sidebar">
                <td className="h-11 overflow-hidden px-2">
                  <Link
                    href={buildPrivateNoteHref(row.id, returnTo)}
                    className="flex min-w-0 items-center gap-2.5 text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                  >
                    <FileText className="size-[15px] shrink-0 text-item-note" strokeWidth={1.6} aria-hidden="true" />
                    <span className="min-w-0 max-w-[70%] shrink-0 truncate font-medium">{row.title}</span>
                    <span className="min-w-0 flex-1 truncate text-ui text-muted-foreground">{row.preview}</span>
                  </Link>
                </td>
                <td className="truncate px-2 text-ui text-secondary-foreground">{row.studentLabel}</td>
                <td className="truncate px-2 text-ui text-secondary-foreground">{row.kindLabel}</td>
                <td className="truncate px-2 text-ui text-muted-foreground">{formatListUpdatedLabel(row, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label="노트 목록" className="flex flex-col border-t border-border md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={buildPrivateNoteHref(row.id, returnTo)}
              aria-label={`${row.title}, ${row.studentLabel} 학생, ${row.kindLabel}, 수정 ${formatListUpdatedLabel(row, now)}`}
              className="flex flex-col gap-1 border-b border-muted py-[11px] text-foreground transition-colors hover:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="min-w-0 truncate text-md font-medium">{row.title}</span>
              <span className="flex min-w-0 items-center gap-2 text-xs text-secondary-foreground">
                <UnifiedItemStudentChip label={row.studentLabel} />
                <span className="shrink-0">{row.kindLabel}</span>
                <span className="min-w-0 truncate text-muted-foreground">{formatListUpdatedLabel(row, now)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
