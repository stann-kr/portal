"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { CalendarClock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteLesson, rescheduleLesson, type CreateLessonState } from "@/lib/actions/lessons";
import { toKstDateTimeInputValue } from "@/lib/date-input";
import { createLessonUnifiedItem } from "@/lib/unified-item-normalization";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

export function isManagedLessonItem(item: UnifiedItem): boolean {
  return item.type === "EVENT" && item.source.kind === "PORTAL" && item.source.entity === "LESSON";
}

/** 관리자 일정 상세에서 레슨 시간을 바꾸거나 취소 우선 2단계 확인 뒤 삭제한다. */
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

  if (mode === "reschedule") {
    return (
      <form action={saveAction} className="space-y-3 rounded-lg border border-border p-4" aria-busy={isSaving} aria-label="레슨 시간 변경">
        {formError ? (
          <p id={`${inputId}-error`} role="alert" className="rounded-md bg-destructive-muted px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor={inputId} className="text-sm font-medium">새 레슨 날짜와 시간</label>
          <Input
            id={inputId}
            name="scheduledAt"
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
            disabled={isSaving}
            aria-describedby={formError ? `${inputId}-error` : undefined}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={isSaving} className="flex-1">
            {isSaving ? "저장 중..." : "저장"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setMode("view")} disabled={isSaving}>
            취소
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      {notice ? <p role="status" className="text-sm text-success">{notice}</p> : null}
      {mode === "confirm-delete" ? (
        <div role="group" aria-label="레슨 삭제 확인" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive-muted p-3">
          <p className="text-sm text-foreground">이 레슨을 삭제할까요? 학생의 일정과 구독 캘린더에서도 사라집니다.</p>
          {deleteError ? <p role="alert" className="text-sm text-destructive">{deleteError}</p> : null}
          <div className="flex gap-2">
            <Button ref={cancelDeleteRef} type="button" variant="outline" size="sm" onClick={() => setMode("view")} disabled={isDeleting}>
              취소
            </Button>
            <Button type="button" variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? "삭제 중..." : "삭제"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setScheduledAt(toKstDateTimeInputValue(item.date));
              setNotice(null);
              setMode("reschedule");
            }}
          >
            <CalendarClock className="size-3.5" aria-hidden="true" />
            레슨 시간 변경
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:bg-destructive/10"
            onClick={() => { setNotice(null); setDeleteError(null); setMode("confirm-delete"); }}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            레슨 삭제
          </Button>
        </div>
      )}
    </div>
  );
}
