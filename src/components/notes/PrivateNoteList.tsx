import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createFormDraftRecoveryPreview } from "@/lib/form-draft";
import { formatKst } from "@/lib/kst-format";

export type PrivateNoteListItem = {
  id: string;
  title: string;
  contentHtml: string;
  noteDate: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  authorName: string | null;
  searchPreview?: string;
};

function formatDate(value: Date | null): string {
  return formatKst(value, { year: "numeric", month: "short", day: "numeric" }, "날짜 없음");
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

  // 문서 목록은 한 줄 행으로 보여 주고 행 전체를 눌러 노트를 연다.
  return (
    <ul className="overflow-hidden rounded-lg border border-border bg-surface" aria-label="노트 목록">
      {notes.map((note, index) => (
        <li key={note.id} className={index > 0 ? "border-t border-border" : undefined}>
          <Link
            href={`/dashboard/notes/${note.id}?returnTo=${encodeURIComponent(returnTo)}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none sm:px-5"
          >
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold text-foreground">{note.title}</h2>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {note.searchPreview ?? getPrivateNotePreview(note.contentHtml)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(note.noteDate ?? note.createdAt)}
                {note.authorName ? <span> · {note.authorName}</span> : null}
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
