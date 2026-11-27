/**
 * 관리자 학생 스페이스의 canonical 노트 목록(AdminStudentNotes 보드). 학생 상세의 노트 탭이 이 화면으로 온다.
 * 머리는 다른 탭과 같은 학생 상세 머리(학생 바꾸기·새 노트·과제 내기·탭, 캔버스 AdminUx1123 ②)를 쓰고,
 * 아래에 시간으로 보기·휴지통과 노트 표/목록을 둔다. 작성은 별도 composer route를 사용한다.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock3, Trash2 } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getStudentById, getStudentOptions, getStudentWorkCounts } from "@/lib/actions/students";
import { getLessonGroups } from "@/lib/actions/lessonGroups";
import { StudentDetailHead } from "@/components/admin/StudentDetailHead";
import { StudentDetailTopBar } from "../StudentDetailTopBar";
import { buttonClassName } from "@/components/ui/button";
import { getPrivateNotes, getStudentGroupNotes } from "@/lib/actions/privateNotes";
import { NotesMobileLinks } from "@/components/notes/NotesPageHeader";
import { NotesDatabase } from "@/components/notes/NotesDatabase";
import { toNotesDatabaseRows } from "@/lib/notes-database";
import { getNoteSearchQuery, searchPrivateNotes } from "@/components/notes/NoteSearch";
import { buildNotesLessonsTimelineHref } from "@/lib/calendar-section-contract";
import { getRequestNow } from "@/lib/request-time";
import { getNoteViews } from "@/lib/actions/noteViews";
import { formatNoteViewed } from "@/components/notes/note-display";
import { RouteAutoRefresh } from "@/components/app-shell/RouteAutoRefresh";
import { buildArchivedStudentHref, isArchivedStudent } from "@/lib/archived-student-records";

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
  if (!student || student.role !== "student") {
    // 수강 종료한 학생의 노트는 보기 전용 상세의 노트 탭에서 본다(캔버스 UxReview1120Policies ⑩).
    redirect(await isArchivedStudent(studentId) ? buildArchivedStudentHref(studentId) : "/dashboard/admin");
  }

  const listPath = `/dashboard/admin/students/${studentId}/notes`;
  const composerPath = `${listPath}/new`;
  const query = getNoteSearchQuery((await searchParams).q);
  const returnTo = query ? `${listPath}?q=${encodeURIComponent(query)}` : listPath;
  // 개인 노트와 그 학생이 지금 속한 그룹의 그룹 노트를 함께 보이고, 그룹이 있으면 범위 보기를 둔다.
  const [personalNotes, groupNotes, workCounts, switcherStudents, switcherGroups] = await Promise.all([
    // 검색할 때만 전체 본문을 읽고, 아니면 미리보기용 앞부분만 읽는다.
    getPrivateNotes(studentId, { fullContent: Boolean(query) }),
    getStudentGroupNotes(studentId, { fullContent: Boolean(query) }),
    getStudentWorkCounts(studentId),
    // 머리 이름의 학생 고르기. 못 읽으면 이름만 보인다.
    getStudentOptions().catch(() => []),
    getLessonGroups().catch(() => []),
  ]);
  const notes = [
    ...personalNotes.map((note) => ({ ...note, groupName: null })),
    ...(groupNotes?.notes ?? []).map((note) => ({ ...note, groupName: groupNotes!.group.name })),
  ];
  const matchingNotes = searchPrivateNotes(notes, query);
  // 학생 열람(관리자만, 0044): 이 학생이 노트를 마지막으로 연 때. 그룹 노트도 이 학생 기준.
  const now = getRequestNow();
  const views = await getNoteViews(matchingNotes.map((note) => note.id));
  const rows = toNotesDatabaseRows(matchingNotes).map((row) => {
    const view = views[row.id]?.find((entry) => entry.studentId === studentId);
    return { ...row, viewedLabel: view ? formatNoteViewed(view.lastViewedAt, now) : null };
  });
  const name = student.displayName?.trim() || student.email;
  const timelineHref = buildNotesLessonsTimelineHref({ role: "admin", studentId });
  const trashHref = `/dashboard/notes/trash?studentId=${encodeURIComponent(studentId)}&returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <div className="px-5 pb-8 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <StudentDetailTopBar
        studentId={studentId}
        activeTab="notes"
        returnTo={returnTo}
        switcher={switcherStudents.length > 1 ? { name, tab: "notes", students: switcherStudents, groups: switcherGroups } : null}
      />
      {/* 자동 저장은 목록을 revalidate하지 않으므로 편집에서 돌아오거나 창으로 돌아올 때 제목·날짜를 다시 받는다. */}
      <RouteAutoRefresh />
      <div className="flex max-w-[1080px] flex-col md:mx-auto md:gap-7">
        <StudentDetailHead
          studentId={studentId}
          name={name}
          email={student.email}
          activeTab="notes"
          returnTo={returnTo}
          counts={{ assignments: workCounts.pendingFeedbackCount, qna: workCounts.openQnaCount }}
          switcherStudents={switcherStudents}
          switcherGroups={switcherGroups}
        />
        <div className="flex flex-col gap-5 pt-2 md:gap-4 md:pt-0">
          <div className="hidden items-center justify-end gap-2 md:flex">
            <Link href={timelineHref} className={buttonClassName({ variant: "ghost" })}>
              <Clock3 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />시간으로 보기
            </Link>
            <Link href={trashHref} className={buttonClassName({ variant: "ghost" })}>
              <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />휴지통
            </Link>
          </div>
          <NotesDatabase
            rows={rows}
            ownerId={session.user.id}
            returnTo={returnTo}
            returnFallback={listPath}
            composerPath={composerPath}
            searchAction={listPath}
            query={query}
            totalCount={notes.length}
            scopeFilter={groupNotes !== null}
            now={now}
            emptyMessage={query ? "검색 결과가 없습니다. 다른 단어로 검색하거나 검색을 초기화해 주세요." : "아직 이 학생 스페이스에 작성된 노트가 없습니다."}
          />
  <NotesMobileLinks timelineHref={timelineHref} trashHref={trashHref} />
        </div>
      </div>
    </div>
  );
}
