import { notFound, redirect } from "next/navigation";
import { AlertTriangle, CalendarDays, Clock3, LockKeyhole, UserRound } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { getActiveAuthSession } from "@/lib/auth-guard";
import {
  getPrivateNoteIncludingTrash,
  updatePrivateNote,
} from "@/lib/actions/privateNotes";
import { safeReturnPath } from "@/lib/safe-return-path";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { NoteDocEditor } from "@/components/notes/NoteDocEditor";
import {
  NoteBreadcrumb,
  NoteDocumentBody,
  NoteDocumentStrip,
  NoteDocumentTitle,
  NoteHistoryLink,
  NoteProperties,
  NoteProperty,
  resolveNoteParent,
} from "@/components/notes/NoteDocumentChrome";
import { NoteTrashActions } from "@/components/notes/NoteTrashActions";
import { formatNoteLongDate, formatNoteUpdated, formatTrashDeadline, formatTrashTime } from "@/components/notes/note-display";
import { PRIVATE_NOTE_TRASH_RETENTION_SECONDS } from "@/lib/private-note-continuity";
import { getRequestNow } from "@/lib/request-time";

export const metadata = { title: "노트" };

/** 노트 문서(NoteDoc·MobileNoteDoc 보드). 작성자·관리자는 바로 편집하고, 휴지통·다른 작성자의 노트는 같은 틀의 읽기 화면이다. */
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

  const fallback = session.user.role === "admin" ? "/dashboard/admin" : "/dashboard/student/notes";
  const { returnTo: requestedReturnTo, focus } = await searchParams;
  const returnTo = safeReturnPath(requestedReturnTo, fallback);
  const parent = resolveNoteParent(returnTo);
  const historyHref = `/dashboard/notes/${note.id}/history?returnTo=${encodeURIComponent(returnTo)}`;
  const canEdit = session.user.role === "admin" || session.user.id === note.authorId;
  const action = updatePrivateNote.bind(null, note.id);
  const now = getRequestNow();
  const purgeEligibleAt = note.deletedAt
    ? new Date(
        note.deletedAt.getTime() +
          PRIVATE_NOTE_TRASH_RETENTION_SECONDS * 1000,
      )
    : null;
  const isTrashRetentionExpired = Boolean(
    purgeEligibleAt && purgeEligibleAt.getTime() <= now,
  );
  const canPurge = Boolean(
    session.user.role === "admin" && isTrashRetentionExpired,
  );
  const authorName = note.authorName ?? "작성자 미상";
  const updatedLabel = formatNoteUpdated(note.updatedAt ?? note.createdAt, now);

  if (!note.deletedAt && canEdit) {
    return (
      <NoteDocEditor
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
        parent={parent}
        historyHref={historyHref}
        authorName={authorName}
        updatedLabel={updatedLabel}
      />
    );
  }

  return (
    <>
      <MobileTopBar
        hideTitle
        back={{ href: parent.href, label: parent.backLabel }}
        actions={<NoteHistoryLink href={historyHref} compact />}
      />
      <NoteDocumentStrip start={<NoteBreadcrumb parent={parent} current={note.title} />}>
        <NoteHistoryLink href={historyHref} />
      </NoteDocumentStrip>
      <NoteDocumentBody as="article">
        <NoteDocumentTitle>{note.title}</NoteDocumentTitle>
        <NoteProperties>
          <NoteProperty icon={CalendarDays} label="날짜">{formatNoteLongDate(note.noteDate ?? note.createdAt, "날짜 정보 없음")}</NoteProperty>
          <NoteProperty icon={UserRound} label="작성자">{authorName}</NoteProperty>
          <NoteProperty icon={Clock3} label="수정">{updatedLabel}</NoteProperty>
        </NoteProperties>

        {note.deletedAt ? (
          <section
            aria-labelledby="note-trash-state"
            className="flex flex-col gap-3.5 rounded-lg border border-warning-border bg-warning-muted p-4"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.8} aria-hidden="true" />
              <div className="flex flex-col gap-1">
                <h2 id="note-trash-state" className="text-sm font-semibold leading-5 text-foreground">휴지통에 있는 노트입니다</h2>
                <p className="text-ui text-secondary-foreground">
                  {formatTrashTime(note.deletedAt, now)}에 삭제되었습니다. 복원 가능 기한은{" "}
                  {formatTrashDeadline(purgeEligibleAt, now)}까지이며, 휴지통에서는 편집할 수 없습니다.
                </p>
              </div>
            </div>
            <div className="pl-[26px]">
              <NoteTrashActions
                noteId={note.id}
                version={note.version}
                canRestore={canEdit && !isTrashRetentionExpired}
                canPurge={canPurge}
                returnTo={returnTo}
              />
            </div>
          </section>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockKeyhole className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
            다른 작성자의 노트는 읽기 전용입니다.
          </p>
        )}

        <RichTextContent html={note.contentHtml} />
      </NoteDocumentBody>
    </>
  );
}
