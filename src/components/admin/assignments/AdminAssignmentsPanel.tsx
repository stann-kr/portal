/**
 * @file src/components/admin/assignments/AdminAssignmentsPanel.tsx
 * @description 관리자 학생 상세 과제 탭: 과제 내기, 정기 과제 관리(멈춤·다시 시작·고치기·삭제), 낸 과제와 상태.
 * 서버가 렌더한 목록을 받고, 바꾼 뒤에는 router.refresh로 서버 목록을 다시 받는다.
 */
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import {
  LEDGER_HEADER_NOTE_CLASS,
  LedgerSection,
  LedgerSectionHeader,
} from "@/components/student-portal/today/HomeSection";
import {
  deleteAssignmentRecurrence,
  deleteAssignmentTask,
  setAssignmentRecurrencePaused,
  type AssignmentRecurrenceItem,
  type AssignmentTaskItem,
  type AssignmentTaskMutationResult,
} from "@/lib/actions/assignmentTasks";
import { ASSIGNMENT_FORMAT_LABELS, describeRecurrenceSchedule } from "@/lib/assignment-recurrence";
import {
  ASSIGNMENT_TASK_STATUS_LABELS,
  getAssignmentTaskStatus,
  isLateSubmission,
  type AssignmentTaskStatus,
} from "@/lib/assignment-submission";
import { formatKstDot } from "@/lib/kst-format";
import { STATUS_TONE_DOT_CLASS_NAMES, type PortalStatusTone } from "@/lib/portal-status";
import { cn } from "@/lib/utils";
import { AssignmentRecurrenceForm, AssignmentTaskForm } from "./AssignmentTaskForms";

const TASK_STATUS_TONE: Record<AssignmentTaskStatus, PortalStatusTone> = {
  open: "neutral",
  overdue: "destructive",
  submitted: "warning",
  reviewed: "success",
};

const ROW_CLASS = "flex flex-col gap-3 border-b border-muted py-3 md:px-1";
const ICON_BUTTON_CLASS = "-my-1 shrink-0 max-md:size-11";

type Editor =
  | { kind: "new-task" }
  | { kind: "new-recurrence" }
  | { kind: "task"; id: string }
  | { kind: "recurrence"; id: string }
  | null;

function StatusDot({ tone, label }: { tone: PortalStatusTone; label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ui text-secondary-foreground">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", STATUS_TONE_DOT_CLASS_NAMES[tone])} />
      {label}
    </span>
  );
}

