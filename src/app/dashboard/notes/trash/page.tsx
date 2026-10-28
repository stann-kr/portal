import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getTrashedPrivateNotes } from "@/lib/actions/privateNotes";
import { safeReturnPath } from "@/lib/safe-return-path";
import { NoteTrashActions } from "@/components/notes/NoteTrashActions";
import {
  RecordEmpty,
  RecordList,
  RecordPageFrame,
  TrashRecordItem,
} from "@/components/notes/DocumentRecordFrame";
import { formatTrashDeadline, formatTrashTime } from "@/components/notes/note-display";
import { getRequestNow } from "@/lib/request-time";

export const metadata = { title: "노트 휴지통" };

const DESCRIPTION = "삭제한 노트는 30일 동안 보존되며, 만료 뒤에는 관리자만 영구 삭제할 수 있습니다.";

/** 노트 휴지통(NotesTrash 보드). */
export default async function NoteTrashPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; returnTo?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const query = await searchParams;
  const studentId =
    session.user.role === "admin" ? query.studentId : session.user.id;
  const fallback =
    session.user.role === "admin"
      ? "/dashboard/admin?section=students"
      : "/dashboard/student?section=workspace&view=all";
  const returnTo = safeReturnPath(query.returnTo, fallback);
  const back = { href: returnTo, label: "이전 작업으로 돌아가기" };

  if (!studentId) {
    return (
      <RecordPageFrame width="trash" back={back} title="노트 휴지통" description={DESCRIPTION}>
        <RecordEmpty icon={Trash2}>관리자 휴지통은 학생 노트 화면에서 학생을 선택한 뒤 열어 주세요.</RecordEmpty>
      </RecordPageFrame>
    );
  }

  const notes = await getTrashedPrivateNotes(studentId);
  const now = getRequestNow();
  const trashHref = `/dashboard/notes/trash?studentId=${encodeURIComponent(studentId)}&returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <RecordPageFrame width="trash" back={back} title="노트 휴지통" description={DESCRIPTION}>
      {notes.length === 0 ? (
        <RecordEmpty icon={Trash2}>휴지통이 비어 있습니다.</RecordEmpty>
      ) : (
        <RecordList label="휴지통의 노트">
          {notes.map((note) => {
            const expired = Boolean(
              note.purgeEligibleAt && note.purgeEligibleAt.getTime() <= now,
            );
            return (
              <TrashRecordItem
                key={note.id}
                title={note.title}
                href={`/dashboard/notes/${note.id}?returnTo=${encodeURIComponent(trashHref)}`}
                meta={`${note.authorName ?? "작성자 미상"} · 삭제 ${formatTrashTime(note.deletedAt, now)}`}
                expired={expired}
                state={expired
                  ? "복원 기한이 만료되어 영구 삭제할 수 있습니다."
                  : `복원 가능: ${formatTrashDeadline(note.purgeEligibleAt, now)}까지`}
                actions={
                  <NoteTrashActions
                    noteId={note.id}
                    version={note.version}
                    canRestore={!expired && (session.user.role === "admin" || session.user.id === note.authorId)}
                    canPurge={session.user.role === "admin" && expired}
                    returnTo={trashHref}
                  />
                }
              />
            );
          })}
        </RecordList>
      )}
    </RecordPageFrame>
  );
}
