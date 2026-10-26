"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CalendarClock,
  FileVideo,
  MessageCircleQuestion,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  getAdminWorkQueue,
  type AdminQueueThread,
  type PendingFeedbackAssignment,
} from "@/lib/admin-work-queue";
import type { StudentRosterStat } from "@/lib/actions/students";
import { describeAssignmentMedia } from "@/lib/unified-item-normalization";
import { formatKst } from "@/lib/kst-format";
import { buildQnaListHref } from "@/lib/qna-routes";

const QUEUE_PREVIEW_COUNT = 5;
const WORK_QUEUE_PATH = "/dashboard/admin?section=work";

function formatDay(date: Date) {
  return formatKst(date, { month: "long", day: "numeric", weekday: "long" });
}

function formatDateTime(date: Date | null | undefined) {
  return formatKst(
    date,
    { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" },
    "시간 미정",
  );
}

const ROW_CLASS =
  "flex min-w-0 items-start gap-3 rounded-md px-2 py-2 text-sm transition-colors duration-[var(--duration-fast)] hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";
const ACTION_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** 학생 홈과 같은 조용한 소제목 + 얇은 구분선 구역. */
function QueueSection({
  id,
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="mb-1.5 flex min-h-8 items-center justify-between gap-3 border-b border-border pb-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 id={id} className="flex shrink-0 items-center gap-1.5 self-center text-sm font-medium text-muted-foreground">
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {title}
          </h2>
          <p className="hidden truncate text-xs text-muted-foreground/80 sm:block">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-2 py-2 text-sm text-muted-foreground">{children}</p>;
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
  onOpenSchedule,
}: {
  students: StudentRosterStat[];
  threads: AdminQueueThread[];
  pendingAssignments: PendingFeedbackAssignment[];
  referenceTime: Date;
  onOpenSchedule: () => void;
}) {
  const queue = getAdminWorkQueue(
    students,
    threads,
    pendingAssignments,
    referenceTime,
  );
  const [showAllPending, setShowAllPending] = useState(false);
  const visiblePendingAssignments = showAllPending
    ? queue.pendingAssignments
    : queue.pendingAssignments.slice(0, QUEUE_PREVIEW_COUNT);
  const hiddenPendingCount = queue.pendingAssignments.length - visiblePendingAssignments.length;
  const metrics = [
    { label: "미답변 질문", value: queue.metrics.openThreadCount },
    { label: "피드백 대기", value: queue.metrics.pendingFeedbackCount },
    { label: "7일 이내 레슨", value: queue.metrics.upcomingLessonCount },
    { label: "전체 학생", value: queue.metrics.studentCount },
  ];

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{formatDay(referenceTime)}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-foreground">오늘 처리할 일</h1>
          </div>
          <Link href="/dashboard/admin/operations" className={`${ACTION_CLASS} h-8 px-2.5 text-sm`}>
            <Settings2 className="size-3.5" aria-hidden="true" />
            운영 도구
          </Link>
        </div>

        <dl className="flex flex-wrap gap-1.5">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-sm"
            >
              <dt className="text-muted-foreground">{metric.label}</dt>
              <dd className="font-mono font-semibold tabular-nums text-foreground">{metric.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
        <QueueSection
          id="open-qna-heading"
          title="미답변 Q&A"
          description="오래 기다린 질문부터 표시합니다."
          icon={MessageCircleQuestion}
          action={
            <Link href={buildQnaListHref(WORK_QUEUE_PATH)} className={ACTION_CLASS}>
              전체 Q&A
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          }
        >
          {queue.openThreads.length === 0 ? (
            <EmptyRow>미답변 질문이 없습니다. 현재 모든 질문에 답변했습니다.</EmptyRow>
          ) : (
            <ul className="space-y-0.5">
              {queue.openThreads.map((thread) => (
                <li key={thread.id}>
                  <Link
                    href={`/dashboard/qna/${thread.id}?returnTo=${encodeURIComponent(WORK_QUEUE_PATH)}`}
                    className={ROW_CLASS}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 break-words text-foreground sm:line-clamp-1">{thread.title}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground sm:truncate">
                        {displayStudent(thread)} · {formatDateTime(thread.updatedAt ?? thread.createdAt)}
                      </span>
                    </span>
                    <StatusBadge status="qnaOpen" className="shrink-0 px-1.5 py-0.5 font-medium" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {queue.metrics.openThreadCount > queue.openThreads.length ? (
            <Link href={buildQnaListHref(WORK_QUEUE_PATH, "OPEN")} className={`${ACTION_CLASS} mt-1`}>
              미답변 {queue.metrics.openThreadCount}건 모두 보기
            </Link>
          ) : null}
        </QueueSection>

        <QueueSection
          id="pending-feedback-heading"
          title="피드백 대기"
          description="오래된 제출부터 표시합니다."
          icon={FileVideo}
        >
          {queue.pendingAssignments.length === 0 ? (
            <EmptyRow>피드백 대기가 없습니다. 현재 모든 제출에 피드백이 등록됐습니다.</EmptyRow>
          ) : (
            <ul className="space-y-0.5">
              {visiblePendingAssignments.map((assignment) => (
                <li key={assignment.id}>
                  <Link
                    href={`/dashboard/student/assignments/${encodeURIComponent(assignment.id)}?returnTo=${encodeURIComponent(WORK_QUEUE_PATH)}`}
                    className={ROW_CLASS}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{displayStudent(assignment)}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground sm:truncate">
                        {describeAssignmentMedia(assignment.mediaUrl)} · {formatDateTime(assignment.submittedAt)} 제출
                      </span>
                    </span>
                    <StatusBadge status="feedbackWaiting" className="shrink-0 px-1.5 py-0.5 font-medium" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {queue.pendingAssignments.length > QUEUE_PREVIEW_COUNT ? (
            <button
              type="button"
              className={`${ACTION_CLASS} mt-1`}
              aria-expanded={showAllPending}
              onClick={() => setShowAllPending((value) => !value)}
            >
              {showAllPending ? "처음 5건만 보기" : `나머지 ${hiddenPendingCount}건 더 보기`}
            </button>
          ) : null}
        </QueueSection>
      </div>

      <QueueSection
        id="upcoming-lesson-heading"
        title="다가오는 레슨"
        description="앞으로 7일 이내에 예정된 레슨입니다."
        icon={CalendarClock}
        action={
          <button type="button" className={ACTION_CLASS} onClick={onOpenSchedule}>
            일정 열기
            <ArrowRight className="size-3" aria-hidden="true" />
          </button>
        }
      >
        {queue.upcomingLessons.length === 0 ? (
          <EmptyRow>7일 이내 레슨이 없습니다. 일정 화면에서 학생별 캘린더를 확인할 수 있습니다.</EmptyRow>
        ) : (
          <ul className="grid gap-x-6 gap-y-0.5 md:grid-cols-2">
            {queue.upcomingLessons.map((student) => (
              <li key={student.id} className="min-w-0">
                <Link href={`/dashboard/admin/students/${student.id}`} className={ROW_CLASS}>
                  <span className="w-[7.5rem] shrink-0 pt-px font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(student.nextLessonDate)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">
                      {student.displayName?.trim() || student.email}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {student.currentModule || "진도 미지정"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueueSection>
    </div>
  );
}
