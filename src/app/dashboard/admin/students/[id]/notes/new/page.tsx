import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getStudentById } from "@/lib/actions/students";
import { createPrivateNote } from "@/lib/actions/privateNotes";
import { NoteFullForm } from "@/components/notes/NoteFullForm";
import { resolveNoteCreateDefaultDate } from "@/lib/note-create-route";
import { safeReturnPath } from "@/lib/safe-return-path";

export const metadata = { title: "학생 노트 작성" };

export default async function AdminStudentNewNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string; date?: string }>;
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

  return (
    <NoteFullForm
      action={createPrivateNote.bind(null, studentId)}
      actorId={session.user.id}
      studentId={studentId}
      returnTo={returnTo}
      defaultDate={resolveNoteCreateDefaultDate(query.date)}
      spaceLabel={student.displayName?.trim() || student.email}
    />
  );
}
