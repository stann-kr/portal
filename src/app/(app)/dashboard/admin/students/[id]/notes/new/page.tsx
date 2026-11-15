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
      instructor={studentMemo ? { studentId, studentName, noteMemo: null, studentMemo } : undefined}
      group={group}
      personalLabel={`${studentName} 노트`}
      viewerIsAdmin
      defaultLocation={query.space === "group" ? "group" : "personal"}
    />
  );
}
