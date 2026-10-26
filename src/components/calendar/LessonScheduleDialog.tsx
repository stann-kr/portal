"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createLesson, type CreateLessonState } from "@/lib/actions/lessons";
import { createLessonUnifiedItem } from "@/lib/unified-item-normalization";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

/** 관리자가 학생 일정 캘린더에서 바로 레슨을 예약한다. */
export function LessonScheduleDialog({
  open,
  onOpenChange,
  studentId,
  spaceLabel,
  defaultStart,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  spaceLabel: string;
  /** datetime-local 형식의 KST 시작 시각. */
  defaultStart?: string;
  onSuccess?: (item: UnifiedItem) => void;
}) {
  const [scheduledAt, setScheduledAt] = useState(defaultStart ?? "");
  const handledLessonRef = useRef<string | null>(null);
  const [state, action, isPending] = useActionState<CreateLessonState, FormData>(
    async (previous, data) => {
      try {
        return await createLesson(studentId, previous, data);
      } catch {
        return { error: "저장 결과를 확인하지 못했습니다. 일정을 확인한 뒤 다시 시도해 주세요." };
      }
    },
    {},
  );
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const error = hasSubmitted && !isPending ? state.error : undefined;

  // 열 때나 열린 채로 기본 시각이 바뀔 때 입력을 새로 채운다. 이전 값과 렌더 중에 비교해 바로 맞춘다.
  const [resetSource, setResetSource] = useState({ open, defaultStart });
  if (resetSource.open !== open || resetSource.defaultStart !== defaultStart) {
    setResetSource({ open, defaultStart });
    if (open) {
      setScheduledAt(defaultStart ?? "");
      setHasSubmitted(false);
    }
  }

  useEffect(() => {
    if (!state.lesson || handledLessonRef.current === state.lesson.id) return;
    handledLessonRef.current = state.lesson.id;
    onOpenChange(false);
    onSuccess?.(createLessonUnifiedItem(
      { id: state.lesson.id, scheduledAt: new Date(state.lesson.scheduledAt) },
      { id: studentId, email: spaceLabel, displayName: spaceLabel },
    ));
  }, [onOpenChange, onSuccess, spaceLabel, state.lesson, studentId]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) onOpenChange(nextOpen); }}>
      <DialogContent dismissible={!isPending}>
        <DialogHeader>
          <DialogTitle>레슨 예약</DialogTitle>
          <DialogDescription>{spaceLabel} 학생의 레슨 날짜와 시간을 정하세요. 구독 캘린더에도 반영됩니다.</DialogDescription>
        </DialogHeader>
        <form action={action} onSubmit={() => setHasSubmitted(true)} className="space-y-4" aria-busy={isPending}>
          {error ? (
            <p id="lesson-form-error" role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <label htmlFor="lesson-schedule-start" className="text-sm font-medium">레슨 날짜와 시간</label>
            <Input
              id="lesson-schedule-start"
              name="scheduledAt"
              type="datetime-local"
              required
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              disabled={isPending}
              aria-describedby={error ? "lesson-form-error" : undefined}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={isPending} className="flex-1">
              {isPending ? "저장 중..." : "레슨 저장"}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              취소
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
