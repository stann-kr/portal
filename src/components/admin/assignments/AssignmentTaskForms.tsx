/**
 * @file src/components/admin/assignments/AssignmentTaskForms.tsx
 * @description 관리자 과제 내기(한 번)·정기 과제 폼. 학생 상세 과제 탭의 패널이 열고 닫는다.
 * 저장 중에는 링크 이동·문서 이탈을 막고, 만들기는 operationId로 재전송을 한 번만 저장한다.
 * React 19는 form action이 끝나면 결과와 관계없이 uncontrolled 입력을 기본값으로 되돌리므로,
 * 저장 실패(요일 누락·버전 충돌 등) 뒤에도 쓴 내용이 남도록 모든 입력을 state로 둔다.
 * 저장에 성공하면 패널이 폼을 닫고, 고치기 폼은 `id:version` key로 새로 그려진다.
 */
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { Input } from "@/components/ui/input";
import {
  createAssignmentRecurrence,
  createAssignmentTask,
  updateAssignmentRecurrence,
  updateAssignmentTask,
  type AssignmentRecurrenceItem,
  type AssignmentTaskActionState,
  type AssignmentTaskItem,
} from "@/lib/actions/assignmentTasks";
import {
  ASSIGNMENT_FORMAT_LABELS,
  ASSIGNMENT_SUBMISSION_FORMATS,
  RECURRENCE_MAX_INTERVAL_WEEKS,
  RECURRENCE_MAX_OCCURRENCES,
  WEEKDAY_LABELS,
  weekdayListFromMask,
  type AssignmentSubmissionFormatValue,
} from "@/lib/assignment-recurrence";
import {
  ASSIGNMENT_DESCRIPTION_MAX_LENGTH,
  ASSIGNMENT_TITLE_MAX_LENGTH,
  htmlToPlainText,
} from "@/lib/assignment-submission";
import { CREATION_OPERATION_FIELD, createCreationOperationId } from "@/lib/creation-operation";
import { toKstDateInputValue, toKstDateTimeInputValue } from "@/lib/date-input";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { cn } from "@/lib/utils";

const FIELD_LABEL = "flex flex-col gap-1.5 text-xs text-secondary-foreground";
const TEXTAREA_CLASS =
  "min-h-20 w-full resize-y rounded-touch border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:rounded-md md:text-body";
const FORM_CLASS = "flex flex-col gap-4 rounded-lg border border-border p-4";
const FORMAT_OPTIONS = ASSIGNMENT_SUBMISSION_FORMATS.map((value) => ({ value, label: ASSIGNMENT_FORMAT_LABELS[value] }));
/** 월요일부터 보이는 요일 순서(값은 bit 번호: 0 = 일요일). */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function splitDue(dueAt: Date | null): { date: string; time: string } {
  if (!dueAt) return { date: "", time: "" };
  const [date = "", time = ""] = toKstDateTimeInputValue(dueAt).split("T");
  return { date, time };
}

function useSubmitAction(
  run: (previous: AssignmentTaskActionState, data: FormData) => Promise<AssignmentTaskActionState>,
  onDone: () => void,
) {
  const [state, action, isPending] = useActionState<AssignmentTaskActionState, FormData>(async (previous, data) => {
    let result: AssignmentTaskActionState;
    try {
      result = await run(previous, data);
    } catch {
      return { error: "저장 결과를 확인하지 못했습니다. 목록을 새로고침해 확인한 뒤 다시 시도해 주세요." };
    }
    if (result.success) onDone();
    return result;
  }, {});
  useBusyNavigationGuard(isPending);
  return { state, action, isPending };
}

function TitleAndDescription({
  idPrefix,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  disabled,
}: {
  idPrefix: string;
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <label htmlFor={`${idPrefix}-title`} className={FIELD_LABEL}>
        제목
        <Input
          id={`${idPrefix}-title`}
          name="title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          maxLength={ASSIGNMENT_TITLE_MAX_LENGTH}
          placeholder="예: 이번 주 믹스셋 녹음"
          required
          disabled={disabled}
        />
      </label>
      <label htmlFor={`${idPrefix}-description`} className={FIELD_LABEL}>
        설명 (선택)
        <textarea
          id={`${idPrefix}-description`}
          name="description"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          rows={3}
          maxLength={ASSIGNMENT_DESCRIPTION_MAX_LENGTH}
          placeholder="연습할 내용이나 제출 방법을 적어 주세요."
          disabled={disabled}
          className={TEXTAREA_CLASS}
        />
      </label>
    </>
  );
}

