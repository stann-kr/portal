/**
 * @file src/app/dashboard/student/notes/new/page.tsx
 * @description 학생 노트 작성 풀 페이지.
 * 세션에서 studentId를 가져와 createPrivateNote에 바인딩 후 클라이언트 폼에 전달.
 */
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createPrivateNote } from "@/lib/actions/privateNotes";
import { NoteFullForm } from "@/components/notes/NoteFullForm";

export const metadata = {
  title: "노트 작성",
};

export default async function NewNotePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const studentId = session.user.id;
  const boundAction = createPrivateNote.bind(null, studentId);

  return <NoteFullForm action={boundAction} />;
}
