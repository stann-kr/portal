/**
 * 관리자 학생 스페이스의 canonical 노트 목록(AdminStudentNotes 보드). 학생 상세의 노트 탭이 이 화면으로 온다.
 * 작성은 별도 composer route를 사용한다.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getStudentById } from "@/lib/actions/students";
import { getPrivateNotes } from "@/lib/actions/privateNotes";
import { NotesMobileLinks, NotesPageHeader } from "@/components/notes/NotesPageHeader";
import { NotesDatabase } from "@/components/notes/NotesDatabase";
import { toNotesDatabaseRows } from "@/lib/notes-database";
import { buildAdminStudentDetailHref } from "@/lib/student-space-routes";
import { getNoteSearchQuery, searchPrivateNotes } from "@/components/notes/NoteSearch";
import { buildNotesLessonsTimelineHref } from "@/lib/calendar-section-contract";
import { getRequestNow } from "@/lib/request-time";
import { RouteAutoRefresh } from "@/components/app-shell/RouteAutoRefresh";

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
  const detailHref = buildAdminStudentDetailHref(studentId, "overview");
  const timelineHref = buildNotesLessonsTimelineHref({ role: "admin", studentId });
  const trashHref = `/dashboard/notes/trash?studentId=${encodeURIComponent(studentId)}&returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <MobileTopBar title="노트" back={{ href: detailHref, label: "학생 상세로" }} />
      {/* 자동 저장은 목록을 revalidate하지 않으므로 편집에서 돌아오거나 창으로 돌아올 때 제목·날짜를 다시 받는다. */}
      <RouteAutoRefresh />
      <div className="flex max-w-[1080px] flex-col gap-5 md:gap-6">
        <NotesPageHeader
          eyebrow={`학생 스페이스 · ${student.displayName?.trim() || student.email}`}
          backLink={
            <Link
              href={detailHref}
              className="-ml-1 hidden h-8 items-center gap-1.5 self-start rounded-md pl-1 pr-2 text-ui text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
            >
              <ChevronLeft className="size-4" strokeWidth={1.8} aria-hidden="true" />학생 상세로 돌아가기
            </Link>
          }
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
          emptyMessage={query ? "검색 결과가 없습니다. 다른 단어로 검색하거나 검색을 초기화해 주세요." : "아직 이 학생 스페이스에 작성된 노트가 없습니다."}
        />
        <NotesMobileLinks timelineHref={timelineHref} trashHref={trashHref} />
      </div>
    </div>
  );
}
