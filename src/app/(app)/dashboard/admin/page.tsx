/**
 * @file src/app/(app)/dashboard/admin/page.tsx
 * @description 관리자 원페이지 포탈. RSC 데이터 프리패치 셸.
 * AdminPortalClient에 병렬 패치한 데이터를 props로 전달.
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getArchivedStudentCount, getStudentRosterStats } from "@/lib/actions/students";
import { getLessonGroups } from "@/lib/actions/lessonGroups";
import {
  getUnifiedItemsForAllStudents,
  getUnifiedItemsForStudent,
  type AllStudentsUnifiedItems,
} from "@/lib/actions/unifiedItems";
import { ALL_STUDENTS_SCOPE, resolveAdminScheduleStudent } from "@/lib/admin-schedule-scope";
import { getQnaThreads } from "@/lib/actions/qna";
import { getPendingFeedbackAssignments } from "@/lib/actions/assignments";
import { getLessonNoteIdsInRange } from "@/lib/actions/lesson-notes";
import { AdminPortalClient } from "@/components/admin-portal/AdminPortalClient";
import {
  firstSearchValue,
  legacyPortalSectionRedirect,
  resolvePortalDeepLink,
  resolvePortalLocation,
  resolveStudentDeepLink,
  type PortalSearchParams,
} from "@/lib/portal-location";
import { getUnifiedItemKey } from "@/lib/utils/unifiedItemUtils";

export const metadata = { title: "Stann 포탈" };

export default async function AdminPortalPage({ searchParams }: { searchParams: Promise<PortalSearchParams> }) {
  const session = await getActiveAuthSession();
  if (session?.user?.role !== "admin") redirect("/dashboard/student");

  const adminId = session.user.id!;
  const params = await searchParams;
  const legacyRedirect = legacyPortalSectionRedirect(params);
  if (legacyRedirect) redirect(legacyRedirect);
  const initialLocation = resolvePortalLocation("admin", params);

  // 학생 목록 먼저 패치
  const students = await getStudentRosterStats();
  // 일정의 학생 선택: `?student=<id>` 딥링크는 그 학생, 없거나 `all`이면 전체 학생(기본).
  const initialStudentId = resolveAdminScheduleStudent(
    firstSearchValue(params.student),
    students.map((student) => student.id),
  );

  // 병렬 데이터 패치
  const referenceTime = new Date();
  // 업무함 다가오는 레슨(7일 안) 행의 수업 노트 링크: 그 날짜 노트가 있으면 열고 없으면 새 노트.
  const lessonWindow = { from: referenceTime, to: new Date(referenceTime.getTime() + 7 * 24 * 60 * 60 * 1000) };
  const upcomingStudentIds = students
    .filter((student) => student.nextLessonDate
      && student.nextLessonDate.getTime() >= lessonWindow.from.getTime()
      && student.nextLessonDate.getTime() <= lessonWindow.to.getTime())
    .map((student) => student.id);
  const [initialCalendar, qnaThreads, pendingAssignments, lessonNoteIds, lessonGroups, archivedStudentCount] = await Promise.all([
    initialStudentId === ALL_STUDENTS_SCOPE
      ? getUnifiedItemsForAllStudents().then((result: AllStudentsUnifiedItems) => ({ items: result.items, window: result }))
      : initialStudentId
        ? getUnifiedItemsForStudent(initialStudentId).then((items) => ({ items, window: null }))
        : Promise.resolve({ items: [], window: null }),
    // 업무함 질문은 수강 중인 학생 것만(수강 종료한 학생의 질문은 Q&A 게시판에 그대로 남는다).
    getQnaThreads().then((threads) => {
      const enrolled = new Set(students.map((student) => student.id));
      return threads.filter((thread) => enrolled.has(thread.studentId));
    }),
    getPendingFeedbackAssignments(),
    getLessonNoteIdsInRange(upcomingStudentIds, lessonWindow).catch(() => ({})),
    getLessonGroups(),
    getArchivedStudentCount(),
  ]);
  // 학생 일정 딥링크(?student=&date=&item=, 학생이 옮긴 레슨 알림): 그 날짜로 가서 그 학생 목록에 있는 항목이면 상세를 연다.
  const calendarDeepLink = initialStudentId && initialStudentId !== ALL_STUDENTS_SCOPE
    ? resolveStudentDeepLink(resolvePortalDeepLink(params), { taskIds: [], items: initialCalendar.items, keyOf: getUnifiedItemKey })
    : null;

  return (
    <AdminPortalClient
      initialLocation={initialLocation}
      initialStudentId={initialStudentId}
      initialCalendarDeepLink={calendarDeepLink
        ? { date: calendarDeepLink.calendarDate, itemKey: calendarDeepLink.calendarItemKey }
        : undefined}
      initialUnifiedItems={initialCalendar.items}
      initialAllStudentsWindow={initialCalendar.window
        ? { start: initialCalendar.window.start, end: initialCalendar.window.end, truncated: initialCalendar.window.truncated }
        : undefined}
      students={students}
      lessonGroups={lessonGroups}
      archivedStudentCount={archivedStudentCount}
      adminId={adminId}
      qnaThreads={qnaThreads}
      pendingAssignments={pendingAssignments}
      lessonNoteIds={lessonNoteIds}
      referenceTime={referenceTime}
    />
  );
}
