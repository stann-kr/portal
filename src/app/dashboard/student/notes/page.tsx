/**
 * @file src/app/dashboard/student/notes/page.tsx
 * @description 학생 전용 노트 목록. 작성은 별도 full-page composer로 이동한다.
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getPrivateNotes } from "@/lib/actions/privateNotes";
import { NotesPageHeader } from "@/components/notes/NotesPageHeader";
import { PrivateNoteList } from "@/components/notes/PrivateNoteList";
import { getNoteSearchQuery, NoteSearch, searchPrivateNotes } from "@/components/notes/NoteSearch";
import { buildNotesLessonsTimelineHref } from "@/lib/calendar-section-contract";

export const metadata = { title: "내 노트" };

export default async function StudentNotesPage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "student") redirect("/dashboard/admin");

  const listPath = "/dashboard/student/notes";
  const query = getNoteSearchQuery((await searchParams).q);
  const returnTo = query ? `${listPath}?q=${encodeURIComponent(query)}` : listPath;
  const notes = await getPrivateNotes(session.user.id);
  const matchingNotes = searchPrivateNotes(notes, query);
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
      <NotesPageHeader
        eyebrow="내 스페이스"
        timelineHref={buildNotesLessonsTimelineHref({ role: "student" })}
        trashHref={`/dashboard/notes/trash?returnTo=${encodeURIComponent(returnTo)}`}
        newNoteHref={`/dashboard/student/notes/new?returnTo=${encodeURIComponent(returnTo)}`}
      />
      <NoteSearch action={listPath} query={query} totalCount={notes.length} resultCount={matchingNotes.length} />
      <PrivateNoteList notes={matchingNotes} returnTo={returnTo} emptyMessage={query ? "검색 결과가 없습니다. 다른 단어로 검색하거나 검색을 초기화해 주세요." : undefined} />
    </div>
  );
}
