import Link from "next/link";
import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import {
  getPrivateNotePreview,
  toNotesDatabaseRows,
  type NotesDatabaseRow,
  type NotesDatabaseSource,
} from "@/lib/notes-database";

export { getPrivateNotePreview };

export type PrivateNoteListItem = NotesDatabaseSource;

export function buildPrivateNoteHref(noteId: string, returnTo: string): string {
  return `/dashboard/notes/${noteId}?returnTo=${encodeURIComponent(returnTo)}`;
}

/** 표·목록 보기가 공유하는 빈 상태. 의미(메시지)는 호출한 화면이 정한다. */
export function NotesEmptyState({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <FileText className="size-6 text-muted-foreground/70" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {children}
    </div>
  );
}

/** 목록 보기: 노트마다 행 전체가 하나의 링크다. 테두리는 바깥 database 틀이 그린다. */
export function NoteRowList({ rows, returnTo }: { rows: NotesDatabaseRow[]; returnTo: string }) {
  return (
    <ul aria-label="노트 목록">
      {rows.map((row, index) => (
        <li key={row.id} className={index > 0 ? "border-t border-border" : undefined}>
          <Link
            href={buildPrivateNoteHref(row.id, returnTo)}
            className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
          >
            <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-medium text-foreground">{row.title}</h2>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{row.preview}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.dateLabel}
                {row.authorName ? <span> · {row.authorName}</span> : null}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 서버 화면(학생 상세 노트 탭 등)에서 쓰는 단순 목록. */
export function PrivateNoteList({
  notes,
  returnTo,
  emptyMessage = "아직 작성된 노트가 없습니다.",
}: {
  notes: PrivateNoteListItem[];
  returnTo: string;
  emptyMessage?: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      {notes.length === 0
        ? <NotesEmptyState message={emptyMessage} />
        : <NoteRowList rows={toNotesDatabaseRows(notes)} returnTo={returnTo} />}
    </div>
  );
}
