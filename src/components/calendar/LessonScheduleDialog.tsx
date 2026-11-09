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
import type { QuickCreateStudentChoice } from "./CalendarQuickCreate";

/** 관리자가 학생 일정 캘린더에서 바로 레슨을 예약한다(머리의 "레슨 예약", 좁은 화면 위쪽 막대의 +). */
export function LessonScheduleDialog({
  open,
  onOpenChange,
  studentId,
  spaceLabel,
  defaultStart,
  onSuccess,
  studentChoices,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  spaceLabel: string;
  /** datetime-local 형식의 KST 시작 시각. */
  defaultStart?: string;
  onSuccess?: (item: UnifiedItem) => void;
  /** 관리자 일정 "전체 학생": 예약할 학생을 대화상자에서 먼저 고른다(필수). 서버 action이 활성 학생인지 다시 확인한다. */
  studentChoices?: readonly QuickCreateStudentChoice[];
}) {
  const [scheduledAt, setScheduledAt] = useState(defaultStart ?? "");
  const [chosenStudentId, setChosenStudentId] = useState("");
  const chosenStudent = studentChoices?.find((student) => student.id === chosenStudentId) ?? null;
  // 예약 결과를 받은 학생. 대화상자를 연 채 선택을 바꿔도 이미 저장한 레슨의 학생을 쓴다.
  const savedTargetRef = useRef<{ id: string; label: string }>({ id: studentId, label: spaceLabel });
  const handledLessonRef = useRef<string | null>(null);
  const [state, action, isPending] = useActionState<CreateLessonState, FormData>(
    async (previous, data) => {
      const targetId = studentChoices ? String(data.get("lessonStudentId") ?? "") : studentId;
      const target = studentChoices
        ? studentChoices.find((student) => student.id === targetId)
        : { id: studentId, label: spaceLabel };
      if (!target) return { error: "레슨을 예약할 학생을 골라 주세요." };
      try {
        const result = await createLesson(target.id, previous, data);
        if (result.lesson) savedTargetRef.current = { id: target.id, label: target.label };
        return result;
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
      setChosenStudentId("");
      setHasSubmitted(false);
    }
  }

  useEffect(() => {
    if (!state.lesson || handledLessonRef.current === state.lesson.id) return;
    handledLessonRef.current = state.lesson.id;
    onOpenChange(false);
    const target = studentChoices ? savedTargetRef.current : { id: studentId, label: spaceLabel };
    onSuccess?.(createLessonUnifiedItem(
      { id: state.lesson.id, scheduledAt: new Date(state.lesson.scheduledAt) },
      { id: target.id, email: target.label, displayName: target.label },
    ));
  }, [onOpenChange, onSuccess, spaceLabel, state.lesson, studentChoices, studentId]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) onOpenChange(nextOpen); }}>
      <DialogContent dismissible={!isPending}>
        <DialogHeader>
          <DialogTitle>레슨 예약</DialogTitle>
          <DialogDescription>
            {studentChoices
              ? `${chosenStudent ? `${chosenStudent.label} 학생의` : "학생을 고르고"} 레슨 날짜와 시간을 정하세요. 구독 캘린더에도 반영됩니다.`
              : `${spaceLabel} 학생의 레슨 날짜와 시간을 정하세요. 구독 캘린더에도 반영됩니다.`}
          </DialogDescription>
        </DialogHeader>
        <form action={action} onSubmit={() => setHasSubmitted(true)} className="flex flex-col gap-4" aria-busy={isPending}>
          {error ? (
            <p id="lesson-form-error" role="alert" className="rounded-touch bg-destructive-muted px-3.5 py-2 text-ui text-destructive">
              {error}
            </p>
          ) : null}
          {studentChoices ? (
            <label htmlFor="lesson-schedule-student" className="flex flex-col gap-1.5 text-xs text-secondary-foreground">
              학생
              <select
                id="lesson-schedule-student"
                name="lessonStudentId"
                required
                value={chosenStudentId}
                onChange={(event) => setChosenStudentId(event.target.value)}
                disabled={isPending}
                aria-describedby={error ? "lesson-form-error" : undefined}
                className="h-11 w-full rounded-touch border border-input bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:h-9 md:rounded-md md:px-2.5 md:text-ui"
              >
                <option value="">학생 고르기</option>
                {studentChoices.map((student) => (
                  <option key={student.id} value={student.id}>{student.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label htmlFor="lesson-schedule-start" className="flex flex-col gap-1.5 text-xs text-secondary-foreground">
            레슨 날짜와 시간
            <Input
              id="lesson-schedule-start"
              name="scheduledAt"
              type="datetime-local"
              required
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              disabled={isPending}
              aria-describedby={error ? "lesson-form-error" : undefined}
              className="font-mono md:px-2.5 md:text-xs"
            />
          </label>
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button
              type="button"
              variant="outline"
              size="touch"
              className="md:h-8 md:rounded-md md:px-3.5 md:text-ui"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              취소
            </Button>
            <Button type="submit" size="touch" className="md:h-8 md:rounded-md md:px-3.5 md:text-ui" disabled={isPending}>
              {isPending ? "저장 중..." : "레슨 저장"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
