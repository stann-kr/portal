/**
 * @file src/app/dashboard/admin/students/[id]/notes/page.tsx
 * @description 1:1 Private Notes (Admin View)
 */
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BookOpen, MessageSquarePlus, PencilLine } from "lucide-react";
import { getStudentById } from "@/lib/actions/students";
import { getPrivateNotes } from "@/lib/actions/privateNotes";
import { PrivateNoteForm } from "@/components/notes/PrivateNoteForm";
import { DeleteNoteButton } from "@/components/notes/DeleteNoteButton";
import { RichTextContent } from "@/components/editor/RichTextContent";

type PrivateNote = Awaited<ReturnType<typeof getPrivateNotes>>[number];

export default async function AdminStudentNotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    redirect("/dashboard/student");
  }

  const { id: studentId } = await params;
  const student = await getStudentById(studentId);
  if (!student) redirect("/dashboard/admin");

  const notes = await getPrivateNotes(studentId);

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-6">
      {/* 헤더 */}
      <div className="space-y-1">
        <Link
          href={`/dashboard/admin/students/${studentId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          학생 상세정보로 돌아가기
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-2 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-primary" />
          1:1 수업 노트
        </h1>
        <p className="text-sm text-muted-foreground">
          {student.displayName || student.email} 학생과의 프라이빗 보드입니다.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* 새 노트 작성 */}
        <div className="md:col-span-1">
          <div className="p-6 rounded-xl border border-border bg-card shadow-sm sticky top-6">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <MessageSquarePlus className="w-5 h-5 text-muted-foreground" />
              노트 작성
            </h2>
            <PrivateNoteForm
              studentId={studentId}
              actorId={session.user.id!}
              returnTo={`/dashboard/admin/students/${studentId}/notes`}
            />
          </div>
        </div>

        {/* 노트 목록 */}
        <div className="md:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold">노트 기록 ({notes.length})</h2>
          {notes.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground border border-dashed rounded-xl bg-muted/10">
              <p className="text-sm">아직 작성된 1:1 노트가 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {notes.map((note: PrivateNote) => (
                <div key={note.id} className="p-5 rounded-xl border border-border bg-card shadow-sm space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground">{note.title}</h3>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{note.authorName || "작성자 미상"}</span>
                        <span>·</span>
                        <span>
                          {new Date(note.createdAt!).toLocaleDateString("ko-KR", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/dashboard/notes/${note.id}?returnTo=${encodeURIComponent(`/dashboard/admin/students/${studentId}/notes`)}`}
                        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
                        이어쓰기
                      </Link>
                      {(session.user.id === note.authorId || session.user.role === "admin") && (
                        <DeleteNoteButton noteId={note.id} />
                      )}
                    </div>
                  </div>
                  <RichTextContent html={note.contentHtml} className="text-muted-foreground" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
