/**
 * @file src/app/dashboard/admin/page.tsx
 * @description 관리자 원페이지 포탈. RSC 데이터 프리패치 셸.
 * AdminPortalClient에 병렬 패치한 데이터를 props로 전달.
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getStudentRosterStats } from "@/lib/actions/students";
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
import { firstSearchValue, legacyPortalSectionRedirect, resolvePortalLocation, type PortalSearchParams } from "@/lib/portal-location";

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
  const [initialCalendar, qnaThreads, pendingAssignments, lessonNoteIds] = await Promise.all([
    initialStudentId === ALL_STUDENTS_SCOPE
      ? getUnifiedItemsForAllStudents().then((result: AllStudentsUnifiedItems) => ({ items: result.items, window: result }))
      : initialStudentId
        ? getUnifiedItemsForStudent(initialStudentId).then((items) => ({ items, window: null }))
        : Promise.resolve({ items: [], window: null }),
    getQnaThreads(),
    getPendingFeedbackAssignments(),
    getLessonNoteIdsInRange(upcomingStudentIds, lessonWindow).catch(() => ({})),
  ]);

  return (
    <AdminPortalClient
      initialLocation={initialLocation}
      initialStudentId={initialStudentId}
      initialUnifiedItems={initialCalendar.items}
      initialAllStudentsWindow={initialCalendar.window
        ? { start: initialCalendar.window.start, end: initialCalendar.window.end, truncated: initialCalendar.window.truncated }
        : undefined}
      students={students}
      adminId={adminId}
      qnaThreads={qnaThreads}
      pendingAssignments={pendingAssignments}
      lessonNoteIds={lessonNoteIds}
      referenceTime={referenceTime}
    />
  );
}
