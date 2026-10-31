/**
 * @file src/app/dashboard/student/notes/page.tsx
 * @description 학생 전용 노트 목록(Notes·MobileNotes 보드). 작성은 별도 full-page composer로 이동한다.
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getPrivateNotes } from "@/lib/actions/privateNotes";
import { NotesMobileLinks, NotesPageHeader } from "@/components/notes/NotesPageHeader";
import { NotesDatabase } from "@/components/notes/NotesDatabase";
import { toNotesDatabaseRows } from "@/lib/notes-database";
import { getNoteSearchQuery, searchPrivateNotes } from "@/components/notes/NoteSearch";
import { buildNotesLessonsTimelineHref } from "@/lib/calendar-section-contract";
import { getRequestNow } from "@/lib/request-time";
import { RouteAutoRefresh } from "@/components/app-shell/RouteAutoRefresh";

export const metadata = { title: "내 노트" };

export default async function StudentNotesPage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "student") redirect("/dashboard/admin");

  const listPath = "/dashboard/student/notes";
  const composerPath = `${listPath}/new`;
  const query = getNoteSearchQuery((await searchParams).q);
  const returnTo = query ? `${listPath}?q=${encodeURIComponent(query)}` : listPath;
  const notes = await getPrivateNotes(session.user.id);
  const matchingNotes = searchPrivateNotes(notes, query);
  const timelineHref = buildNotesLessonsTimelineHref({ role: "student" });
  const trashHref = `/dashboard/notes/trash?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <div className="flex max-w-[1080px] flex-col gap-6 px-5 pb-8 pt-4 md:box-content md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      {/* Stann이 이 스페이스에 새 노트를 만들면 새로고침 없이 목록에 나타나게 한다. */}
      <RouteAutoRefresh />
      <NotesPageHeader
        eyebrow="내 스페이스"
        timelineHref={timelineHref}
        trashHref={trashHref}
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
        now={getRequestNow()}
        emptyMessage={query ? "검색 결과가 없습니다. 다른 단어로 검색하거나 검색을 초기화해 주세요." : "아직 작성된 노트가 없습니다."}
      />
      <NotesMobileLinks timelineHref={timelineHref} trashHref={trashHref} />
    </div>
  );
}
