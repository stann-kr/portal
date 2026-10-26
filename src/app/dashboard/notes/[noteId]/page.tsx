import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, History, LockKeyhole } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import {
  getPrivateNoteIncludingTrash,
  updatePrivateNote,
} from "@/lib/actions/privateNotes";
import { safeReturnPath } from "@/lib/safe-return-path";
import { NoteEditorForm } from "@/components/notes/NoteEditorForm";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { DeleteNoteButton } from "@/components/notes/DeleteNoteButton";
import { NoteTrashActions } from "@/components/notes/NoteTrashActions";
import { PRIVATE_NOTE_TRASH_RETENTION_SECONDS } from "@/lib/private-note-continuity";
import { formatKst } from "@/lib/kst-format";
import { getRequestNow } from "@/lib/request-time";

export const metadata = { title: "노트" };

export default async function NotePage({
  params,
  searchParams,
}: {
  params: Promise<{ noteId: string }>;
  searchParams: Promise<{ returnTo?: string; focus?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");

  const { noteId } = await params;
  const note = await getPrivateNoteIncludingTrash(noteId);
  if (!note) notFound();

  const fallback = session.user.role === "admin" ? "/dashboard/admin" : "/dashboard/student";
  const { returnTo: requestedReturnTo, focus } = await searchParams;
  const returnTo = safeReturnPath(requestedReturnTo, fallback);
  const canEdit = session.user.role === "admin" || session.user.id === note.authorId;
  const action = updatePrivateNote.bind(null, note.id);
  const purgeEligibleAt = note.deletedAt
    ? new Date(
        note.deletedAt.getTime() +
          PRIVATE_NOTE_TRASH_RETENTION_SECONDS * 1000,
      )
    : null;
  const isTrashRetentionExpired = Boolean(
    purgeEligibleAt && purgeEligibleAt.getTime() <= getRequestNow(),
  );
  const canPurge = Boolean(
    session.user.role === "admin" && isTrashRetentionExpired,
  );

  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          돌아가기
        </Link>
        <div className="flex items-center gap-1">
          <p className="mr-2 hidden text-xs text-muted-foreground sm:block">{note.authorName ?? "작성자 미상"}</p>
          <Link
            href={`/dashboard/notes/${note.id}/history?returnTo=${encodeURIComponent(returnTo)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <History className="h-4 w-4" aria-hidden="true" />
            변경 이력
          </Link>
          {!note.deletedAt && canEdit ? (
            <DeleteNoteButton noteId={note.id} version={note.version} />
          ) : null}
        </div>
      </header>
      {note.deletedAt || !canEdit ? (
        <div>
          <p className="text-xs text-muted-foreground">
            {note.authorName ?? "작성자 미상"} · {formatKst(note.noteDate ?? note.createdAt, { year: "numeric", month: "numeric", day: "numeric" }, "날짜 정보 없음")}
          </p>
          <h1 className="mt-1 break-words text-3xl font-bold tracking-[-0.02em]">{note.title}</h1>
        </div>
      ) : null}

      {note.deletedAt ? (
        <section className="space-y-5 rounded-xl border border-warning/30 bg-warning-muted p-5">
          <div className="space-y-1">
            <h2 className="font-semibold">휴지통에 있는 노트입니다</h2>
            <p className="text-sm text-muted-foreground">
              {formatKst(note.deletedAt)}에 삭제되었습니다. 복원 가능 기한은{" "}
              {formatKst(purgeEligibleAt)}까지이며, 휴지통에서는 편집할 수 없습니다.
            </p>
          </div>
          <NoteTrashActions
            noteId={note.id}
            version={note.version}
            canRestore={canEdit && !isTrashRetentionExpired}
            canPurge={canPurge}
            returnTo={returnTo}
          />
          <RichTextContent html={note.contentHtml} />
        </section>
      ) : canEdit ? (
        <NoteEditorForm
          note={{
            id: note.id,
            title: note.title,
            contentHtml: note.contentHtml,
            noteDate: note.noteDate,
            version: note.version,
          }}
          actorId={session.user.id}
          action={action}
          focusBodyEnd={focus === "end"}
        />
      ) : (
        <section className="space-y-4">
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
            다른 작성자의 노트는 읽기 전용입니다.
          </p>
          <RichTextContent html={note.contentHtml} />
        </section>
      )}
    </article>
  );
}
