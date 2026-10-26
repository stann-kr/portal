"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  getAdminWorkQueue,
  type AdminQueueThread,
  type PendingFeedbackAssignment,
} from "@/lib/admin-work-queue";
import type { StudentRosterStat } from "@/lib/actions/students";
import { describeAssignmentMedia } from "@/lib/unified-item-normalization";
import { formatKst } from "@/lib/kst-format";
import { buildQnaListHref } from "@/lib/qna-routes";
import { cn } from "@/lib/utils";
import { formatKstDot } from "@/components/student-portal/today/format";
import {
  LEDGER_ADD_ROW_CLASS,
  LEDGER_HEADER_LINK_CLASS,
  LEDGER_HEADER_NOTE_CLASS,
  LEDGER_ROW_CLASS,
  LedgerEmptyRow,
  LedgerSection,
  LedgerSectionHeader,
} from "@/components/student-portal/today/HomeSection";

const QUEUE_PREVIEW_COUNT = 5;
const WORK_QUEUE_PATH = "/dashboard/admin?section=work";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function formatDay(date: Date) {
  return formatKst(date, { month: "long", day: "numeric", weekday: "long" });
}

/** 질문이 답을 기다린 시간: 하루 이상은 일, 그 아래는 시간(1시간 미만은 1시간). */
function formatWaiting(since: Date | null | undefined, referenceTime: Date): string | null {
  if (!since) return null;
  const elapsed = Math.max(0, referenceTime.getTime() - since.getTime());
  if (elapsed >= DAY_MS) return `${Math.floor(elapsed / DAY_MS)}일`;
  return `${Math.max(1, Math.floor(elapsed / HOUR_MS))}시간`;
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

/**
 * 업무함 목록 행(AdminWork·MobileAdminWork 보드): 넓은 화면은 학생(56px) · 제목 · 값 한 줄 52px,
 * 좁은 화면은 제목 아래 학생과 값 두 줄. DOM은 제목 → 학생 → 값 순서로 읽힌다.
 */
const QUEUE_ROW_CLASS = cn(
  LEDGER_ROW_CLASS,
  "flex flex-wrap items-center gap-x-2 gap-y-0.5 py-3 md:h-13 md:flex-nowrap md:gap-x-3 md:px-1 md:py-0",
);

function QueueRowTitle({ children, truncate = true }: { children: ReactNode; truncate?: boolean }) {
  return (
    <span className={cn("min-w-0 basis-full text-md md:flex-1 md:basis-auto md:text-body", truncate && "truncate")}>
      {children}
    </span>
  );
}

function QueueRowStudent({ children }: { children: ReactNode }) {
  return (
    <span className="truncate text-ui text-secondary-foreground md:order-first md:w-14 md:shrink-0">{children}</span>
  );
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
    { label: "7일 내 레슨", value: queue.metrics.upcomingLessonCount },
    { label: "전체 학생", value: queue.metrics.studentCount },
  ];

  return (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <div className="flex max-w-[1040px] flex-col gap-7 md:gap-10">
        <header className="flex flex-col gap-1.5 md:gap-2">
          <p className="font-mono text-xs text-muted-foreground">{formatDay(referenceTime)}</p>
          <h1 className="text-mobile-title font-semibold tracking-display text-foreground md:text-display">오늘 처리할 일</h1>
          <dl className="mt-[22px] grid grid-cols-2 gap-x-5 border-t border-border md:mt-2 md:flex md:flex-wrap md:gap-x-7 md:gap-y-2 md:border-0">
            {metrics.map((metric) => (
              <div
                key={metric.label}
                className="flex flex-col gap-0.5 border-b border-muted py-3 md:flex-row md:gap-2 md:border-0 md:py-0 md:text-ui"
              >
                <dt className="text-xs text-muted-foreground md:text-ui">{metric.label}</dt>
                <dd className="font-mono text-xl font-medium tabular-nums text-foreground md:text-ui">{metric.value}</dd>
              </div>
            ))}
          </dl>
        </header>

        <div className="flex flex-col gap-7 md:flex-row md:flex-wrap md:gap-x-14 md:gap-y-10">
          <LedgerSection labelledBy="open-qna-heading" className="md:flex-[1_1_400px]">
            <LedgerSectionHeader
              id="open-qna-heading"
              title="미답변 Q&A"
              count={<span className="md:hidden">{queue.metrics.openThreadCount}</span>}
              aside={
                <Link href={buildQnaListHref(WORK_QUEUE_PATH)} className={cn(LEDGER_HEADER_LINK_CLASS, "hidden md:flex")}>
                  전체 Q&A
                </Link>
              }
            />
            {queue.openThreads.length === 0 ? (
              <LedgerEmptyRow>미답변 질문이 없습니다. 현재 모든 질문에 답변했습니다.</LedgerEmptyRow>
            ) : (
              <ul>
                {queue.openThreads.map((thread) => {
                  // 정렬 기준(마지막 활동 시각)과 같은 값으로 기다린 시간을 센다.
                  const waiting = formatWaiting(thread.updatedAt ?? thread.createdAt, referenceTime);
                  return (
                    <li key={thread.id}>
                      <Link
                        href={`/dashboard/qna/${thread.id}?returnTo=${encodeURIComponent(WORK_QUEUE_PATH)}`}
                        className={QUEUE_ROW_CLASS}
                      >
                        <QueueRowTitle>{thread.title}</QueueRowTitle>
                        <QueueRowStudent>{displayStudent(thread)}</QueueRowStudent>
                        {waiting ? (
                          <span className="shrink-0 font-mono text-xs text-warning">
                            {waiting}
                            <span className="md:sr-only"> 대기</span>
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {queue.metrics.openThreadCount > queue.openThreads.length ? (
              <Link href={buildQnaListHref(WORK_QUEUE_PATH, "OPEN")} className={LEDGER_ADD_ROW_CLASS}>
                미답변 {queue.metrics.openThreadCount}건 모두 보기
              </Link>
            ) : null}
          </LedgerSection>

          <LedgerSection labelledBy="pending-feedback-heading" className="md:flex-[1_1_400px]">
            <LedgerSectionHeader
              id="pending-feedback-heading"
              title="피드백 대기"
              count={<span className="md:hidden">{queue.metrics.pendingFeedbackCount}</span>}
              aside={<span className={cn(LEDGER_HEADER_NOTE_CLASS, "hidden md:inline")}>오래된 순</span>}
            />
            {queue.pendingAssignments.length === 0 ? (
              <LedgerEmptyRow>피드백 대기가 없습니다. 현재 모든 제출에 피드백이 등록됐습니다.</LedgerEmptyRow>
            ) : (
              <ul>
                {visiblePendingAssignments.map((assignment) => {
                  const submitted = formatKstDot(assignment.submittedAt, { referenceTime });
                  return (
                    <li key={assignment.id}>
                      <Link
                        href={`/dashboard/student/assignments/${encodeURIComponent(assignment.id)}?returnTo=${encodeURIComponent(WORK_QUEUE_PATH)}`}
                        className={QUEUE_ROW_CLASS}
                      >
                        <QueueRowTitle>{describeAssignmentMedia(assignment.mediaUrl)}</QueueRowTitle>
                        <QueueRowStudent>{displayStudent(assignment)}</QueueRowStudent>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {submitted || "제출일 미정"}
                          {submitted ? <span className="md:sr-only"> 제출</span> : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {queue.pendingAssignments.length > QUEUE_PREVIEW_COUNT ? (
              <button
                type="button"
                className={LEDGER_ADD_ROW_CLASS}
                aria-expanded={showAllPending}
                onClick={() => setShowAllPending((value) => !value)}
              >
                {showAllPending ? "처음 5건만 보기" : `나머지 ${hiddenPendingCount}건 더 보기`}
              </button>
            ) : null}
          </LedgerSection>
        </div>

        <LedgerSection labelledBy="upcoming-lesson-heading">
          <LedgerSectionHeader
            id="upcoming-lesson-heading"
            title="다가오는 레슨"
            aside={
              <button type="button" className={cn(LEDGER_HEADER_LINK_CLASS, "hidden md:flex")} onClick={onOpenSchedule}>
                일정 열기
              </button>
            }
          />
          {queue.upcomingLessons.length === 0 ? (
            <LedgerEmptyRow>7일 이내 레슨이 없습니다. 일정 화면에서 학생별 캘린더를 확인할 수 있습니다.</LedgerEmptyRow>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(400px,100%),1fr))] gap-x-14">
              {queue.upcomingLessons.map((student) => (
                <li key={student.id} className="min-w-0">
                  <Link
                    href={`/dashboard/admin/students/${student.id}`}
                    className={cn(LEDGER_ROW_CLASS, "flex h-12 items-center gap-3 md:h-13 md:px-1")}
                  >
                    <span className="w-29 shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-secondary-foreground md:w-33">
                      {formatKstDot(student.nextLessonDate, { weekday: true, time: true, referenceTime })}
                    </span>
                    <span className="shrink-0 text-md font-medium md:text-body">
                      {student.displayName?.trim() || student.email}
                    </span>
                    <span className="min-w-0 truncate text-ui text-muted-foreground">
                      {student.currentModule || "진도 미지정"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </LedgerSection>
      </div>
    </div>
  );
}
