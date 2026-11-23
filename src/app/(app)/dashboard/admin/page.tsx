/**
 * @file src/app/(app)/dashboard/admin/page.tsx
 * @description 관리자 원페이지 포탈. RSC 데이터 프리패치 셸.
 * AdminPortalClient에 병렬 패치한 데이터를 props로 전달. 바깥 iCal 구독의 다음 레슨은 기다리지 않고 promise로 넘긴다.
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getArchivedStudentCount, getStudentRosterStats, getSubscribedNextLessons } from "@/lib/actions/students";
import { withConnectedNextLessons } from "@/lib/student-roster";
import { getLessonGroups } from "@/lib/actions/lessonGroups";
import {
  getUnifiedItemsForAllStudents,
  getUnifiedItemsForStudent,
  type AllStudentsUnifiedItems,
} from "@/lib/actions/unifiedItems";
import { ALL_STUDENTS_SCOPE, resolveAdminScheduleStudent } from "@/lib/admin-schedule-scope";
import { getOpenQnaThreadsForWorkQueue } from "@/lib/actions/qna";
import { getPendingFeedbackAssignments } from "@/lib/actions/assignments";
import { getGroupLessonNoteIdsInRange, getLessonNoteIdsInRange } from "@/lib/actions/lesson-notes";
import { AdminPortalClient, type AdminLateRoster } from "@/components/admin-portal/AdminPortalClient";
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

  // 바깥 iCal 구독(느릴 수 있는 HTTP)의 다음 레슨은 학생 목록과 같이 시작하되 기다리지 않는다.
  // 첫 화면은 DB 데이터로 그리고, 받은 뒤 업무함·학생 목록에 합친다(AdminPortalClient lateRoster).
  const subscribedNextLessons = getSubscribedNextLessons().catch(() => ({} as Record<string, Date>));
  // 학생 목록 먼저 패치(DB만)
  const students = await getStudentRosterStats();
  // 일정의 학생 선택: `?student=<id>` 딥링크는 그 학생, 없거나 `all`이면 전체 학생(기본).
  const initialStudentId = resolveAdminScheduleStudent(
    firstSearchValue(params.student),
    students.map((student) => student.id),
  );
  // 일정 데이터는 일정 구역으로 열 때만 서버에서 읽는다. 업무함·학생으로 열면 일정 구역을 처음 열 때 받는다.
  const loadCalendar = initialLocation.section === "schedule";

  // 병렬 데이터 패치
  const referenceTime = new Date();
  // 업무함 다가오는 레슨(7일 안) 행의 수업 노트 링크: 그 날짜 노트가 있으면 열고 없으면 새 노트.
  const lessonWindow = { from: referenceTime, to: new Date(referenceTime.getTime() + 7 * 24 * 60 * 60 * 1000) };
  const isUpcoming = (date: Date | null | undefined) => !!date
    && date.getTime() >= lessonWindow.from.getTime()
    && date.getTime() <= lessonWindow.to.getTime();
  const upcomingStudentIds = students
    .filter((student) => isUpcoming(student.nextLessonDate))
    .map((student) => student.id);
  const [initialCalendar, qnaThreads, pendingAssignments, lessonNoteIds, lessonGroups, archivedStudentCount] = await Promise.all([
    !loadCalendar
      ? Promise.resolve(null)
      : initialStudentId === ALL_STUDENTS_SCOPE
        ? getUnifiedItemsForAllStudents().then((result: AllStudentsUnifiedItems) => ({ items: result.items, window: result }))
        : initialStudentId
          ? getUnifiedItemsForStudent(initialStudentId).then((items) => ({ items, window: null }))
          : Promise.resolve({ items: [], window: null }),
    // 업무함 질문은 답변을 기다리는(OPEN) 것만, 수강 중인 학생 것만(수강 종료한 학생의 질문은 Q&A 게시판에 그대로 남는다).
    getOpenQnaThreadsForWorkQueue().then((threads) => {
      const enrolled = new Set(students.map((student) => student.id));
      return threads.filter((thread) => enrolled.has(thread.studentId));
    }),
    getPendingFeedbackAssignments(),
    // 그룹레슨 줄은 그 날 그룹 노트를 연다(열쇠가 "group:"으로 시작해 학생 열쇠와 겹치지 않는다).
    Promise.all([
      getLessonNoteIdsInRange(upcomingStudentIds, lessonWindow).catch(() => ({})),
      getGroupLessonNoteIdsInRange(lessonWindow).catch(() => ({})),
    ]).then(([personal, group]) => ({ ...personal, ...group })),
    getLessonGroups(),
    getArchivedStudentCount(),
  ]);
  // iCal 구독 일정이 DB 다음 레슨보다 이르면 바꾸고, 새로 7일 안에 들어온 학생의 수업 노트 링크도 함께 읽는다.
  // 기다리지 않는 promise로 넘겨 화면이 뜬 뒤 합친다. 실패하면 DB 데이터 그대로 둔다.
  const lateRoster: Promise<AdminLateRoster> = subscribedNextLessons
    .then(async (subscribed) => {
      const merged = withConnectedNextLessons(students, new Map(Object.entries(subscribed)));
      const nextLessonDates: Record<string, Date> = {};
      merged.forEach((student, index) => {
        if (student.nextLessonDate && student.nextLessonDate !== students[index]?.nextLessonDate) {
          nextLessonDates[student.id] = student.nextLessonDate;
        }
      });
      const known = new Set(upcomingStudentIds);
      const added = Object.entries(nextLessonDates)
        .filter(([studentId, date]) => !known.has(studentId) && isUpcoming(date))
        .map(([studentId]) => studentId);
      const addedLessonNoteIds = added.length > 0
        ? await getLessonNoteIdsInRange(added, lessonWindow).catch(() => ({}))
        : {};
      return { nextLessonDates, lessonNoteIds: addedLessonNoteIds };
    })
    .catch(() => ({ nextLessonDates: {}, lessonNoteIds: {} }));
  // 학생 일정 딥링크(?student=&date=&item=, 학생이 옮긴 레슨 알림): 그 날짜로 가서 그 학생 목록에 있는 항목이면 상세를 연다.
  const calendarDeepLink = initialCalendar && initialStudentId && initialStudentId !== ALL_STUDENTS_SCOPE
    ? resolveStudentDeepLink(resolvePortalDeepLink(params), { taskIds: [], items: initialCalendar.items, keyOf: getUnifiedItemKey })
    : null;

  return (
    <AdminPortalClient
      initialLocation={initialLocation}
      initialStudentId={initialStudentId}
      initialCalendarDeepLink={calendarDeepLink
        ? { date: calendarDeepLink.calendarDate, itemKey: calendarDeepLink.calendarItemKey }
        : undefined}
      initialUnifiedItems={initialCalendar?.items}
      initialAllStudentsWindow={initialCalendar?.window
        ? { start: initialCalendar.window.start, end: initialCalendar.window.end, truncated: initialCalendar.window.truncated }
        : undefined}
      students={students}
      lessonGroups={lessonGroups}
      archivedStudentCount={archivedStudentCount}
      adminId={adminId}
      qnaThreads={qnaThreads}
      pendingAssignments={pendingAssignments}
      lessonNoteIds={lessonNoteIds}
      lateRoster={lateRoster}
      referenceTime={referenceTime}
    />
  );
}
