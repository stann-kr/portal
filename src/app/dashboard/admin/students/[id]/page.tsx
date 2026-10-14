/**
 * @file src/app/dashboard/admin/students/[id]/page.tsx
 * @description 학생 상세 페이지 (Admin 전용) — RSC 탭 통합 뷰.
 * URL searchParams(?tab=xxx)로 Overview / Digging / Notes / Q&A 전환.
 * 각 탭은 서버에서 데이터를 병렬 fetch하여 렌더링.
 */
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getStudentAccountState, getStudentById } from "@/lib/actions/students";
import { getCurriculumByStudent } from "@/lib/actions/curriculum";
import { getLessonsByStudent } from "@/lib/actions/lessons";
import { getOrSeedColumns, getDiggingTracks } from "@/lib/actions/digging";
import { getQnaThreadsByStudent } from "@/lib/actions/qna";
import { getAssignmentSummariesByStudent } from "@/lib/actions/assignments";
import { getStudentCalendarFeedIssuedAt } from "@/lib/actions/calendarFeed";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatKst } from "@/lib/kst-format";
import { describeAssignmentMedia } from "@/lib/unified-item-normalization";
import { StudentDetailTabs } from "@/components/admin/StudentDetailTabs";
import { OverviewTab } from "@/components/admin/OverviewTab";
import { DiggingBoard } from "@/components/digging/DiggingBoard";
import { ThreadList } from "@/components/qna/ThreadList";
import { resolveQnaFilter } from "@/lib/qna-routes";
import { normalizeDocumentSearchQuery } from "@/lib/document-search";
import { BookOpen, ChevronRight, Radio } from "lucide-react";
import Link from "next/link";
import type { DiggingColumnType, QnaStatus } from "@/db/schema";
import { ArrowLeft } from "lucide-react";
import {
  buildAdminStudentDetailHref,
  resolveStudentDetailTab,
  type StudentDetailTab,
} from "@/lib/student-space-routes";

type RawColumn = Awaited<ReturnType<typeof getOrSeedColumns>>[number];
type RawQnaThread = Awaited<ReturnType<typeof getQnaThreadsByStudent>>[number];

// ─── 탭별 콘텐츠 ───────────────────────────────────

async function DiggingTabContent({ studentId }: { studentId: string }) {
  const [columns, tracks] = await Promise.all([
    getOrSeedColumns(studentId),
    getDiggingTracks(studentId),
  ]);

  return (
    <DiggingBoard
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
  );
}

async function AssignmentsTabContent({ studentId }: { studentId: string }) {
  const summaries = await getAssignmentSummariesByStudent(studentId);
  const returnTo = buildAdminStudentDetailHref(studentId, "assignments");

  if (summaries.length === 0) {
    return (
      <EmptyState
        title="제출한 믹스셋이 없습니다"
        description="학생이 워크스페이스의 과제 탭에서 YouTube나 SoundCloud 링크를 제출하면 이곳에 표시됩니다."
        icon={<Radio className="size-4" aria-hidden="true" />}
      />
    );
  }

  return (
    <ul className="overflow-hidden rounded-lg border border-border bg-surface" aria-label="제출한 믹스셋">
      {summaries.map((assignment, index) => (
        <li key={assignment.id} className={index > 0 ? "border-t border-border" : undefined}>
          <Link
            href={`/dashboard/student/assignments/${encodeURIComponent(assignment.id)}?returnTo=${encodeURIComponent(returnTo)}`}
            className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted focus-visible:bg-muted sm:px-5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{describeAssignmentMedia(assignment.mediaUrl)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatKst(assignment.submittedAt, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }, "제출일 미정")} 제출
                {assignment.feedbackCount > 0 ? ` · 피드백 ${assignment.feedbackCount}건` : ""}
              </p>
            </div>
            <StatusBadge status={assignment.feedbackCount > 0 ? "feedbackReady" : "feedbackWaiting"} />
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NotesTabContent({ studentId }: { studentId: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <BookOpen className="size-5 text-primary" aria-hidden="true" />
      <h2 className="mt-3 text-lg font-semibold">노트는 별도 목록에서 관리합니다</h2>
      <p className="mt-1 text-sm text-muted-foreground">작성과 탐색을 분리해 학생 스페이스와 기록 문맥을 넓게 확인할 수 있습니다.</p>
      <Link href={`/dashboard/admin/students/${studentId}/notes`} className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">학생 노트 목록 열기</Link>
    </section>
  );
}

async function QnaTabContent({ studentId, filter, query }: { studentId: string; filter: ReturnType<typeof resolveQnaFilter>; query: string }) {
  const rawThreads = await getQnaThreadsByStudent(studentId, query);
  const threads = rawThreads.map((t: RawQnaThread) => ({
    ...t,
    status: t.status as QnaStatus,
  }));

  return (
    <ThreadList
      threads={threads}
      isAdmin={true}
      returnTo={`/dashboard/admin/students/${studentId}?tab=qna`}
      filter={filter}
      query={query}
    />
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

  // Overview 탭 데이터는 미리 병렬 fetch
  const [modules, lessons, calendarFeedIssuedAt, accountState] = await (activeTab === "overview"
    ? Promise.all([
        getCurriculumByStudent(studentId),
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
  // 만료 판단은 서버 시각 하나로 정해 화면 hydration과 어긋나지 않게 한다.
  const account = accountState.kind === "invite"
    ? { ...accountState, expired: accountState.expiresAt.getTime() <= Date.now() }
    : accountState;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      {/* 학생 헤더 */}
      <div className="space-y-1">
        <Link href="/dashboard/admin?section=students" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />학생 목록으로 돌아가기
        </Link>
        <h1 className="break-words text-2xl font-semibold tracking-tight text-foreground">
          {student.displayName ?? student.email}
        </h1>
        <p className="mt-0.5 break-all text-sm text-muted-foreground">{student.email}</p>
      </div>

      {/* 탭 네비게이션 */}
      <StudentDetailTabs studentId={studentId} activeTab={activeTab} />

      {/* 탭 콘텐츠 */}
      <div className="pt-2">
        {activeTab === "overview" && (
          <OverviewTab
            studentId={studentId}
            modules={modules}
            lessons={lessons}
            calendarFeedIssuedAt={calendarFeedIssuedAt}
            account={account}
          />
        )}

        {activeTab === "assignments" && (
          <Suspense
            fallback={
              <div className="h-40 rounded-lg border bg-card animate-pulse motion-reduce:animate-none" />
            }
          >
            <AssignmentsTabContent studentId={studentId} />
          </Suspense>
        )}

        {activeTab === "digging" && (
          <Suspense
            fallback={
              <div className="h-64 rounded-xl border bg-card animate-pulse" />
            }
          >
            <DiggingTabContent studentId={studentId} />
          </Suspense>
        )}

        {activeTab === "notes" && (
          <Suspense
            fallback={
              <div className="h-64 rounded-xl border bg-card animate-pulse" />
            }
          >
            <NotesTabContent studentId={studentId} />
          </Suspense>
        )}

        {activeTab === "qna" && (
          <Suspense
            fallback={
              <div className="h-40 rounded-xl border bg-card animate-pulse" />
            }
          >
            <QnaTabContent studentId={studentId} filter={resolveQnaFilter(qnaStatus)} query={normalizeDocumentSearchQuery(qnaQuery)} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
