/**
 * @file src/components/admin/assignments/AdminOpenTaskList.tsx
 * @description 관리자 전체 과제의 "아직 안 낸 과제" 목록(캔버스 FlowGaps1123 ①).
 * 줄을 누르면 학생 상세 과제 탭의 그 과제로 가고, 줄 끝에서 바로 완료 처리하거나 지운다.
 * 완료는 다시 열 수 있어 확인 없이 하고, 지우기는 되돌릴 수 없어 확인 영역을 연다.
 */
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LEDGER_ROW_CLASS } from "@/components/student-portal/today/HomeSection";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import {
  closeAssignmentTask,
  deleteAssignmentTask,
  type AssignmentTaskMutationResult,
} from "@/lib/actions/assignmentTasks";
import { STATUS_TONE_DOT_CLASS_NAMES, type PortalStatusTone } from "@/lib/portal-status";
import { cn } from "@/lib/utils";

export type AdminOpenTaskRow = {
  id: string;
  studentId: string;
  studentLabel: string;
  title: string;
  dueLabel: string;
  status: { tone: PortalStatusTone; label: string };
  /** 정기 과제 회차면 지우기 확인 문구가 달라진다. */
  recurring: boolean;
  href: string;
};

const ACTION_CLASS =
  "inline-flex h-11 items-center rounded-sm px-2 text-ui text-secondary-foreground underline-offset-[3px] hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:h-8";

export function AdminOpenTaskList({ rows }: { rows: AdminOpenTaskRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const deleteConfirm = useConfirmAction<string>();

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

  return (
    <>
      {error ? <p role="alert" className="mt-2 rounded-md bg-destructive-muted px-3 py-2 text-ui text-destructive">{error}</p> : null}
      <ul>
        {rows.map((task) => (
          <li key={task.id} className="border-b border-muted">
            <div className="flex flex-wrap items-center md:flex-nowrap">
              <Link
                href={task.href}
                className={cn(
                  LEDGER_ROW_CLASS,
                  "flex min-w-0 flex-1 basis-full flex-wrap items-center gap-x-3 gap-y-0.5 border-b-0 py-3 md:h-13 md:basis-auto md:flex-nowrap md:px-1 md:py-0",
                )}
              >
                <span className="min-w-0 basis-full truncate text-md font-medium md:flex-1 md:basis-auto md:text-body">{task.title}</span>
                <span className="truncate text-ui text-secondary-foreground md:order-first md:w-20 md:shrink-0">{task.studentLabel}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.dueLabel}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ui text-secondary-foreground md:w-24">
                  <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", STATUS_TONE_DOT_CLASS_NAMES[task.status.tone])} />
                  {task.status.label}
                </span>
              </Link>
              <span className="-ml-2 flex shrink-0 items-center pb-2 md:ml-1 md:pb-0">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => closeAssignmentTask(task.studentId, task.id))}
                  className={ACTION_CLASS}
                >
                  완료<span className="sr-only">: {task.studentLabel} {task.title}</span>
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  aria-expanded={deleteConfirm.value === task.id}
                  onClick={(event) => deleteConfirm.request(event.currentTarget, task.id)}
                  className={cn(ACTION_CLASS, "text-destructive hover:text-destructive")}
                >
                  지우기<span className="sr-only">: {task.studentLabel} {task.title}</span>
                </button>
              </span>
            </div>
            {deleteConfirm.value === task.id ? (
              <ConfirmPanel
                className="mb-3"
                confirm={deleteConfirm}
                message={task.recurring
                  ? `${task.studentLabel}의 ‘${task.title}’ 회차를 삭제할까요? 이 날짜의 회차는 다시 만들어지지 않고, 정기 과제의 다른 회차는 그대로입니다.`
                  : `${task.studentLabel}의 ‘${task.title}’ 과제를 삭제할까요? 학생 과제 목록에서도 사라지며 되돌릴 수 없습니다.`}
                confirmLabel={task.recurring ? "회차 삭제" : "과제 삭제"}
                pendingLabel="삭제 중..."
                pending={isPending}
                onConfirm={() => run(() => deleteAssignmentTask(task.studentId, task.id))}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
