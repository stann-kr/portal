import Link from "next/link";
import { BookOpen, CalendarDays, UserRound } from "lucide-react";
import { createFormDraftRecoveryPreview } from "@/lib/form-draft";

export type PrivateNoteListItem = {
  id: string;
  title: string;
  contentHtml: string;
  noteDate: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  authorName: string | null;
};

function formatDate(value: Date | null): string {
  if (!value) return "날짜 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(value);
}

function formatUpdated(value: Date | null): string {
  if (!value) return "날짜 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

/** 노트 HTML은 목록에서 렌더하지 않고 안전한 짧은 평문 preview로만 표시한다. */
export function getPrivateNotePreview(contentHtml: string): string {
  return createFormDraftRecoveryPreview({ contentHtml }).body ?? "본문 미리보기 없음";
}

export function PrivateNoteList({
  notes,
  returnTo,
  emptyMessage = "아직 작성된 노트가 없습니다.",
}: {
  notes: PrivateNoteListItem[];
  returnTo: string;
  emptyMessage?: string;
}) {
  if (notes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/10 p-12 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="space-y-3" aria-label="노트 목록">
      {notes.map((note) => {
        const noteDate = note.noteDate ?? note.createdAt;
        const status = note.updatedAt?.getTime() !== note.createdAt?.getTime() ? "수정됨" : "작성됨";
        return (
          <li key={note.id}>
            <article className="rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:bg-accent/5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <h2 className="truncate text-base font-semibold text-foreground">{note.title}</h2>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden="true" />노트 날짜 {formatDate(noteDate)}</span>
                    <span className="inline-flex items-center gap-1"><UserRound className="size-3.5" aria-hidden="true" />{note.authorName ?? "작성자 미상"}</span>
                    <span>상태 · {status}</span>
                    <span>최근 변경 {formatUpdated(note.updatedAt ?? note.createdAt)}</span>
                  </div>
                </div>
                <Link
                  href={`/dashboard/notes/${note.id}?returnTo=${encodeURIComponent(returnTo)}`}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <BookOpen className="size-3.5" aria-hidden="true" />
                  노트 열기
                </Link>
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{getPrivateNotePreview(note.contentHtml)}</p>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