export function AdminAssignmentsPanel({
  studentId,
  tasks,
  recurrences,
  referenceTime,
  returnTo,
}: {
  studentId: string;
  tasks: AssignmentTaskItem[];
  recurrences: AssignmentRecurrenceItem[];
  referenceTime: Date;
  returnTo: string;
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<Editor>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const taskConfirm = useConfirmAction<string>();
  const recurrenceConfirm = useConfirmAction<string>();
  const closeEditor = () => setEditor(null);
  const afterSave = () => {
    setEditor(null);
    router.refresh();
  };

  const run = (work: () => Promise<AssignmentTaskMutationResult>) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.success) setError(result.error);
        router.refresh();
      } catch {
        setError("변경 결과를 확인하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.");
      }
    });
  };

  const recurrenceTitles = new Map(recurrences.map((rule) => [rule.id, rule.title]));

  return (
    <div className="flex max-w-[880px] flex-col gap-8">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setEditor({ kind: "new-task" })} aria-expanded={editor?.kind === "new-task"} className="max-md:h-11">
          과제 내기
        </Button>
        <Button type="button" variant="outline" onClick={() => setEditor({ kind: "new-recurrence" })} aria-expanded={editor?.kind === "new-recurrence"} className="max-md:h-11">
          정기 과제 만들기
        </Button>
      </div>
      {editor?.kind === "new-task" ? (
        <AssignmentTaskForm studentId={studentId} onDone={afterSave} onCancel={closeEditor} />
      ) : null}
      {editor?.kind === "new-recurrence" ? (
        <AssignmentRecurrenceForm studentId={studentId} referenceTime={referenceTime} onDone={afterSave} onCancel={closeEditor} />
      ) : null}
      {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : null}

      {recurrences.length > 0 ? (
        <LedgerSection labelledBy="recurrences-heading">
          <LedgerSectionHeader id="recurrences-heading" title="정기 과제" count={recurrences.length} />
          <ul>
            {recurrences.map((rule) => {
              const paused = rule.pausedAt !== null;
              return (
                <li key={rule.id} className={ROW_CLASS}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
                      <span className="break-words text-body font-medium">{rule.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {describeRecurrenceSchedule(rule)} · {ASSIGNMENT_FORMAT_LABELS[rule.submissionFormat]}
                      </span>
                    </span>
                    <StatusDot tone={paused ? "neutral" : "info"} label={paused ? "멈춤" : "진행 중"} />
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => run(() => setAssignmentRecurrencePaused(studentId, rule.id, !paused, rule.version))}
                        className="max-md:h-11"
                      >
                        {paused ? "다시 시작" : "멈추기"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${rule.title} 정기 과제 고치기`}
                        aria-expanded={editor?.kind === "recurrence" && editor.id === rule.id}
                        onClick={() => setEditor({ kind: "recurrence", id: rule.id })}
                        className={ICON_BUTTON_CLASS}
                      >
                        <Pencil className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${rule.title} 정기 과제 삭제`}
                        aria-expanded={recurrenceConfirm.value === rule.id}
                        disabled={isPending}
                        onClick={(event) => recurrenceConfirm.request(event.currentTarget, rule.id)}
                        className={cn(ICON_BUTTON_CLASS, "text-destructive hover:bg-destructive-muted hover:text-destructive")}
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                      </Button>
                    </span>
                  </div>
                  {paused ? (
                    <p className="text-xs text-muted-foreground">멈춘 동안에는 새 회차를 만들지 않습니다. 다시 시작하면 그때부터 회차를 만듭니다.</p>
                  ) : null}
                  {editor?.kind === "recurrence" && editor.id === rule.id ? (
                    <AssignmentRecurrenceForm
                      key={`${rule.id}:${rule.version}`}
                      studentId={studentId}
                      recurrence={rule}
                      referenceTime={referenceTime}
                      onDone={afterSave}
                      onCancel={closeEditor}
                    />
                  ) : null}
                  {recurrenceConfirm.value === rule.id ? (
                    <ConfirmPanel
                      confirm={recurrenceConfirm}
                      message="이 정기 과제를 삭제할까요? 아직 마감 전이고 제출이 없는 회차는 함께 지워지고, 지난 회차와 제출된 회차는 일반 과제로 남습니다."
                      confirmLabel="정기 과제 삭제"
                      pendingLabel="삭제 중..."
                      pending={isPending}
                      onConfirm={() => run(() => deleteAssignmentRecurrence(studentId, rule.id))}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </LedgerSection>
      ) : null}

      <LedgerSection labelledBy="tasks-heading">
        <LedgerSectionHeader
          id="tasks-heading"
          title="낸 과제"
          count={tasks.length}
          aside={<span className={LEDGER_HEADER_NOTE_CLASS}>마감이 가까운 순</span>}
        />
        {tasks.length === 0 ? (
          <p className="py-6 text-body text-muted-foreground">아직 낸 과제가 없습니다. 과제 내기나 정기 과제로 학생에게 과제를 보낼 수 있습니다.</p>
        ) : (
          <ul>
            {tasks.map((task) => {
              const status = getAssignmentTaskStatus(task, task.submission, referenceTime);
              const late = task.submission ? isLateSubmission(task.dueAt, task.submission.submittedAt) : false;
              const ruleTitle = task.recurrenceId ? recurrenceTitles.get(task.recurrenceId) : undefined;
              const meta = [
                task.dueAt ? `${formatKstDot(task.dueAt, { weekday: true, time: true, referenceTime })} 마감` : "마감 없음",
                ASSIGNMENT_FORMAT_LABELS[task.submissionFormat],
                task.recurrenceId ? "정기 회차" : task.occurrenceDate ? "지난 정기 회차" : null,
                late ? "늦은 제출" : null,
              ].filter(Boolean).join(" · ");
              return (
                <li key={task.id} className={ROW_CLASS}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
                      <span className="break-words text-body font-medium">{task.title}</span>
                      <span className="text-xs text-muted-foreground">
                        <span className="font-mono">{meta}</span>
                        {ruleTitle && ruleTitle !== task.title ? ` · ${ruleTitle}` : ""}
                      </span>
                    </span>
                    <StatusDot tone={TASK_STATUS_TONE[status]} label={ASSIGNMENT_TASK_STATUS_LABELS[status]} />
                    <span className="flex shrink-0 items-center gap-1">
                      {task.submission ? (
                        <Link
                          href={`/dashboard/student/assignments/${encodeURIComponent(task.submission.id)}?returnTo=${encodeURIComponent(returnTo)}`}
                          className="inline-flex h-11 items-center rounded-sm px-1 text-ui text-secondary-foreground underline underline-offset-[3px] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8"
                        >
                          {task.submission.feedbackCount > 0 ? "제출·피드백 보기" : "제출 보고 피드백"}
                        </Link>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${task.title} 과제 고치기`}
                        aria-expanded={editor?.kind === "task" && editor.id === task.id}
                        onClick={() => setEditor({ kind: "task", id: task.id })}
                        className={ICON_BUTTON_CLASS}
                      >
                        <Pencil className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                      </Button>
                      {task.recurrenceId === null ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`${task.title} 과제 삭제`}
                          aria-expanded={taskConfirm.value === task.id}
                          disabled={isPending}
                          onClick={(event) => taskConfirm.request(event.currentTarget, task.id)}
                          className={cn(ICON_BUTTON_CLASS, "text-destructive hover:bg-destructive-muted hover:text-destructive")}
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                        </Button>
                      ) : null}
                    </span>
                  </div>
                  {editor?.kind === "task" && editor.id === task.id ? (
                    <AssignmentTaskForm key={`${task.id}:${task.version}`} studentId={studentId} task={task} onDone={afterSave} onCancel={closeEditor} />
                  ) : null}
                  {taskConfirm.value === task.id ? (
                    <ConfirmPanel
                      confirm={taskConfirm}
                      message={task.submission
                        ? "이 과제를 삭제할까요? 학생의 제출과 피드백은 지워지지 않고 자유 제출로 남습니다."
                        : "이 과제를 삭제할까요? 학생 과제 목록에서도 사라지며 되돌릴 수 없습니다."}
                      confirmLabel="과제 삭제"
                      pendingLabel="삭제 중..."
                      pending={isPending}
                      onConfirm={() => run(() => deleteAssignmentTask(studentId, task.id))}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </LedgerSection>
    </div>
  );
}
