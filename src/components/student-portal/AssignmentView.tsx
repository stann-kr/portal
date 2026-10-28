/**
 * @file src/components/student-portal/AssignmentView.tsx
 * @description 과제 뷰(Assignments·MobileAssignments 보드).
 * 위: 관리자가 낸 받은 과제(상태·마감과 형식별 제출·수정 폼). 아래: 기존 자유 믹스셋 제출 폼과 자유 제출 목록.
 * 목록 행은 과제 상세(피드백) 화면으로 이동한다. RSC에서 받은 초기 목록을 클라이언트 상태로 관리한다.
 */
"use client";

import { useState, useActionState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, FilePlay, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  submitAssignment,
  getMyAssignments,
  type SubmitAssignmentState,
} from "@/lib/actions/assignments";
import {
  getMyAssignmentTasks,
  submitAssignmentTask,
  updateMyTaskSubmission,
  type AssignmentTaskActionState,
  type AssignmentTaskItem,
} from "@/lib/actions/assignmentTasks";
import { getMyFeedbacksMap } from "@/lib/actions/feedbacks";
import { EmptyState } from "@/components/ui/empty-state";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { describeAssignmentSubmission } from "@/lib/unified-item-normalization";
import { toStudentAssignmentSummaries, type StudentAssignmentSummary } from "@/lib/assignment-summary";
import { ASSIGNMENT_FORMAT_LABELS } from "@/lib/assignment-recurrence";
import {
  ASSIGNMENT_TASK_STATUS_LABELS,
  ASSIGNMENT_TEXT_MAX_LENGTH,
  ASSIGNMENT_TEXT_MAX_LENGTH_LABEL,
  htmlToPlainText,
  isLateSubmission,
  type AssignmentTaskStatus,
} from "@/lib/assignment-submission";
import { formatKstDot } from "@/lib/kst-format";
import { getPortalStatus, STATUS_TONE_DOT_CLASS_NAMES, type PortalStatusTone } from "@/lib/portal-status";
import { STUDENT_LEGACY_REDIRECTS } from "@/lib/legacy-dashboard-routes";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useHasPassed } from "@/lib/hooks/useHasPassed";
import { mediaSourceLabel } from "@/components/player/media-source";
import { cn } from "@/lib/utils";

// ── 타입 ──────────────────────────────────────────

interface AssignmentViewProps {
  /** 지금 학생(작성자) ID. 글 제출 초안을 계정별로 격리한다. */
  actorId: string;
  initialAssignments: StudentAssignmentSummary[];
  initialTasks?: AssignmentTaskItem[];
  /**
   * true면 이 화면이 캔버스 머리(h1·요약)와 본문 여백·최대 폭을 직접 그린다.
   * 워크스페이스가 자기 머리(h1)를 그리는 동안은 false로 두어 요약과 본문만 그린다.
   */
  pageHeader?: boolean;
}

// ── 헬퍼 ─────────────────────────────────────────

const ASSIGNMENT_LIST_HREF = STUDENT_LEGACY_REDIRECTS.assignments;
const TEXTAREA_CLASS =
  "min-h-32 w-full resize-y rounded-touch border border-input bg-background px-3 py-2 text-base leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:rounded-md md:text-body";

const TASK_STATUS_TONE: Record<AssignmentTaskStatus, PortalStatusTone> = {
  open: "neutral",
  overdue: "destructive",
  submitted: "warning",
  reviewed: "success",
};

function assignmentDetailHref(id: string): string {
  return `/dashboard/student/assignments/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(ASSIGNMENT_LIST_HREF)}`;
}

/** 목록의 제출 시각(Mono): 월·일과 24시간 시각. */
function formatSubmittedAt(date: Date | null): string {
  // 캔버스 목록의 점 날짜 "10.23 21:40"(올해가 아니면 연도를 붙인다).
  return date ? formatKstDot(date, { time: true, referenceTime: new Date() }) || "제출일 미정" : "제출일 미정";
}

