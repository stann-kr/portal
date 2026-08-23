import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  getAdminWorkQueue,
  type AdminQueueThread,
  type PendingFeedbackAssignment,
} from "@/lib/admin-work-queue";
import type { StudentRosterStat } from "@/lib/actions/students";
import { MediaCleanupControl } from "./MediaCleanupControl";
import { AccountErasureCleanupControl } from "./AccountErasureCleanupControl";

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatDateTime(date: Date | null | undefined) {
  if (!date) return "시간 미정";

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function displayStudent({
  studentName,
  studentEmail,
}: {
  studentName: string | null | undefined;
  studentEmail: string | null | undefined;
}) {
  return studentName?.trim() || studentEmail?.split("@")[0] || "이름 미등록";
}

export function AdminWorkQueueSection({
  students,
  threads,
  pendingAssignments,
  referenceTime,
  onOpenStudents,
  onOpenSchedule,
}: {
  students: StudentRosterStat[];
  threads: AdminQueueThread[];
  pendingAssignments: PendingFeedbackAssignment[];
  referenceTime: Date;
  onOpenStudents: () => void;
  onOpenSchedule: () => void;
}) {
  const queue = getAdminWorkQueue(
    students,
    threads,
    pendingAssignments,
    referenceTime,
  );
  const metrics = [
    { label: "미답변 질문", value: queue.metrics.openThreadCount },
    { label: "피드백 대기", value: queue.metrics.pendingFeedbackCount },
    { label: "7일 이내 레슨", value: queue.metrics.upcomingLessonCount },
    { label: "전체 학생", value: queue.metrics.studentCount },
  ];

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div>
        <p className="text-sm text-muted-foreground">{formatDay(referenceTime)}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-3xl">
          오늘 처리할 일
        </h1>
      </div>

      <dl className="grid grid-cols-2 border-y border-border md:grid-cols-4">
        {metrics.map((metric, index) => (
          <div
            key={metric.label}
            className={`py-4 ${
              index % 2 === 1 ? "pl-4" : "pr-4"
            } ${index >= 2 ? "border-t border-border md:border-t-0" : ""} ${
              index > 0 ? "md:border-l md:border-border md:px-5" : ""
            }`}
          >
            <dt className="text-xs font-medium text-muted-foreground">{metric.label}</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
        <section aria-labelledby="open-qna-heading" className="min-w-0">
          <SectionHeader
            title="미답변 Q&A"
            description="오래 기다린 질문부터 표시합니다."
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard/qna">전체 Q&A</Link>
              </Button>
            }
            className="mb-4"
          />
          {queue.openThreads.length === 0 ? (
            <EmptyState
              title="미답변 질문이 없습니다"
              description="현재 모든 질문에 답변했습니다."
              icon={<CheckCircle2 className="size-4" aria-hidden="true" />}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              {queue.openThreads.map((thread, index) => (
                <Link
                  key={thread.id}
                  href={`/dashboard/qna/${thread.id}?returnTo=%2Fdashboard%2Fadmin%3Fsection%3Dwork`}
                  className={`flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted focus-visible:bg-muted sm:px-5 ${
                    index > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {thread.title}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {displayStudent(thread)} / {formatDateTime(thread.updatedAt ?? thread.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status="qnaOpen" />
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="pending-feedback-heading" className="min-w-0">
          <SectionHeader
            title="피드백 대기"
            description="오래된 제출부터 표시합니다."
            className="mb-4"
          />
          {queue.pendingAssignments.length === 0 ? (
            <EmptyState
              title="피드백 대기가 없습니다"
              description="현재 모든 제출에 피드백이 등록됐습니다."
              icon={<CheckCircle2 className="size-4" aria-hidden="true" />}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              {queue.pendingAssignments.map((assignment, index) => (
                <Link
                  key={assignment.id}
                  href={`/dashboard/student/assignments/${assignment.id}`}
                  className={`flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted focus-visible:bg-muted sm:px-5 ${
                    index > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {displayStudent(assignment)}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {formatDateTime(assignment.submittedAt)} / {assignment.mediaUrl}
                    </p>
                  </div>
                  <StatusBadge status="feedbackWaiting" />
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="upcoming-lesson-heading">
        <SectionHeader
          title="다가오는 레슨"
          description="앞으로 7일 이내에 예정된 레슨입니다."
          action={
            <Button type="button" variant="ghost" size="sm" onClick={onOpenSchedule}>
              일정 열기
            </Button>
          }
          className="mb-4"
        />
        {queue.upcomingLessons.length === 0 ? (
          <EmptyState
            title="7일 이내 레슨이 없습니다"
            description="일정 화면에서 학생별 캘린더를 확인할 수 있습니다."
            icon={<CalendarClock className="size-4" aria-hidden="true" />}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {queue.upcomingLessons.map((student) => (
              <Link
                key={student.id}
                href={`/dashboard/admin/students/${student.id}`}
                className="group rounded-lg border border-border bg-surface px-4 py-4 transition-[border-color,background-color,transform] hover:border-primary/30 hover:bg-accent/40 active:translate-y-px"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {student.displayName?.trim() || student.email}
                    </p>
                    <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(student.nextLessonDate)}
                    </p>
                  </div>
                  <StatusBadge status="lessonUpcoming" />
                </div>
                <p className="mt-3 truncate text-xs text-muted-foreground">
                  {student.currentModule || "진도 미지정"}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <MediaCleanupControl />
      <AccountErasureCleanupControl />

      <div className="flex flex-col items-start justify-between gap-3 rounded-lg bg-accent px-5 py-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-surface text-primary">
            <Radio className="size-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-accent-foreground">학생 기록 살펴보기</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              진도, 노트, 디깅, Q&A를 학생별로 확인합니다.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={onOpenStudents}>
          학생 열기
        </Button>
      </div>
    </div>
  );
}
