import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import {
  getPrivateNoteIncludingTrash,
  getPrivateNoteRevisions,
} from "@/lib/actions/privateNotes";
import { safeReturnPath } from "@/lib/safe-return-path";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { RestoreNoteRevisionButton } from "@/components/notes/RestoreNoteRevisionButton";

export const metadata = { title: "노트 변경 이력" };

const CHANGE_LABELS = {
  BASELINE: "기존 노트 이관",
  CREATE: "노트 생성",
  UPDATE: "내용 수정",
  RESTORE_REVISION: "과거 버전 복원",
  TRASH: "휴지통 이동",
  RESTORE_TRASH: "휴지통 복원",
} as const;

export default async function NoteHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ noteId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const { noteId } = await params;
  const note = await getPrivateNoteIncludingTrash(noteId);
  if (!note) notFound();
  const revisions = await getPrivateNoteRevisions(noteId);
  const fallback = `/dashboard/notes/${noteId}`;
  const { returnTo: requestedReturnTo } = await searchParams;
  const returnTo = safeReturnPath(requestedReturnTo, fallback);
  const noteHref = `/dashboard/notes/${noteId}?returnTo=${encodeURIComponent(returnTo)}`;
  const canRestore =
    !note.deletedAt &&
    (session.user.role === "admin" || session.user.id === note.authorId);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-3 border-b border-border pb-5">
        <Link
          href={noteHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          노트로 돌아가기
        </Link>
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">변경 이력</h1>
            <p className="text-sm text-muted-foreground">
              {note.title} · 현재 {note.version}번 버전
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          과거 버전을 복원하면 기존 기록을 덮어쓰지 않고 새 현재 버전이 추가됩니다.
        </p>
      </header>

      <ol className="space-y-4" aria-label="노트 변경 이력">
        {revisions.map((revision) => (
          <li
            key={revision.id}
            className="space-y-3 rounded-xl border border-border bg-card p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {revision.revisionNumber}번 · {CHANGE_LABELS[revision.changeType]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {revision.createdAt.toLocaleString("ko-KR")} · {revision.actorName ?? "시스템"}
                  {revision.restoredFromRevision
                    ? ` · ${revision.restoredFromRevision}번에서 복원`
                    : ""}
                </p>
              </div>
              {canRestore ? (
                <RestoreNoteRevisionButton
                  noteId={note.id}
                  baseRevision={note.version}
                  revisionNumber={revision.revisionNumber}
                />
              ) : null}
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                저장된 내용 보기 — {revision.title}
              </summary>
              <div className="mt-3 border-t border-border pt-3">
                <RichTextContent html={revision.contentHtml} />
              </div>
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}
