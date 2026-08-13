/** 관리자 학생 스페이스의 canonical 노트 목록. 작성은 별도 composer route를 사용한다. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BookOpen, Clock3, Plus, Trash2 } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getStudentById } from "@/lib/actions/students";
import { getPrivateNotes } from "@/lib/actions/privateNotes";
import { PrivateNoteList } from "@/components/notes/PrivateNoteList";
import { buildNotesLessonsTimelineHref } from "@/lib/calendar-section-contract";

export const metadata = { title: "학생 노트" };

export default async function AdminStudentNotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student");

  const { id: studentId } = await params;
  const student = await getStudentById(studentId);
  if (!student || student.role !== "student") redirect("/dashboard/admin");

  const returnTo = `/dashboard/admin/students/${studentId}/notes`;
  const notes = await getPrivateNotes(studentId);
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-3 border-b border-border pb-5">
        <Link href={`/dashboard/admin/students/${studentId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />학생 상세로 돌아가기</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">학생 스페이스 · {student.displayName?.trim() || student.email}</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><BookOpen className="size-6 text-primary" aria-hidden="true" />노트</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href={buildNotesLessonsTimelineHref({ role: "admin", studentId })} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><Clock3 className="size-4" aria-hidden="true" />시간으로 보기</Link>
            <Link href={`/dashboard/notes/trash?studentId=${encodeURIComponent(studentId)}&returnTo=${encodeURIComponent(returnTo)}`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><Trash2 className="size-4" aria-hidden="true" />휴지통</Link>
            <Link href={`/dashboard/admin/students/${studentId}/notes/new?returnTo=${encodeURIComponent(returnTo)}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"><Plus className="size-4" aria-hidden="true" />노트 작성</Link>
          </div>
        </div>
      </header>
      <PrivateNoteList notes={notes} returnTo={returnTo} emptyMessage="아직 이 학생 스페이스에 작성된 노트가 없습니다." />
    </div>
  );
}
