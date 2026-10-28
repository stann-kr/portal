import Link from "next/link";
import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import {
  getPrivateNotePreview,
  toNotesDatabaseRows,
  type NotesDatabaseRow,
  type NotesDatabaseSource,
} from "@/lib/notes-database";
import { formatListUpdatedLabel, toLedgerDateLabel } from "./note-display";

export { getPrivateNotePreview };

export type PrivateNoteListItem = NotesDatabaseSource;

export function buildPrivateNoteHref(noteId: string, returnTo: string): string {
  return `/dashboard/notes/${noteId}?returnTo=${encodeURIComponent(returnTo)}`;
}

/** 표·목록 보기가 공유하는 빈 상태(States 보드 빈 화면). 의미(메시지)는 호출한 화면이 정한다. */
export function NotesEmptyState({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-muted px-6 py-10 md:px-8 md:py-12">
      <span className="flex size-9 items-center justify-center rounded-touch bg-sidebar text-muted-foreground">
        <FileText className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
      </span>
      <p className="max-w-[300px] text-body text-secondary-foreground">{message}</p>
      {children}
    </div>
  );
}

/**
 * 목록 보기(MobileNotes 보드): 노트마다 행 전체가 하나의 링크다. 제목·날짜, 미리보기, 작성자·수정 줄.
 * `now`(서버 기준 시각)를 주면 하루 안 수정은 상대 시각으로, 같은 해 날짜는 월·일로 줄여 보인다.
 */
export function NoteRowList({ rows, returnTo, now }: { rows: NotesDatabaseRow[]; returnTo: string; now?: number }) {
  return (
    <ul aria-label="노트 목록" className="flex flex-col border-t border-border">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={buildPrivateNoteHref(row.id, returnTo)}
            className="flex flex-col gap-0.5 border-b border-muted py-[11px] text-foreground transition-colors hover:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:px-2"
          >
            <span className="flex items-baseline justify-between gap-3">
              <h2 className="min-w-0 truncate text-md font-medium">{row.title}</h2>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {toLedgerDateLabel(row.dateLabel, { now, omitSameYear: true })}
              </span>
            </span>
            <span className="truncate text-ui text-secondary-foreground">{row.preview}</span>
            <span className="text-xs text-muted-foreground">
              {row.authorName ?? "작성자 미상"} · {formatListUpdatedLabel(row, now)} 수정
            </span>
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
  now,
}: {
  notes: PrivateNoteListItem[];
  returnTo: string;
  emptyMessage?: string;
  /** 서버 기준 시각. 주면 최근 수정을 상대 시각으로 보인다. */
  now?: number;
}) {
  return notes.length === 0
    ? <NotesEmptyState message={emptyMessage} />
    : <NoteRowList rows={toNotesDatabaseRows(notes)} returnTo={returnTo} now={now} />;
}