function FormatField({
  value,
  onChange,
  disabled,
  note,
}: {
  value: AssignmentSubmissionFormatValue;
  onChange: (value: AssignmentSubmissionFormatValue) => void;
  disabled: boolean;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <ChoiceGroup label="제출 형식" options={FORMAT_OPTIONS} value={value} onChange={onChange} variant="segment" disabled={disabled} />
      <input type="hidden" name="submissionFormat" value={value} />
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function FormActions({ isPending, submitLabel, onCancel }: { isPending: boolean; submitLabel: string; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" pending={isPending} className="max-md:h-11">
        {isPending ? "저장 중..." : submitLabel}
      </Button>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isPending} className="max-md:h-11">
        취소
      </Button>
    </div>
  );
}

/** 한 번 과제 내기·고치기. 제출이 있으면 형식은 바꿀 수 없다. */
export function AssignmentTaskForm({
  studentId,
  task,
  onDone,
  onCancel,
}: {
  studentId: string;
  task?: AssignmentTaskItem;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [format, setFormat] = useState<AssignmentSubmissionFormatValue>(task?.submissionFormat ?? "MIX");
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(() => htmlToPlainText(task?.descriptionHtml));
  const [dueDate, setDueDate] = useState(() => splitDue(task?.dueAt ?? null).date);
  const [dueTime, setDueTime] = useState(() => splitDue(task?.dueAt ?? null).time);
  const [operationId] = useState(createCreationOperationId);
  const { state, action, isPending } = useSubmitAction(
    (previous, data) => (task
      ? updateAssignmentTask(studentId, task.id, previous, data)
      : createAssignmentTask(studentId, previous, data)),
    onDone,
  );
  const idPrefix = task ? `task-edit-${task.id}` : "task-new";
  const formatLocked = Boolean(task?.submission);

  return (
    <form action={action} className={FORM_CLASS} aria-label={task ? `${task.title} 고치기` : "과제 내기"}>
      {task ? <input type="hidden" name="version" value={task.version} /> : (
        <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
      )}
      <TitleAndDescription
        idPrefix={idPrefix}
        title={title}
        onTitleChange={setTitle}
        description={description}
        onDescriptionChange={setDescription}
        disabled={isPending}
      />
      <FormatField
        value={format}
        onChange={setFormat}
        disabled={isPending || formatLocked}
        note={formatLocked ? "학생이 이미 제출해 형식은 바꿀 수 없습니다." : undefined}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={`${idPrefix}-due-date`} className={FIELD_LABEL}>
          마감 날짜 (선택)
          <Input id={`${idPrefix}-due-date`} name="dueDate" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={isPending} className="font-mono" />
        </label>
        <label htmlFor={`${idPrefix}-due-time`} className={FIELD_LABEL}>
          마감 시각 (선택, 비우면 23:59)
          <Input id={`${idPrefix}-due-time`} name="dueTime" type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} disabled={isPending} className="font-mono" />
        </label>
      </div>
      {state.error ? <p role="alert" className="text-ui text-destructive">{state.error}</p> : null}
      <FormActions isPending={isPending} submitLabel={task ? "저장" : "과제 내기"} onCancel={onCancel} />
    </form>
  );
}

/** 정기 과제 만들기·고치기. */
export function AssignmentRecurrenceForm({
  studentId,
  recurrence,
  referenceTime,
  onDone,
  onCancel,
}: {
  studentId: string;
  recurrence?: AssignmentRecurrenceItem;
  referenceTime: Date;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [format, setFormat] = useState<AssignmentSubmissionFormatValue>(recurrence?.submissionFormat ?? "MIX");
  const [days, setDays] = useState<number[]>(() => (recurrence ? weekdayListFromMask(recurrence.weekdays) : []));
  const [title, setTitle] = useState(recurrence?.title ?? "");
  const [description, setDescription] = useState(() => htmlToPlainText(recurrence?.descriptionHtml));
  const [intervalWeeks, setIntervalWeeks] = useState(String(recurrence?.intervalWeeks ?? 1));
  const intervalRef = useRef<HTMLSelectElement>(null);
  const [startDate, setStartDate] = useState(() => recurrence?.startDate ?? toKstDateInputValue(referenceTime));
  const [dueTime, setDueTime] = useState(recurrence?.dueTime ?? "21:00");
  const [endDate, setEndDate] = useState(recurrence?.endDate ?? "");
  const [maxOccurrences, setMaxOccurrences] = useState(recurrence?.maxOccurrences == null ? "" : String(recurrence.maxOccurrences));
  const [operationId] = useState(createCreationOperationId);
  const { state, action, isPending } = useSubmitAction(
    (previous, data) => (recurrence
      ? updateAssignmentRecurrence(studentId, recurrence.id, previous, data)
      : createAssignmentRecurrence(studentId, previous, data)),
    onDone,
  );
  const idPrefix = recurrence ? `recurrence-edit-${recurrence.id}` : "recurrence-new";
  // React는 controlled input·textarea의 기본값만 value에 맞추고 select option의 selected 속성(defaultSelected)은
  // 맞추지 않아, form action 뒤 form.reset()이 반복 주기를 첫 option으로 되돌린다. 고른 값을 기본 선택으로 맞춰 둔다.
  useEffect(() => {
    for (const option of intervalRef.current?.options ?? []) option.toggleAttribute("selected", option.value === intervalWeeks);
  }, [intervalWeeks]);
  const toggleDay = (day: number) => setDays((current) => (current.includes(day) ? current.filter((value) => value !== day) : [...current, day]));

  return (
    <form action={action} className={FORM_CLASS} aria-label={recurrence ? `${recurrence.title} 정기 과제 고치기` : "정기 과제 만들기"}>
      {recurrence ? <input type="hidden" name="version" value={recurrence.version} /> : (
        <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
      )}
      <TitleAndDescription
        idPrefix={idPrefix}
        title={title}
        onTitleChange={setTitle}
        description={description}
        onDescriptionChange={setDescription}
        disabled={isPending}
      />
      <FormatField value={format} onChange={setFormat} disabled={isPending} />
      <fieldset className="flex flex-col gap-2" disabled={isPending}>
        <legend className="mb-2 text-body font-medium text-secondary-foreground md:text-ui">요일</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_ORDER.map((day) => {
            const checked = days.includes(day);
            return (
              <label
                key={day}
                className={cn(
                  "inline-flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-full px-3 text-ui has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring md:h-[30px] md:min-w-[30px] md:text-xs",
                  checked ? "bg-primary text-primary-foreground" : "bg-muted text-secondary-foreground hover:text-foreground",
                )}
              >
                <input
                  type="checkbox"
                  name="weekdays"
                  value={day}
                  checked={checked}
                  onChange={() => toggleDay(day)}
                  className="sr-only"
                />
                {WEEKDAY_LABELS[day]}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label htmlFor={`${idPrefix}-interval`} className={FIELD_LABEL}>
          반복
          <select
            id={`${idPrefix}-interval`}
            ref={intervalRef}
            name="intervalWeeks"
            value={intervalWeeks}
            onChange={(event) => setIntervalWeeks(event.target.value)}
            disabled={isPending}
            className="h-11 rounded-touch border border-input bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring md:h-8 md:rounded-md md:text-ui"
          >
            {Array.from({ length: RECURRENCE_MAX_INTERVAL_WEEKS }, (_, index) => index + 1).map((weeks) => (
              <option key={weeks} value={weeks}>{weeks === 1 ? "매주" : `${weeks}주마다`}</option>
            ))}
          </select>
        </label>
        <label htmlFor={`${idPrefix}-start`} className={FIELD_LABEL}>
          시작일
          <Input
            id={`${idPrefix}-start`}
            name="startDate"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            required
            disabled={isPending}
            className="font-mono"
          />
        </label>
        <label htmlFor={`${idPrefix}-due-time`} className={FIELD_LABEL}>
          마감 시각
          <Input
            id={`${idPrefix}-due-time`}
            name="dueTime"
            type="time"
            value={dueTime}
            onChange={(event) => setDueTime(event.target.value)}
            required
            disabled={isPending}
            className="font-mono"
          />
        </label>
        <label htmlFor={`${idPrefix}-end`} className={FIELD_LABEL}>
          종료일 (선택)
          <Input id={`${idPrefix}-end`} name="endDate" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={isPending} className="font-mono" />
        </label>
        <label htmlFor={`${idPrefix}-max`} className={FIELD_LABEL}>
          횟수 (선택)
          <Input
            id={`${idPrefix}-max`}
            name="maxOccurrences"
            type="number"
            min={1}
            max={RECURRENCE_MAX_OCCURRENCES}
            value={maxOccurrences}
            onChange={(event) => setMaxOccurrences(event.target.value)}
            disabled={isPending}
            className="font-mono"
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        회차는 마감일 하루 단위로 만들어지고, 다음 회차 하나가 미리 보입니다.
        {recurrence ? " 고치면 아직 마감 전이고 제출이 없는 회차만 새 내용으로 다시 만들고, 지난 회차와 제출된 회차는 그대로 둡니다." : ""}
      </p>
      {state.error ? <p role="alert" className="text-ui text-destructive">{state.error}</p> : null}
      <FormActions isPending={isPending} submitLabel={recurrence ? "저장" : "정기 과제 만들기"} onCancel={onCancel} />
    </form>
  );
}
