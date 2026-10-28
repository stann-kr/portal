/**
 * @file src/app/dashboard/admin/students/[id]/page.tsx
 * @description 학생 상세 페이지 (Admin 전용) — RSC 탭 통합 뷰(AdminStudentDetail·Assignments·Digging·Qna 보드).
 * URL searchParams(?tab=xxx)로 개요 / 과제 / 디깅 / Q&A 전환. 노트 탭은 학생 스페이스 노트 화면으로 보낸다.
 * 각 탭은 서버에서 데이터를 병렬 fetch하여 렌더링.
 */
import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, Play } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getStudentAccountState, getStudentById } from "@/lib/actions/students";
import { getCurriculumByStudent } from "@/lib/actions/curriculum";
import { isCurriculumVisible } from "@/lib/curriculum-visibility";
import { getLessonsByStudent } from "@/lib/actions/lessons";
import { getOrSeedColumns, getDiggingTracks } from "@/lib/actions/digging";
import { getDiggingPlaylists } from "@/lib/actions/digging-playlists";
import { getQnaThreadsByStudent } from "@/lib/actions/qna";
import { getAssignmentSummariesByStudent } from "@/lib/actions/assignments";
import { getAssignmentTasksForStudent } from "@/lib/actions/assignmentTasks";
import { AdminAssignmentsPanel } from "@/components/admin/assignments/AdminAssignmentsPanel";
import { getStudentCalendarFeedIssuedAt } from "@/lib/actions/calendarFeed";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatKstShortDate } from "@/lib/kst-format";
import { describeAssignmentSubmission } from "@/lib/unified-item-normalization";
import { buildAdminStudentNotesHref, StudentDetailTabs } from "@/components/admin/StudentDetailTabs";
import { OverviewTab } from "@/components/admin/OverviewTab";
import { DiggingBoard } from "@/components/digging/DiggingBoard";
import { PlaylistSection } from "@/components/digging/PlaylistSection";
import { ThreadList } from "@/components/qna/ThreadList";
import {
  LEDGER_HEADER_NOTE_CLASS,
  LEDGER_ROW_CLASS,
  LedgerSection,
  LedgerSectionHeader,
} from "@/components/student-portal/today/HomeSection";
import { resolveQnaFilter } from "@/lib/qna-routes";
import { normalizeDocumentSearchQuery } from "@/lib/document-search";
import { cn } from "@/lib/utils";
import type { DiggingColumnType, QnaStatus } from "@/db/schema";
import {
  buildAdminStudentDetailHref,
  resolveStudentDetailTab,
  type StudentDetailTab,
} from "@/lib/student-space-routes";
import { getRequestNow } from "@/lib/request-time";
import { StudentDetailTopBar } from "./StudentDetailTopBar";

type RawColumn = Awaited<ReturnType<typeof getOrSeedColumns>>[number];
type RawQnaThread = Awaited<ReturnType<typeof getQnaThreadsByStudent>>[number];

const TAB_FALLBACK_CLASS = "rounded-lg bg-muted animate-pulse motion-reduce:animate-none";

// ─── 탭별 콘텐츠 ───────────────────────────────────

