/**
 * @file src/app/dashboard/student/notes/new/page.tsx
 * @description 학생 노트 작성 풀 페이지.
 * 세션에서 studentId를 가져와 createPrivateNote에 바인딩 후 클라이언트 폼에 전달.
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { createPrivateNote } from "@/lib/actions/privateNotes";
import { NoteFullForm } from "@/components/notes/NoteFullForm";
import { safeReturnPath } from "@/lib/safe-return-path";
import { resolveNoteCreateDefaultDate } from "@/lib/note-create-route";

export const metadata = {
  title: "노트 작성",
};

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; date?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "student") redirect("/dashboard/admin");

  const studentId = session.user.id;
  const boundAction = createPrivateNote.bind(null, studentId);
  const query = await searchParams;
  const returnTo = safeReturnPath(query.returnTo, "/dashboard/student/notes");

  return (
    <NoteFullForm
      action={boundAction}
      actorId={studentId}
      studentId={studentId}
      returnTo={returnTo}
      defaultDate={resolveNoteCreateDefaultDate(query.date)}
      spaceLabel={session.user.name?.trim() || session.user.email || "내 스페이스"}
    />
  );
}
