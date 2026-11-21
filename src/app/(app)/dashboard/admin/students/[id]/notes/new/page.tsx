import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getStudentById } from "@/lib/actions/students";
import { createPrivateNote } from "@/lib/actions/privateNotes";
import { getInstructorMemo } from "@/lib/actions/instructorMemos";
import { getStudentLessonGroup } from "@/lib/actions/lessonGroups";
import { NoteFullForm } from "@/components/notes/NoteFullForm";
import { resolveNoteCreateDefaultDate, resolveNoteCreateDefaultTitle } from "@/lib/note-create-route";
import { safeReturnPath } from "@/lib/safe-return-path";

export const metadata = { title: "학생 노트 작성" };

export default async function AdminStudentNewNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string; date?: string; title?: string; space?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student");

  const { id: studentId } = await params;
  const student = await getStudentById(studentId);
  if (!student || student.role !== "student") redirect("/dashboard/admin");
  const query = await searchParams;
  const fallback = `/dashboard/admin/students/${studentId}/notes`;
  const returnTo = safeReturnPath(query.returnTo, fallback);
  const studentName = student.displayName?.trim() || student.email;
  // 수업 중 새 노트에서도 타이머·학생 메모를 바로 쓴다. 이 수업 메모는 노트가 만들어진 뒤 열린다.
  const [studentMemo, group] = await Promise.all([
    getInstructorMemo({ kind: "student", studentId }),
    // 이 학생이 그룹에 있으면 그 그룹 노트로도 쓸 수 있다(그룹 노트는 관리자 이름으로 만든다).
    getStudentLessonGroup(studentId),
  ]);
  // 저장 위치를 그룹 노트로 바꾸면 멤버 이름 메모 탭을 둔다(캔버스 UxReview1120Policies ⑪). 저장 위치는 화면에서 바로
  // 바꾸므로 멤버 메모를 미리 읽는다. 이 학생 메모는 위에서 읽은 것을 그대로 쓴다.
  const groupMembers = group
    ? await Promise.all(group.members.map(async (member) => {
        const memo = member.id === studentId ? studentMemo : await getInstructorMemo({ kind: "student", studentId: member.id });
        return memo ? [{ studentId: member.id, name: member.name, memo }] : [];
      })).then((rows) => rows.flat())
    : [];

  return (
    <NoteFullForm
      action={createPrivateNote.bind(null, studentId)}
      actorId={session.user.id}
      studentId={studentId}
      returnTo={returnTo}
      defaultDate={resolveNoteCreateDefaultDate(query.date)}
      defaultTitle={resolveNoteCreateDefaultTitle(query.title)}
      spaceLabel={studentName}
      authorName={session.user.name || "Stann"}
      instructor={studentMemo
        ? { studentId, noteMemo: null, members: [{ studentId, name: studentName, memo: studentMemo }] }
        : undefined}
      groupInstructor={studentMemo && group
        ? { studentId, noteMemo: null, members: groupMembers, groupName: group.name }
        : undefined}
      group={group}
      personalLabel={`${studentName} 노트`}
      viewerIsAdmin
      defaultLocation={query.space === "group" ? "group" : "personal"}
    />
  );
}