async function DiggingTabContent({ studentId }: { studentId: string }) {
  const [columns, tracks, playlists] = await Promise.all([
    getOrSeedColumns(studentId),
    getDiggingTracks(studentId),
    getDiggingPlaylists(studentId),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PlaylistSection initialPlaylists={playlists} readonly />
      <DiggingBoard
        heading={<h2 className="text-ui font-semibold text-secondary-foreground">트랙</h2>}
        initialColumns={columns.map((c: RawColumn) => ({
          id: c.id,
          name: c.name,
          columnType: c.columnType as DiggingColumnType,
          options: c.options,
          isDefault: c.isDefault ?? false,
          sortOrder: c.sortOrder ?? 0,
        }))}
        initialTracks={tracks}
        readonly
      />
    </div>
  );
}

async function AssignmentsTabContent({ studentId, referenceTime }: { studentId: string; referenceTime: Date }) {
  // 정기 과제 회차를 먼저 만든 뒤 제출 목록을 읽는다.
  const { tasks, recurrences } = await getAssignmentTasksForStudent(studentId);
  const summaries = await getAssignmentSummariesByStudent(studentId);
  const returnTo = buildAdminStudentDetailHref(studentId, "assignments");

  return (
    <div className="flex flex-col gap-8">
      <AdminAssignmentsPanel
        studentId={studentId}
        tasks={tasks}
        recurrences={recurrences}
        referenceTime={referenceTime}
        returnTo={returnTo}
      />
      <LedgerSection labelledBy="assignments-heading" className="max-w-[880px]">
        <LedgerSectionHeader
          id="assignments-heading"
          title="제출 기록"
          count={summaries.length}
          aside={<span className={LEDGER_HEADER_NOTE_CLASS}>최신순</span>}
        />
        {summaries.length === 0 ? (
          <p className="py-6 text-body text-muted-foreground">
            아직 제출이 없습니다. 학생이 받은 과제를 내거나 과제 화면에서 링크·글을 자유롭게 제출하면 이곳에 표시됩니다.
          </p>
        ) : (
          <ul>
            {summaries.map((assignment) => {
              const submitted = formatKstShortDate(assignment.submittedAt, "", referenceTime);
              return (
                <li key={assignment.id}>
                  <Link
                    href={`/dashboard/student/assignments/${encodeURIComponent(assignment.id)}?returnTo=${encodeURIComponent(returnTo)}`}
                    className={cn(LEDGER_ROW_CLASS, "flex min-h-15 items-center gap-3.5 py-2 md:px-1")}
                  >
                    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-secondary-foreground">
                      {assignment.mediaUrl
                        ? <Play className="size-3.5 fill-current" strokeWidth={1.6} />
                        : <FileText className="size-3.5" strokeWidth={1.6} />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-body font-medium">{describeAssignmentSubmission(assignment)}</span>
                      <span className="text-xs text-muted-foreground">
                        {submitted ? `${submitted} 제출` : "제출일 미정"} · 피드백 {assignment.feedbackCount}건
                      </span>
                    </span>
                    <StatusBadge status={assignment.feedbackCount > 0 ? "feedbackReady" : "feedbackWaiting"} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </LedgerSection>
    </div>
  );
}

async function QnaTabContent({ studentId, filter, query }: { studentId: string; filter: ReturnType<typeof resolveQnaFilter>; query: string }) {
  const rawThreads = await getQnaThreadsByStudent(studentId, query);
  const threads = rawThreads.map((t: RawQnaThread) => ({
    ...t,
    status: t.status as QnaStatus,
  }));

  return (
    <div className="max-w-[880px]">
      <ThreadList
        threads={threads}
        isAdmin={true}
        returnTo={buildAdminStudentDetailHref(studentId, "qna")}
        filter={filter}
        query={query}
        variant="chips"
      />
    </div>
  );
}

// ─── 메인 페이지 (RSC) ────────────────────────────

export const metadata = { title: "학생 상세" };

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; qnaStatus?: string | string[]; qnaQuery?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user || session.user.role !== "admin") redirect("/login");

  const { id: studentId } = await params;
  const { tab = "overview", qnaStatus, qnaQuery } = await searchParams;
  const activeTab: StudentDetailTab = resolveStudentDetailTab(tab);
  if (tab !== activeTab) redirect(buildAdminStudentDetailHref(studentId, activeTab));

  const student = await getStudentById(studentId);
  if (!student) redirect("/dashboard/admin");
  // 노트 탭은 검색·표/목록을 갖춘 학생 스페이스 노트 화면이 canonical이다(AdminStudentNotes 보드).
  if (activeTab === "notes") redirect(buildAdminStudentNotesHref(studentId));

  // Overview 탭 데이터는 미리 병렬 fetch
  const [modules, lessons, calendarFeedIssuedAt, accountState] = await (activeTab === "overview"
    ? Promise.all([
        // 커리큘럼이 숨겨져 있으면 읽지 않는다(src/lib/curriculum-visibility.ts).
        isCurriculumVisible() ? getCurriculumByStudent(studentId) : Promise.resolve([]),
        getLessonsByStudent(studentId),
        getStudentCalendarFeedIssuedAt(studentId),
        getStudentAccountState(studentId),
      ])
    : Promise.resolve([[], [], null, { kind: "active" }] as [
        Awaited<ReturnType<typeof getCurriculumByStudent>>,
        Awaited<ReturnType<typeof getLessonsByStudent>>,
        Date | null,
        Awaited<ReturnType<typeof getStudentAccountState>>,
      ]));
  // 만료·지난 레슨 판단은 서버 시각 하나로 정해 화면 hydration과 어긋나지 않게 한다.
  const referenceTime = new Date(getRequestNow());
  const account = accountState.kind === "invite"
    ? { ...accountState, expired: accountState.expiresAt.getTime() <= referenceTime.getTime() }
    : accountState;
  const name = student.displayName?.trim() || student.email;
  const initial = Array.from(name)[0]?.toUpperCase() ?? "학";

  return (
    <div className="px-5 pb-8 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <StudentDetailTopBar studentId={studentId} returnTo={buildAdminStudentDetailHref(studentId, activeTab)} />
      <div className="flex max-w-[1080px] flex-col md:gap-7">
        <nav aria-label="위치" className="hidden items-center gap-1.5 text-ui md:flex">
          <Link
            href="/dashboard/admin?section=students"
            className="rounded-sm text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            학생
          </Link>
          <span aria-hidden="true" className="text-faint">/</span>
          <span aria-current="page" className="min-w-0 truncate text-foreground">{name}</span>
        </nav>

        <header className="flex items-center gap-3.5 pb-4 pt-5 md:gap-4 md:p-0">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-selected text-lg font-semibold text-secondary-foreground"
          >
            {initial}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="break-words text-xl font-semibold tracking-title text-foreground md:text-2xl md:tracking-display">{name}</h1>
            <p className="break-all text-ui text-muted-foreground">{student.email}</p>
          </div>
        </header>

        <StudentDetailTabs studentId={studentId} activeTab={activeTab} className="-mx-5 px-5 md:mx-0 md:px-0" />

        <div className="pt-2 md:pt-0">
          {activeTab === "overview" && (
            <OverviewTab
              studentId={studentId}
              modules={modules}
              lessons={lessons}
              calendarFeedIssuedAt={calendarFeedIssuedAt}
              account={account}
              referenceTime={referenceTime}
            />
          )}

          {activeTab === "assignments" && (
            <Suspense fallback={<div className={cn(TAB_FALLBACK_CLASS, "h-40 max-w-[880px]")} />}>
              <AssignmentsTabContent studentId={studentId} referenceTime={referenceTime} />
            </Suspense>
          )}

          {activeTab === "digging" && (
            <Suspense fallback={<div className={cn(TAB_FALLBACK_CLASS, "h-64")} />}>
              <DiggingTabContent studentId={studentId} />
            </Suspense>
          )}

          {activeTab === "qna" && (
            <Suspense fallback={<div className={cn(TAB_FALLBACK_CLASS, "h-40 max-w-[880px]")} />}>
              <QnaTabContent studentId={studentId} filter={resolveQnaFilter(qnaStatus)} query={normalizeDocumentSearchQuery(qnaQuery)} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