function formatDue(dueAt: Date | null): string {
  return dueAt ? `${formatKstDot(dueAt, { weekday: true, time: true, referenceTime: new Date() })} 마감` : "마감 없음";
}

function StatusDot({ tone, label }: { tone: PortalStatusTone; label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ui text-secondary-foreground">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", STATUS_TONE_DOT_CLASS_NAMES[tone])} />
      {label}
    </span>
  );
}

// ── 자유 제출 폼 ─────────────────────────────────

function SubmitForm({
  inputRef,
  onSuccess,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSuccess: () => Promise<void>;
}) {
  const [mediaUrl, setMediaUrl] = useState("");
  const [state, action, isPending] = useActionState<SubmitAssignmentState, FormData>(
    async (previous, data) => {
      let result: SubmitAssignmentState;
      try {
        result = await submitAssignment(previous, data);
      } catch {
        return { error: "제출 결과를 확인하지 못했습니다. 목록을 확인한 뒤 다시 시도해 주세요." };
      }
      if (result.success) {
        setMediaUrl("");
        await onSuccess();
      }
      return result;
    },
    {},
  );

  return (
    // 좁은 화면: 입력 → 안내 → 폭 가득 제출(48). 넓은 화면: 입력과 제출이 한 줄(40), 안내는 그 아래.
    <form action={action} className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,1fr)_auto]">
      <label htmlFor="assignment-media-url" className="text-ui font-semibold text-secondary-foreground md:col-span-2">
        새 믹스셋 제출
      </label>
      <Input
        ref={inputRef}
        id="assignment-media-url"
        name="mediaUrl"
        type="url"
        placeholder="YouTube 또는 SoundCloud 링크 붙여넣기"
        value={mediaUrl}
        onChange={(event) => setMediaUrl(event.target.value)}
        required
        disabled={isPending}
        aria-describedby="assignment-media-url-help"
        className="h-12 px-3.5 md:h-10 md:px-3"
      />
      <p id="assignment-media-url-help" className="text-xs leading-[18px] text-muted-foreground md:order-1 md:col-span-2 md:leading-4">
        YouTube 영상·Shorts·라이브와 SoundCloud 트랙·세트 링크를 지원합니다. 받은 과제와 별도로 자유롭게 제출합니다.
      </p>
      <Button
        type="submit"
        size="touch"
        disabled={isPending}
        className="mt-1 md:mt-0 md:h-10 md:rounded-md md:px-[18px] md:text-body"
      >
        {isPending ? "제출 중..." : "제출"}
      </Button>
      {state.error && <p role="alert" className="text-ui text-destructive md:order-2 md:col-span-2">{state.error}</p>}
      {state.success && <p role="status" className="text-ui text-success md:order-2 md:col-span-2">믹스셋을 제출했습니다.</p>}
    </form>
  );
}

// ── 받은 과제 제출·수정 폼 ───────────────────────

type TaskSubmissionDraft = { mediaUrl: string; text: string };

