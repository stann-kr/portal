/** 관리자 학생 스페이스의 canonical 노트 목록. 작성은 별도 composer route를 사용한다. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getStudentById } from "@/lib/actions/students";
import { getPrivateNotes } from "@/lib/actions/privateNotes";
import { NotesPageHeader } from "@/components/notes/NotesPageHeader";
import { NotesDatabase } from "@/components/notes/NotesDatabase";
import { toNotesDatabaseRows } from "@/lib/notes-database";
import { buildAdminStudentDetailHref } from "@/lib/student-space-routes";
import { getNoteSearchQuery, searchPrivateNotes } from "@/components/notes/NoteSearch";
import { buildNotesLessonsTimelineHref } from "@/lib/calendar-section-contract";

export const metadata = { title: "학생 노트" };

export default async function AdminStudentNotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student");

  const { id: studentId } = await params;
  const student = await getStudentById(studentId);
  if (!student || student.role !== "student") redirect("/dashboard/admin");

  const listPath = `/dashboard/admin/students/${studentId}/notes`;
  const composerPath = `${listPath}/new`;
  const query = getNoteSearchQuery((await searchParams).q);
  const returnTo = query ? `${listPath}?q=${encodeURIComponent(query)}` : listPath;
  const notes = await getPrivateNotes(studentId);
  const matchingNotes = searchPrivateNotes(notes, query);
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
      <NotesPageHeader
        eyebrow={`학생 스페이스 · ${student.displayName?.trim() || student.email}`}
        backLink={
          <Link href={buildAdminStudentDetailHref(studentId, "notes")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden="true" />학생 상세로 돌아가기
          </Link>
        }
        timelineHref={buildNotesLessonsTimelineHref({ role: "admin", studentId })}
        trashHref={`/dashboard/notes/trash?studentId=${encodeURIComponent(studentId)}&returnTo=${encodeURIComponent(returnTo)}`}
        newNoteHref={`${composerPath}?returnTo=${encodeURIComponent(returnTo)}`}
      />
      <NotesDatabase
        rows={toNotesDatabaseRows(matchingNotes)}
        ownerId={session.user.id}
        returnTo={returnTo}
        returnFallback={listPath}
        composerPath={composerPath}
        searchAction={listPath}
        query={query}
        totalCount={notes.length}
        emptyMessage={query ? "검색 결과가 없습니다. 다른 단어로 검색하거나 검색을 초기화해 주세요." : "아직 이 학생 스페이스에 작성된 노트가 없습니다."}
      />
    </div>
  );
}
