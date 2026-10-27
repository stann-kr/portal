"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteLesson, rescheduleLesson, type CreateLessonState } from "@/lib/actions/lessons";
import { toKstDateTimeInputValue } from "@/lib/date-input";
import { createLessonUnifiedItem } from "@/lib/unified-item-normalization";
import { cn } from "@/lib/utils";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

export function isManagedLessonItem(item: UnifiedItem): boolean {
  return item.type === "EVENT" && item.source.kind === "PORTAL" && item.source.entity === "LESSON";
}

/** 관리자 일정 상세에서 레슨 시간을 바꾸거나 취소 우선 2단계 확인 뒤 삭제한다(캔버스 CalendarDialogs 레슨 상세). */
export function LessonActions({
  item,
  onUpdated,
  onDeleted,
  onBusyChange,
}: {
  item: UnifiedItem;
  onUpdated: (item: UnifiedItem) => void;
  onDeleted: (item: UnifiedItem) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const studentId = item.space.studentId;
  const [mode, setMode] = useState<"view" | "reschedule" | "confirm-delete">("view");
  const [scheduledAt, setScheduledAt] = useState(() => toKstDateTimeInputValue(item.date));
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteMessageId = useId();
  const [isDeleting, startDelete] = useTransition();
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const inputId = `lesson-reschedule-${item.id}`;
  const [state, saveAction, isSaving] = useActionState<CreateLessonState, FormData>(
    async (previous, data) => {
      try {
        const result = await rescheduleLesson(item.id, studentId, previous, data);
        if (result.lesson) {
          setMode("view");
          setNotice("레슨 시간을 변경했습니다.");
          onUpdated(createLessonUnifiedItem(
            { id: result.lesson.id, scheduledAt: new Date(result.lesson.scheduledAt) },
            { id: studentId, email: item.space.label, displayName: item.space.label },
          ));
        }
        return result;
      } catch {
        return { error: "변경 결과를 확인하지 못했습니다. 일정을 확인한 뒤 다시 시도해 주세요." };
      }
    },
    {},
  );
  const busy = isSaving || isDeleting;
  const formError = mode === "reschedule" && !isSaving ? state.error : undefined;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  useEffect(() => {
    if (mode === "confirm-delete") cancelDeleteRef.current?.focus();
    if (mode === "reschedule") document.getElementById(inputId)?.focus();
  }, [inputId, mode]);

  const confirmDelete = () => {
    setDeleteError(null);
    startDelete(async () => {
      try {
        await deleteLesson(item.id, studentId);
        onDeleted(item);
      } catch {
        setDeleteError("레슨을 삭제하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  const smallButton = "h-11 rounded-touch md:h-[30px] md:rounded-md md:text-xs";

  return (
    <div className="flex flex-col gap-4">
      {notice ? <p role="status" className="text-ui text-success">{notice}</p> : null}
      {mode === "reschedule" ? (
        <form action={saveAction} className="flex flex-col gap-2.5 rounded-touch border border-border p-3.5" aria-busy={isSaving} aria-label="레슨 시간 변경">
          {formError ? (
            <p id={`${inputId}-error`} role="alert" className="rounded-touch bg-destructive-muted px-3.5 py-2 text-ui text-destructive">
              {formError}
            </p>
          ) : null}
          <label htmlFor={inputId} className="flex flex-col gap-1.5 text-xs text-secondary-foreground">
            새 레슨 날짜와 시간
            <Input
              id={inputId}
              name="scheduledAt"
              type="datetime-local"
              required
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              disabled={isSaving}
              aria-describedby={formError ? `${inputId}-error` : undefined}
              className="font-mono md:h-8 md:px-2.5 md:text-xs"
            />
          </label>
          <div className="flex justify-end gap-1.5">
            <Button type="button" variant="ghost" className={smallButton} onClick={() => setMode("view")} disabled={isSaving}>
              취소
            </Button>
            <Button type="submit" className={cn(smallButton, "px-4 md:px-3")} disabled={isSaving}>
              {isSaving ? "저장 중..." : "레슨 저장"}
            </Button>
          </div>
        </form>
      ) : mode === "view" ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 self-start rounded-touch px-3 md:h-8 md:rounded-md"
          onClick={() => {
            setScheduledAt(toKstDateTimeInputValue(item.date));
            setNotice(null);
            setMode("reschedule");
          }}
        >
          레슨 시간 변경
        </Button>
      ) : null}
      <p className="text-xs/[18px] text-muted-foreground">학생의 일정과 구독 캘린더에도 반영됩니다.</p>
      {mode === "confirm-delete" ? (
        <div role="group" aria-labelledby={deleteMessageId} className="flex flex-col gap-2.5 rounded-touch bg-destructive-muted px-3.5 py-3">
          <p id={deleteMessageId} className="text-ui text-destructive">이 레슨을 삭제할까요? 학생의 일정과 구독 캘린더에서도 사라집니다.</p>
          {deleteError ? <p role="alert" className="text-ui font-medium text-destructive">{deleteError}</p> : null}
          <div className="flex justify-end gap-1.5">
            <Button ref={cancelDeleteRef} type="button" variant="outline" className={cn(smallButton, "md:px-2.5")} onClick={() => setMode("view")} disabled={isDeleting}>
              취소
            </Button>
            <Button type="button" variant="destructive-solid" className={cn(smallButton, "md:px-3")} onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? "삭제 중..." : "삭제"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="destructive"
          className="h-11 self-start rounded-touch px-3 md:h-8 md:rounded-md"
          disabled={isSaving}
          onClick={() => { setNotice(null); setDeleteError(null); setMode("confirm-delete"); }}
        >
          레슨 삭제
        </Button>
      )}
    </div>
  );
}