function TaskSubmitForm({
  task,
  actorId,
  duePassed,
  onDone,
  onCancel,
}: {
  task: AssignmentTaskItem;
  actorId: string;
  duePassed: boolean;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const submission = task.submission;
  const editing = submission !== null;
  const needsLink = task.submissionFormat === "MIX" || task.submissionFormat === "BOTH";
  const needsText = task.submissionFormat === "TEXT" || task.submissionFormat === "BOTH";
  const initial: TaskSubmissionDraft = {
    mediaUrl: submission?.mediaUrl ?? "",
    text: htmlToPlainText(submission?.textHtml),
  };
  const [mediaUrl, setMediaUrl] = useState(initial.mediaUrl);
  const [text, setText] = useState(initial.text);
  const [showResult, setShowResult] = useState(false);
  // 글 제출은 쓰는 중 새로고침·이탈에도 남도록 이 기기에 초안을 둔다(링크만 내는 과제도 같은 초안을 쓴다).
  const draft = useFormDraft<TaskSubmissionDraft>(
    createDocumentDraftKey("assignment-feedback", actorId, `task-submission:${task.id}`),
    (saved) => {
      setMediaUrl(typeof saved.mediaUrl === "string" ? saved.mediaUrl : initial.mediaUrl);
      setText(typeof saved.text === "string" ? saved.text : initial.text);
      setShowResult(false);
    },
    { onReset: () => { setMediaUrl(initial.mediaUrl); setText(initial.text); setShowResult(false); } },
  );
  const [state, action, isPending] = useActionState<AssignmentTaskActionState, FormData>(async (previous, data) => {
    let result: AssignmentTaskActionState;
    try {
      result = editing
        ? await updateMyTaskSubmission(submission.id, previous, data)
        : await submitAssignmentTask(task.id, previous, data);
    } catch {
      return { error: "제출 결과를 확인하지 못했습니다. 목록을 새로고침해 확인한 뒤 다시 시도해 주세요." };
    }
    if (result.success) {
      const submittedData = { mediaUrl: String(data.get("mediaUrl") ?? ""), text: String(data.get("text") ?? "") };
      draft.clear({ reason: "submitted", submittedData, submittedAliases: [submittedData] });
      await onDone();
    }
    return result;
  }, {});
  useBusyNavigationGuard(isPending);

  const saveDraft = (next: TaskSubmissionDraft) => {
    setShowResult(false);
    if (next.mediaUrl !== initial.mediaUrl || next.text !== initial.text) draft.save(next);
    else draft.clear();
  };
  const formId = `task-${task.id}`;
  const disabled = !draft.loaded || isPending;

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
      aria-label={editing ? `${task.title} 제출 수정` : `${task.title} 제출`}
      onBlur={draft.flush}
      onSubmit={(event) => {
        if (!draft.loaded || !draft.canSubmit || isPending) {
          event.preventDefault();
          return;
        }
        draft.flush();
        setShowResult(true);
      }}
    >
      {needsLink ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-media`} className="text-xs text-muted-foreground">믹스셋 링크</label>
          <Input
            id={`${formId}-media`}
            name="mediaUrl"
            type="url"
            placeholder="YouTube 또는 SoundCloud 링크"
            value={mediaUrl}
            onChange={(event) => {
              setMediaUrl(event.target.value);
              saveDraft({ mediaUrl: event.target.value, text });
            }}
            required
            disabled={disabled}
          />
        </div>
      ) : null}
      {needsText ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-text`} className="text-xs text-muted-foreground">글</label>
          <textarea
            id={`${formId}-text`}
            name="text"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              saveDraft({ mediaUrl, text: event.target.value });
            }}
            rows={6}
            maxLength={ASSIGNMENT_TEXT_MAX_LENGTH}
            placeholder="연습한 내용, 느낀 점, 질문을 적어 주세요."
            required
            disabled={disabled}
            aria-describedby={`${formId}-text-help`}
            className={TEXTAREA_CLASS}
          />
          <p id={`${formId}-text-help`} className="text-xs text-muted-foreground">
            빈 줄로 문단을 나눕니다. {ASSIGNMENT_TEXT_MAX_LENGTH_LABEL}자까지 쓸 수 있습니다.
          </p>
        </div>
      ) : null}
      {duePassed && !editing ? (
        <p className="text-xs text-muted-foreground">마감이 지났지만 제출할 수 있습니다. 늦은 제출로 표시됩니다.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled || !draft.canSubmit} pending={isPending} className="max-md:h-11">
          {isPending ? (editing ? "저장 중..." : "제출 중...") : editing ? "수정 저장" : "제출"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending} className="max-md:h-11">
          닫기
        </Button>
      </div>
      {showResult && state.error ? <p role="alert" className="text-ui text-destructive">{state.error}</p> : null}
      <DraftStatus {...draft} onRestoreRecovery={draft.restoreRecovery} onDiscardRecovery={draft.discardRecovery} disabled={isPending} />
    </form>
  );
}

// ── 받은 과제 행 ─────────────────────────────────

