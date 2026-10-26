import { notFound, redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import {
  getPrivateNoteIncludingTrash,
  getPrivateNoteRevisions,
} from "@/lib/actions/privateNotes";
import { safeReturnPath } from "@/lib/safe-return-path";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { RestoreNoteRevisionButton } from "@/components/notes/RestoreNoteRevisionButton";
import {
  HistoryRecordItem,
  RecordDetails,
  RecordList,
  RecordMeta,
  RecordPageFrame,
} from "@/components/notes/DocumentRecordFrame";
import { formatRecordTime } from "@/components/notes/note-display";
import { getRequestNow } from "@/lib/request-time";

export const metadata = { title: "노트 변경 이력" };

const CHANGE_LABELS = {
  BASELINE: "기존 노트 이관",
  CREATE: "노트 생성",
  UPDATE: "내용 수정",
  RESTORE_REVISION: "과거 버전 복원",
  TRASH: "휴지통 이동",
  RESTORE_TRASH: "휴지통 복원",
} as const;

/** 노트 변경 이력(NoteHistory 보드). */
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
  const now = getRequestNow();

  return (
    <RecordPageFrame
      width="history"
      back={{ href: noteHref, label: "노트로 돌아가기" }}
      title="변경 이력"
      subtitle={<>{note.title} · 현재 <span className="font-mono">{note.version}</span>번 버전</>}
      description="과거 버전을 복원하면 기존 기록을 덮어쓰지 않고 새 현재 버전이 추가됩니다."
    >
      <RecordList ordered label="노트 변경 이력">
        {revisions.map((revision) => (
          <HistoryRecordItem
            key={revision.id}
            number={revision.revisionNumber}
            changeLabel={CHANGE_LABELS[revision.changeType]}
            meta={
              <RecordMeta
                time={formatRecordTime(revision.createdAt, now)}
                actor={revision.actorName ?? "시스템"}
                extra={revision.restoredFromRevision ? `${revision.restoredFromRevision}번에서 복원` : undefined}
              />
            }
            action={canRestore ? (
              <RestoreNoteRevisionButton
                noteId={note.id}
                baseRevision={note.version}
                revisionNumber={revision.revisionNumber}
              />
            ) : null}
          >
            <RecordDetails summary={`저장된 내용 보기 — ${revision.title}`}>
              <RichTextContent html={revision.contentHtml} className="text-body text-secondary-foreground" />
            </RecordDetails>
          </HistoryRecordItem>
        ))}
      </RecordList>
    </RecordPageFrame>
  );
}
