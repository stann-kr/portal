"use client";

import { PushPromptBanner } from "@/components/push/PushPromptBanner";
import { useRef, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Check, FileText } from "lucide-react";
import { setAssignmentReviewed } from "@/lib/actions/assignment-review";
import { buildLessonNoteLink, LESSON_NOTE_LINK_CLASS } from "@/lib/lesson-note-links";
import { buildAssignmentQueueHref } from "@/lib/admin-work-queue";
import { UndoToast, type UndoToastMessage } from "./UndoToast";
import {
  getAdminWorkQueue,
  type AdminQueueThread,
  type PendingFeedbackAssignment,
} from "@/lib/admin-work-queue";
import type { StudentRosterStat } from "@/lib/actions/students";
import { describeAssignmentSubmission } from "@/lib/unified-item-normalization";
import { formatKst } from "@/lib/kst-format";
import { buildQnaListHref } from "@/lib/qna-routes";
import { cn } from "@/lib/utils";
import { formatKstDot } from "@/lib/kst-format";
import { isCurriculumVisible } from "@/lib/curriculum-visibility";
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

/** 되돌리기 안내. assignmentId가 있으면 그 행의 확인을 되돌릴 수 있고, 오류 안내는 null이다. */
type AckToast = UndoToastMessage & { assignmentId: string | null };

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
  pushOwnerId,
  lessonNoteIds,
  setReviewed = setAssignmentReviewed,
}: {
  students: StudentRosterStat[];
  threads: AdminQueueThread[];
  pendingAssignments: PendingFeedbackAssignment[];
  referenceTime: Date;
  onOpenSchedule: () => void;
  /** 업무함 맨 위 "알림 받기" 줄의 계정. */
  pushOwnerId: string;
  /** "학생:KST 날짜" → 그 날짜 노트 id. 다가오는 레슨 행의 수업 노트 링크에 쓴다. */
  lessonNoteIds?: Readonly<Record<string, string>>;
  /** 확인함 표시·취소 action. 테스트가 바꿔 끼운다. */
  setReviewed?: typeof setAssignmentReviewed;
}) {
  // 확인함으로 표시한 제출은 서버 응답을 기다리지 않고 목록에서 뺀다(되돌리면 다시 보인다).
  const [acknowledgedIds, setAcknowledgedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [ackToast, setAckToast] = useState<AckToast | null>(null);
  const ackToastRef = useRef<AckToast | null>(null);
  // 다른 행의 되돌리기 안내가 떠 있는 동안 도착한 오류. 그 안내가 닫히거나 되돌리기를 누르면 보인다.
  const deferredError = useRef<AckToast | null>(null);
  const ackChains = useRef(new Map<string, Promise<unknown>>());
  // 행별 마지막 요청 번호. 늦게 도착한 앞선 요청의 결과는 행 상태·안내를 바꾸지 않는다.
  const latestRequest = useRef(new Map<string, number>());
  const ackButtons = useRef(new Map<string, HTMLButtonElement>());
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const toastSeq = useRef(0);
  const queue = getAdminWorkQueue(
    students,
    threads,
    pendingAssignments.filter((assignment) => !acknowledgedIds.has(assignment.id)),
    referenceTime,
  );
  const setAcknowledged = (assignmentId: string, hidden: boolean) => setAcknowledgedIds((current) => {
    const next = new Set(current);
    if (hidden) next.add(assignmentId);
    else next.delete(assignmentId);
    return next;
  });
  const showToast = (next: AckToast | null) => {
    ackToastRef.current = next;
    setAckToast(next);
  };
  const dismissToast = () => {
    const deferred = deferredError.current;
    deferredError.current = null;
    showToast(deferred);
  };
  const showError = (kind: "ack-error" | "undo-error", assignmentId: string, message: string) => {
    const error: AckToast = { key: `${kind}:${assignmentId}:${++toastSeq.current}`, assignmentId: null, message, tone: "error" };
    const current = ackToastRef.current;
    if (current?.assignmentId && current.assignmentId !== assignmentId) deferredError.current = error;
    else showToast(error);
  };
  // 같은 제출의 표시·취소 요청은 보낸 순서대로 처리하고, 결과는 그 행의 마지막 요청만 반영한다.
  const runReview = (assignmentId: string, reviewed: boolean) => {
    const seq = (latestRequest.current.get(assignmentId) ?? 0) + 1;
    latestRequest.current.set(assignmentId, seq);
    const previous = ackChains.current.get(assignmentId) ?? Promise.resolve();
    const request = previous.catch(() => undefined).then(() => setReviewed(assignmentId, reviewed));
    ackChains.current.set(assignmentId, request);
    return { request, isLatest: () => latestRequest.current.get(assignmentId) === seq };
  };
  const acknowledge = (assignment: PendingFeedbackAssignment, title: string) => {
    // 행이 사라지므로 focus를 다음 행의 확인 버튼(없으면 되돌리기)으로 옮긴다.
    const rows = queue.pendingAssignments;
    const index = rows.findIndex((row) => row.id === assignment.id);
    const nextId = rows[index + 1]?.id ?? rows[index - 1]?.id;
    setAcknowledged(assignment.id, true);
    showToast({ key: `ack:${assignment.id}:${++toastSeq.current}`, assignmentId: assignment.id, message: `'${title}'를 확인함으로 표시했습니다`, undoLabel: "되돌리기" });
    requestAnimationFrame(() => {
      const target = (nextId ? ackButtons.current.get(nextId) : null) ?? undoButtonRef.current;
      target?.focus();
    });
    const { request, isLatest } = runReview(assignment.id, true);
    const fail = (message: string) => {
      if (!isLatest()) return;
      setAcknowledged(assignment.id, false);
      showError("ack-error", assignment.id, message);
    };
    void request.then(
      (result) => {
        if (!result.success) fail(result.error);
      },
      () => fail("확인함으로 표시하지 못했습니다. 다시 시도해 주세요."),
    );
  };
  /**
   * 되돌리기는 안내에 남아 있는 마지막 확인 한 건만 취소한다. 안내가 보이는 사이 다른 행을 확인하면 안내가 새 행으로 바뀌고,
   * 앞 행은 확인함으로 남는다(서버에도 저장되어 사라지지 않으며, 과제 화면의 "확인 취소"로 되돌린다).
   * 앞 행의 저장이 그 사이 실패하면 앞 행은 바로 목록에 돌아오고, 오류 안내는 지금 안내가 닫힌 뒤 보인다.
   * 취소 저장이 실패하면 서버는 여전히 확인함이므로 행을 다시 빼고 이유를 알린다.
   */
  const undoAcknowledge = () => {
    const assignmentId = ackToast?.assignmentId;
    if (!assignmentId) return;
    dismissToast();
    setAcknowledged(assignmentId, false);
    requestAnimationFrame(() => ackButtons.current.get(assignmentId)?.focus());
    const { request, isLatest } = runReview(assignmentId, false);
    const fail = (message: string) => {
      if (!isLatest()) return;
      setAcknowledged(assignmentId, true);
      showError("undo-error", assignmentId, message);
    };
    void request.then(
      (result) => {
        if (!result.success) fail(result.error);
      },
      () => fail("확인 취소를 저장하지 못했습니다. 과제 화면에서 다시 시도해 주세요."),
    );
  };
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
      <div className="flex max-w-[1040px] flex-col gap-7 md:gap-10 md:mx-auto">
        <PushPromptBanner ownerId={pushOwnerId} isAdmin />
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
                <Link href={buildQnaListHref(WORK_QUEUE_PATH)} className={cn(LEDGER_HEADER_LINK_CLASS, "min-w-11 justify-end")}>
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
              <LedgerEmptyRow>피드백 대기가 없습니다. 모든 제출을 처리했습니다.</LedgerEmptyRow>
            ) : (
              <ul>
                {visiblePendingAssignments.map((assignment) => {
                  const submitted = formatKstDot(assignment.submittedAt, { referenceTime });
                  const title = describeAssignmentSubmission(assignment);
                  return (
                    <li key={assignment.id} className="flex items-center gap-2 border-b border-muted md:gap-3">
                      <Link
                        href={buildAssignmentQueueHref(assignment.id, WORK_QUEUE_PATH)}
                        className={cn(QUEUE_ROW_CLASS, "min-w-0 flex-1 border-b-0")}
                      >
                        <QueueRowTitle>{title}</QueueRowTitle>
                        <QueueRowStudent>{displayStudent(assignment)}</QueueRowStudent>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {submitted || "제출일 미정"}
                          {submitted ? <span className="md:sr-only"> 제출</span> : null}
                        </span>
                      </Link>
                      <button
                        ref={(node) => {
                          if (node) ackButtons.current.set(assignment.id, node);
                          else ackButtons.current.delete(assignment.id);
                        }}
                        type="button"
                        aria-label={`${title} 확인함으로 표시`}
                        onClick={() => acknowledge(assignment, title)}
                        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:mr-1 md:h-7"
                      >
                        <Check className="size-[13px]" strokeWidth={1.8} aria-hidden="true" />
                        확인
                      </button>
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
              <button type="button" className={cn(LEDGER_HEADER_LINK_CLASS, "min-w-11 justify-end")} onClick={onOpenSchedule}>
                일정 열기
              </button>
            }
          />
          {queue.upcomingLessons.length === 0 ? (
            <LedgerEmptyRow>7일 이내 레슨이 없습니다. 일정 화면에서 학생별 캘린더를 확인할 수 있습니다.</LedgerEmptyRow>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(400px,100%),1fr))] gap-x-14">
              {queue.upcomingLessons.map((student) => (
                <li key={student.id} className="flex min-w-0 items-center gap-2 border-b border-muted">
                  <Link
                    href={`/dashboard/admin/students/${student.id}`}
                    className={cn(LEDGER_ROW_CLASS, "flex h-12 min-w-0 flex-1 items-center gap-3 border-b-0 md:h-13 md:px-1")}
                  >
                    <span className="w-29 shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-secondary-foreground md:w-33">
                      {formatKstDot(student.nextLessonDate, { weekday: true, time: true, referenceTime })}
                    </span>
                    <span className="shrink-0 text-md font-medium md:text-body">
                      {student.displayName?.trim() || student.email}
                    </span>
                    {/* 현재 진도는 커리큘럼 숨김 스위치가 켜졌을 때만 보인다. */}
                    {isCurriculumVisible() ? (
                      <span className="min-w-0 truncate text-ui text-muted-foreground">
                        {student.currentModule || "진도 미지정"}
                      </span>
                    ) : null}
                  </Link>
                  {lessonNoteIds && student.nextLessonDate ? (() => {
                    const link = buildLessonNoteLink({
                      studentId: student.id,
                      lessonAt: student.nextLessonDate,
                      noteIds: lessonNoteIds,
                      returnTo: WORK_QUEUE_PATH,
                    });
                    const name = student.displayName?.trim() || student.email;
                    return (
                      <Link
                        href={link.href}
                        aria-label={`${name} ${formatKstDot(student.nextLessonDate, { referenceTime })} ${link.existing ? "수업 노트 열기" : "수업 노트 쓰기"}`}
                        className={cn(LESSON_NOTE_LINK_CLASS, "md:mr-1")}
                      >
                        <FileText className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                        {link.existing ? "노트 열기" : "수업 노트"}
                      </Link>
                    );
                  })() : null}
                </li>
              ))}
            </ul>
          )}
        </LedgerSection>
      </div>
      <UndoToast
        ref={undoButtonRef}
        toast={ackToast}
        onUndo={ackToast?.assignmentId ? undoAcknowledge : undefined}
        onDismiss={dismissToast}
      />
    </div>
  );
}
