import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getTrashedGroupNotes, getTrashedPrivateNotes, getTrashGroupChoices } from "@/lib/actions/privateNotes";
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
import { formatGroupLabel, groupTrashHref } from "@/lib/lesson-group-rules";

export const metadata = { title: "노트 휴지통" };

const DESCRIPTION = "삭제한 노트는 30일 동안 보존되며, 만료 뒤에는 Stann만 영구 삭제할 수 있습니다.";

/**
 * 노트 휴지통(NotesTrash 보드). 학생 공간(`studentId`, 학생은 자기 것)과, 관리자만 여는 그룹 공간(`groupId`)이 있다.
 * 그룹 휴지통은 학생이 그룹에서 빠지거나 그룹을 해제해도 그 그룹의 노트를 찾을 수 있게 그룹으로 연다.
 */
export default async function NoteTrashPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; groupId?: string; returnTo?: string }>;
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

  if (session.user.role === "admin" && query.groupId) {
    const trash = await getTrashedGroupNotes(query.groupId);
    if (!trash) notFound();
    const now = getRequestNow();
    const trashHref = groupTrashHref(trash.group.id, returnTo);
    return (
      <RecordPageFrame
        width="trash"
        back={back}
        title={`${formatGroupLabel(trash.group.name)} 노트 휴지통`}
        description={trash.group.dissolved
          ? "해제한 그룹의 노트는 되살릴 수 없고, 30일 동안 읽을 수 있습니다. 기한이 지나면 Stann만 영구 삭제할 수 있습니다."
          : DESCRIPTION}
      >
        {trash.notes.length === 0 ? (
          <RecordEmpty icon={Trash2}>휴지통이 비어 있습니다.</RecordEmpty>
        ) : (
          <RecordList label="휴지통의 그룹 노트">
            {trash.notes.map((note) => {
              const expired = Boolean(note.purgeEligibleAt && note.purgeEligibleAt.getTime() <= now);
              return (
                <TrashRecordItem
                  key={note.id}
                  title={note.title}
                  href={`/dashboard/notes/${note.id}?returnTo=${encodeURIComponent(trashHref)}`}
                  meta={`${note.authorName ?? "작성자 미상"} · 삭제 ${formatTrashTime(note.deletedAt, now)}`}
                  expired={expired}
                  state={expired
                    ? "복원 기한이 만료되어 영구 삭제할 수 있습니다."
                    : trash.group.dissolved
                      ? `보존: ${formatTrashDeadline(note.purgeEligibleAt, now)}까지`
                      : `복원 가능: ${formatTrashDeadline(note.purgeEligibleAt, now)}까지`}
                  actions={
                    <NoteTrashActions
                      noteId={note.id}
                      version={note.version}
                      canRestore={!expired && !trash.group.dissolved}
                      canPurge={expired}
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

  if (!studentId) {
    // 관리자 첫 화면: 학생은 학생 노트 화면에서 고르고, 그룹 노트는 여기서 그룹을 고른다(해제한 그룹 포함).
    const groups = session.user.role === "admin" ? await getTrashGroupChoices() : [];
    return (
      <RecordPageFrame width="trash" back={back} title="노트 휴지통" description={DESCRIPTION}>
        <RecordEmpty icon={Trash2}>학생 노트는 학생 노트 화면에서 학생을 고른 뒤 휴지통을 열어 주세요.</RecordEmpty>
        {groups.length > 0 ? (
          <nav aria-label="그룹 노트 휴지통" className="flex flex-col gap-2">
            <h2 className="text-ui font-semibold text-foreground">그룹 노트 휴지통</h2>
            <ul className="flex flex-col">
              {groups.map((group) => (
                <li key={group.id} className="border-b border-muted">
                  <Link
                    href={groupTrashHref(group.id, returnTo)}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-sm px-1 py-3 text-md font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 truncate">
                      {formatGroupLabel(group.name)}
                      {group.dissolved ? <span className="ml-1.5 text-xs text-muted-foreground">해제됨</span> : null}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{group.trashedCount}개</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
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
                meta={`${note.groupName ? `${formatGroupLabel(note.groupName)} 노트 · ` : ""}${note.authorName ?? "작성자 미상"} · 삭제 ${formatTrashTime(note.deletedAt, now)}`}
                expired={expired}
                state={expired
                  ? "복원 기한이 만료되어 영구 삭제할 수 있습니다."
                  : `복원 가능: ${formatTrashDeadline(note.purgeEligibleAt, now)}까지`}
                actions={
                  <NoteTrashActions
                    noteId={note.id}
                    version={note.version}
                    canRestore={!expired && note.canWrite}
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
