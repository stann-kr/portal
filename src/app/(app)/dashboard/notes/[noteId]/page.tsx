import { notFound, redirect } from "next/navigation";
import { AlertTriangle, CalendarDays, Clock3, UserRound } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { findStudentTarget, getActiveAuthSession } from "@/lib/auth-guard";
import { getInstructorMemo } from "@/lib/actions/instructorMemos";
import {
  getPrivateNoteIncludingTrash,
  updatePrivateNote,
} from "@/lib/actions/privateNotes";
import { safeReturnPath } from "@/lib/safe-return-path";
import { groupNoteShareLine } from "@/lib/lesson-group-rules";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { LiveNoteArticle } from "@/components/notes/LiveNoteArticle";
import { NoteDocEditor } from "@/components/notes/NoteDocEditor";
import type { NoteInstructorTools } from "@/components/notes/NoteLessonFrame";
import {
  NoteBreadcrumb,
  NoteDocumentBody,
  NoteDocumentStrip,
  NoteDocumentTitle,
  NoteGroupShareLine,
  NoteHistoryLink,
  NoteProperties,
  NoteProperty,
  resolveNoteParent,
} from "@/components/notes/NoteDocumentChrome";
import { NoteTrashActions } from "@/components/notes/NoteTrashActions";
import { formatNoteLongDate, formatNoteUpdated, formatTrashDeadline, formatTrashTime } from "@/components/notes/note-display";
import { PRIVATE_NOTE_TRASH_RETENTION_SECONDS } from "@/lib/private-note-continuity";
import { getRequestNow } from "@/lib/request-time";
import { missingWhenAccessDenied } from "@/lib/access-denied-as-missing";

export const metadata = { title: "노트" };

/**
 * 관리자 수업 도구 값. 개인 노트는 그 학생 메모 탭 하나, 그룹 노트는 지금 멤버(수강 중, 이름순)마다 탭 하나다
 * (캔버스 UxReview1120Policies ⑪). 개인 노트의 학생이 수강 중이 아니면 도구를 두지 않는다.
 */
async function loadNoteInstructorTools(note: {
  id: string;
  studentId: string;
  authorRole: string | null;
  studentReadOnly: boolean;
  group: { name: string; members: { id: string; name: string }[] } | null;
}): Promise<NoteInstructorTools | undefined> {
  // 학생 편집 고르기는 관리자가 만든 노트에만 둔다(학생이 만든 노트는 그 학생 것이다).
  const studentAccess = note.authorRole === "admin" ? { readOnly: note.studentReadOnly } : null;
  if (note.group) {
    const members = note.group.members;
    // 멤버 목록을 읽은 뒤 수강을 종료한 멤버는 메모 읽기가 거부한다. 그 멤버 탭만 빼고 나머지는 그대로 연다.
    const [noteMemo, ...memberMemos] = await Promise.all([
      getInstructorMemo({ kind: "note", noteId: note.id }),
      ...members.map((member) => missingWhenAccessDenied(getInstructorMemo({ kind: "student", studentId: member.id }))),
    ]);
    if (!noteMemo) return undefined;
    return {
      studentId: note.studentId,
      noteMemo,
      studentAccess,
      groupName: note.group.name,
      members: members.flatMap((member, index) => {
        const memo = memberMemos[index];
        return memo ? [{ studentId: member.id, name: member.name, memo }] : [];
      }),
    };
  }
  const student = await findStudentTarget(note.studentId);
  if (!student) return undefined;
  const [noteMemo, studentMemo] = await Promise.all([
    getInstructorMemo({ kind: "note", noteId: note.id }),
    getInstructorMemo({ kind: "student", studentId: student.id }),
  ]);
  if (!noteMemo || !studentMemo) return undefined;
  return {
    studentId: student.id,
    noteMemo,
    studentAccess,
    members: [{ studentId: student.id, name: student.displayName?.trim() || student.email, memo: studentMemo }],
  };
}

/**
 * 노트 문서(NoteDoc·MobileNoteDoc 보드). 쓸 수 있는 사람(관리자, 개인 노트는 그 학생 본인 — Stann이 만든 노트도(2026-11-23),
 * 그룹 노트는 지금 멤버)은 바로 편집하고, 휴지통 노트는 같은 틀의 읽기 화면이다. 휴지통 이동·복원은 작성자·관리자(그룹은 멤버)만.
 */
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
  // 남의 노트(권한 없음)는 오류 화면 대신 없는 노트처럼 404로 보인다. 다른 오류는 그대로 올린다.
  const note = await missingWhenAccessDenied(getPrivateNoteIncludingTrash(noteId));
  if (!note) notFound();

  const fallback = session.user.role === "admin" ? "/dashboard/admin" : "/dashboard/student/notes";
  const { returnTo: requestedReturnTo, focus } = await searchParams;
  const returnTo = safeReturnPath(requestedReturnTo, fallback);
  const parent = resolveNoteParent(returnTo);
  const historyHref = `/dashboard/notes/${note.id}/history?returnTo=${encodeURIComponent(returnTo)}`;
  // 쓰기 권한은 서버의 노트 규칙(개인: 그 학생 본인·관리자, 그룹: 관리자·지금 멤버)으로 정한 값이다.
  const canEdit = note.access === "write";
  // 휴지통 이동·복원은 따로 판단한다(개인: 작성자·관리자). 학생은 Stann이 만든 자기 노트를 고치지만 버리지 못한다.
  const canManageLifecycle = note.canManageLifecycle;
  const groupShareLine = note.group
    ? groupNoteShareLine(
        note.group,
        { id: session.user.id, isAdmin: session.user.role === "admin" },
        { studentReadOnly: note.studentReadOnly },
      )
    : null;
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
    // 수업 도구·비밀 메모는 관리자 화면에서만 읽어 넘긴다(학생 화면에는 내용이 실리지 않는다).
    const instructor = session.user.role === "admin" ? await loadNoteInstructorTools(note) : undefined;
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
        instructor={instructor}
        groupShareLine={groupShareLine}
        canTrash={canManageLifecycle}
      />
    );
  }

  // 읽기만 할 수 있는 노트(Stann이 학생 편집을 막은 노트, 0036): 같은 room에 읽기로 붙어 제자리에서 갱신하는 읽기 화면.
  if (!note.deletedAt) {
    return (
      <>
        <MobileTopBar
          hideTitle
          back={{ href: parent.href, label: parent.backLabel }}
          actions={<NoteHistoryLink href={historyHref} compact />}
        />
        <LiveNoteArticle
          note={{
            id: note.id,
            title: note.title,
            contentHtml: note.contentHtml,
            noteDate: note.noteDate,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            version: note.version,
          }}
          authorName={authorName}
          now={now}
          parent={parent}
          historyHref={historyHref}
        />
      </>
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
        {groupShareLine ? <NoteGroupShareLine>{groupShareLine}</NoteGroupShareLine> : null}
        <NoteDocumentTitle>{note.title}</NoteDocumentTitle>
        <NoteProperties>
          <NoteProperty icon={CalendarDays} label="날짜">{formatNoteLongDate(note.noteDate ?? note.createdAt, "날짜 정보 없음")}</NoteProperty>
          <NoteProperty icon={UserRound} label="작성자">{authorName}</NoteProperty>
          <NoteProperty icon={Clock3} label="수정">{updatedLabel}</NoteProperty>
        </NoteProperties>

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
              canRestore={canManageLifecycle && !isTrashRetentionExpired}
              canPurge={canPurge}
              returnTo={returnTo}
            />
          </div>
        </section>

        <RichTextContent html={note.contentHtml} />
      </NoteDocumentBody>
    </>
  );
}