function TaskRow({
  task,
  actorId,
  open,
  onToggle,
  onDone,
}: {
  task: AssignmentTaskItem;
  actorId: string;
  open: boolean;
  onToggle: (taskId: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const submission = task.submission;
  const duePassed = useHasPassed(task.dueAt ? task.dueAt.getTime() : null);
  const status: AssignmentTaskStatus = submission
    ? submission.feedbackCount > 0 ? "reviewed" : "submitted"
    : duePassed ? "overdue" : "open";
  const late = submission ? isLateSubmission(task.dueAt, submission.submittedAt) : false;
  const canEdit = submission ? submission.feedbackCount === 0 : true;
  const panelId = `task-panel-${task.id}`;
  const meta = [
    formatDue(task.dueAt),
    ASSIGNMENT_FORMAT_LABELS[task.submissionFormat],
    task.recurrenceId || task.occurrenceDate ? "정기" : null,
  ].filter(Boolean).join(" · ");

  return (
    <li className="flex flex-col gap-3 border-b border-muted py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
          <span className="break-words text-md font-medium md:text-body">{task.title}</span>
          <span className="text-xs text-muted-foreground">
            <span className="font-mono">{meta}</span>
            {late ? " · 늦은 제출" : ""}
          </span>
        </span>
        <StatusDot tone={TASK_STATUS_TONE[status]} label={ASSIGNMENT_TASK_STATUS_LABELS[status]} />
        <span className="flex shrink-0 gap-2">
          {submission ? (
            <Link
              href={assignmentDetailHref(submission.id)}
              className="inline-flex h-11 items-center rounded-sm px-1 text-ui text-secondary-foreground underline underline-offset-[3px] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8"
            >
              {submission.feedbackCount > 0 ? "피드백 보기" : "제출 보기"}
            </Link>
          ) : null}
          {canEdit ? (
            <Button
              type="button"
              variant={submission ? "outline" : "default"}
              className="max-md:h-11"
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              onClick={() => onToggle(open ? null : task.id)}
            >
              {submission ? "제출 수정" : "제출하기"}
            </Button>
          ) : null}
        </span>
      </div>
      {open ? (
        <div id={panelId} className="flex flex-col gap-3">
          {task.descriptionHtml ? (
            <RichTextContent html={task.descriptionHtml} className="text-body leading-6 text-secondary-foreground" />
          ) : null}
          <TaskSubmitForm
            task={task}
            actorId={actorId}
            duePassed={duePassed}
            onDone={async () => {
              onToggle(null);
              await onDone();
            }}
            onCancel={() => onToggle(null)}
          />
        </div>
      ) : null}
    </li>
  );
}

// ── 자유 제출 목록 행 ────────────────────────────

function AssignmentRow({ assignment }: { assignment: StudentAssignmentSummary }) {
  const waiting = assignment.feedbackCount === 0;
  const status = waiting ? getPortalStatus("feedbackWaiting").label : `피드백 ${assignment.feedbackCount}개`;
  const submittedAt = formatSubmittedAt(assignment.submittedAt);
  const source = assignment.mediaUrl ? mediaSourceLabel(assignment.mediaUrl) : "글";
  const Icon = assignment.mediaUrl ? Play : FileText;

  return (
    <li>
      <Link
        href={assignmentDetailHref(assignment.id)}
        className="flex min-h-16 items-center gap-3 border-b border-muted py-2.5 text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none md:h-14 md:min-h-0 md:gap-3.5 md:px-1 md:py-0"
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-touch bg-muted text-secondary-foreground md:size-8 md:rounded-md"
        >
          <Icon className={cn("size-3.5", assignment.mediaUrl && "fill-current")} strokeWidth={1.6} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-md font-medium md:text-body">{describeAssignmentSubmission(assignment)}</span>
          <span className="truncate text-xs text-muted-foreground">
            {source}
            <span className="md:hidden"> · <span className="font-mono">{submittedAt}</span></span>
          </span>
        </span>
        <span className="hidden w-[120px] shrink-0 font-mono text-xs text-muted-foreground md:block">{submittedAt}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-ui text-secondary-foreground md:w-[120px]">
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", waiting ? "bg-item-qna" : "bg-highlight")} />
          {status}
        </span>
      </Link>
    </li>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────

export function AssignmentView({ actorId, initialAssignments, initialTasks = [], pageHeader = false }: AssignmentViewProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [assignments, setAssignments] = useState<StudentAssignmentSummary[]>(initialAssignments);
  const [tasks, setTasks] = useState<AssignmentTaskItem[]>(initialTasks);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [data, fbMap, nextTasks] = await Promise.all([getMyAssignments(), getMyFeedbacksMap(), getMyAssignmentTasks()]);
      setAssignments(toStudentAssignmentSummaries(data, fbMap));
      setTasks(nextTasks);
      setRefreshError(false);
      router.refresh();
    } catch {
      setRefreshError(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [router]);

  const freeAssignments = assignments.filter((assignment) => assignment.taskId === null);
  const waitingCount = freeAssignments.filter((assignment) => assignment.feedbackCount === 0).length;
  const unsubmittedTaskCount = tasks.filter((task) => task.submission === null).length;
  const summary = [
    tasks.length > 0 ? `받은 과제 ${tasks.length}개 · 미제출 ${unsubmittedTaskCount}개` : null,
    freeAssignments.length > 0 ? `믹스셋 ${freeAssignments.length}개 · ${getPortalStatus("feedbackWaiting").label} ${waitingCount}개` : null,
  ].filter(Boolean).join(" · ") || null;

  const body = (
    <div className={cn("flex flex-col gap-7 md:gap-8", pageHeader && "max-w-[880px]")}>
      {pageHeader ? (
        <header className="flex flex-col gap-1">
          <h1 className="text-mobile-title font-semibold tracking-display md:text-display">과제</h1>
          {summary ? <p className="text-body text-secondary-foreground">{summary}</p> : null}
        </header>
      ) : summary ? (
        <p className="text-body text-secondary-foreground">{summary}</p>
      ) : null}

      {refreshError && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-ui">
        <p>제출은 완료됐지만 목록을 새로 불러오지 못했습니다.</p>
        <Button type="button" variant="outline" onClick={refresh} pending={isRefreshing}>목록 다시 불러오기</Button>
      </div>}

      {tasks.length > 0 ? (
        <section aria-labelledby="assignment-task-heading" className="flex flex-col">
          <div className="flex h-11 items-center justify-between border-b border-border md:h-auto md:items-baseline md:pb-2">
            <h2 id="assignment-task-heading" className="text-ui font-semibold text-secondary-foreground">받은 과제</h2>
            <span className="text-xs text-muted-foreground">마감이 가까운 순</span>
          </div>
          <ul>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                actorId={actorId}
                open={openTaskId === task.id}
                onToggle={setOpenTaskId}
                onDone={refresh}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <SubmitForm inputRef={inputRef} onSuccess={refresh} />

      {freeAssignments.length === 0 ? (
        tasks.length === 0 ? (
          <EmptyState
            title="제출한 믹스셋이 없습니다"
            description="위 입력란에 YouTube 또는 SoundCloud 링크를 붙여넣어 첫 믹스셋을 제출하세요."
            icon={<FilePlay className="size-4.5" strokeWidth={1.6} aria-hidden="true" />}
            action={(
              <Button type="button" variant="outline" onClick={() => inputRef.current?.focus()}>
                링크 붙여넣기
              </Button>
            )}
          />
        ) : null
      ) : (
        <section aria-labelledby="assignment-list-heading" className="flex flex-col">
          <div className="flex h-11 items-center justify-between border-b border-border md:h-auto md:items-baseline md:pb-2">
            <h2 id="assignment-list-heading" className="text-ui font-semibold text-secondary-foreground">제출한 믹스셋</h2>
            <span className="text-xs text-muted-foreground">최신순</span>
          </div>
          <ul>
            {freeAssignments.map((assignment) => <AssignmentRow key={assignment.id} assignment={assignment} />)}
          </ul>
        </section>
      )}
    </div>
  );

  return pageHeader ? (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">{body}</div>
  ) : body;
}
