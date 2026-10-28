"use client";

import { useActionState, useEffect, useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  listRemoteCalendars,
  saveCalendarMapping,
  type CalendarSyncFormState,
  type RemoteCalendarOption,
} from "@/lib/actions/calendarSync";
import { cn } from "@/lib/utils";
import { FeedbackMessages, feedbackErrorId } from "./FeedbackMessages";
import { ACTION_BUTTON_CLASS, CALENDAR_SYNC_MESSAGES, FIELD_LABEL_CLASS, SELECT_CLASS } from "./calendar-sync-ui";

type CalendarList =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; calendars: RemoteCalendarOption[] };

const READ_ONLY_SUFFIX = " (읽기 전용이라 선택할 수 없음)";

/**
 * 연결 계정의 원격 캘린더 하나를 학생 한 명에게 정한다. 캘린더 목록은 관리자가 요청할 때만 불러온다.
 * 입력값은 컴포넌트 state가 가지고, 제출은 form 자동 초기화 없이 action만 부르므로 오류 뒤에도 고른 값이 남는다.
 */
export function MappingForm({
  connectionId,
  students,
  allStudentsMapped,
}: {
  connectionId: string;
  students: { id: string; name: string }[];
  allStudentsMapped: boolean;
}) {
  const router = useRouter();
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const studentFieldId = `${baseId}-student`;
  const calendarFieldId = `${baseId}-calendar`;
  const calendarHelpId = `${baseId}-calendar-help`;
  const resultId = `${baseId}-result`;

  const [studentId, setStudentId] = useState("");
  const [remoteCalendarId, setRemoteCalendarId] = useState("");
  const [list, setList] = useState<CalendarList>({ phase: "idle" });
  const [, startSubmit] = useTransition();
  const [state, formAction, pending] = useActionState<CalendarSyncFormState, FormData>(
    async (previous, data) => {
      try {
        const result = await saveCalendarMapping(previous, data);
        if (result.success) {
          setStudentId("");
          setRemoteCalendarId("");
        }
        return result;
      } catch {
        return { error: CALENDAR_SYNC_MESSAGES.unexpected };
      }
    },
    {},
  );

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state]);

  async function loadCalendars() {
    setList({ phase: "loading" });
    try {
      const result = await listRemoteCalendars(connectionId);
      if ("error" in result) {
        setList({ phase: "error", message: result.error });
        return;
      }
      setList({ phase: "ready", calendars: result.calendars });
      // 다시 불러온 목록에 없거나 읽기 전용이 된 캘린더는 선택에서 뺀다.
      setRemoteCalendarId((current) =>
        result.calendars.some((calendar) => calendar.id === current && !calendar.readOnly) ? current : "",
      );
    } catch {
      setList({ phase: "error", message: "캘린더 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    // form action 대신 직접 dispatch해 React의 제출 뒤 form 초기화를 피한다.
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startSubmit(() => formAction(data));
  }

  if (students.length === 0) {
    return (
      <p className="text-ui text-muted-foreground">
        {allStudentsMapped
          ? "모든 학생에게 이 계정의 캘린더를 정했습니다."
          : "캘린더를 정할 학생이 없습니다. 수강생을 먼저 추가해 주세요."}
      </p>
    );
  }

  const writableCount = list.phase === "ready" ? list.calendars.filter((calendar) => !calendar.readOnly).length : 0;
  const hasReadOnly = list.phase === "ready" && list.calendars.some((calendar) => calendar.readOnly);
  const canSubmit = list.phase === "ready" && Boolean(studentId) && Boolean(remoteCalendarId) && !pending;
  const calendarHelp =
    list.phase === "idle"
      ? "이 계정의 캘린더 목록을 불러온 뒤 고를 수 있습니다."
      : list.phase === "loading"
        ? "캘린더 목록을 불러오는 중입니다."
        : list.phase === "error"
          ? list.message
          : writableCount === 0
            ? "쓰기 권한이 있는 캘린더가 없습니다. 원격 캘린더에서 편집 권한을 준 뒤 다시 불러와 주세요."
            : hasReadOnly
              ? "읽기 전용 캘린더는 포털 일정을 쓸 수 없어 고를 수 없습니다."
              : "고른 캘린더와 이 학생의 포털 레슨·일정을 양쪽으로 맞춥니다.";

  return (
    <form onSubmit={submit} aria-labelledby={headingId} className="flex flex-col gap-3 border-t border-border pt-4">
      <h4 id={headingId} className="text-ui font-semibold text-secondary-foreground">학생 캘린더 추가</h4>
      <input type="hidden" name="connectionId" value={connectionId} />
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={studentFieldId} className={FIELD_LABEL_CLASS}>학생</label>
          <select
            id={studentFieldId}
            name="studentId"
            required
            disabled={pending}
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">학생 선택</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>{student.name}</option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={calendarFieldId} className={FIELD_LABEL_CLASS}>원격 캘린더</label>
          <select
            id={calendarFieldId}
            name="remoteCalendarId"
            required
            disabled={pending || list.phase !== "ready" || writableCount === 0}
            value={remoteCalendarId}
            onChange={(event) => setRemoteCalendarId(event.target.value)}
            aria-describedby={`${calendarHelpId}${state.error ? ` ${feedbackErrorId(resultId)}` : ""}`}
            aria-invalid={list.phase === "error" ? true : undefined}
            className={SELECT_CLASS}
          >
            <option value="">{list.phase === "ready" ? "캘린더 선택" : "목록을 먼저 불러오세요"}</option>
            {list.phase === "ready"
              ? list.calendars.map((calendar) => (
                  <option key={calendar.id} value={calendar.id} disabled={calendar.readOnly}>
                    {calendar.readOnly ? `${calendar.name}${READ_ONLY_SUFFIX}` : calendar.name}
                  </option>
                ))
              : null}
          </select>
        </div>
        <Button
          type="button"
          variant="outline"
          pending={list.phase === "loading"}
          disabled={pending || list.phase === "loading"}
          onClick={() => void loadCalendars()}
          className={cn(ACTION_BUTTON_CLASS, "w-full md:w-auto")}
        >
          {list.phase === "loading" ? "불러오는 중" : list.phase === "idle" ? "캘린더 목록 불러오기" : "목록 다시 불러오기"}
        </Button>
      </div>
      <p
        id={calendarHelpId}
        aria-live="polite"
        className={cn("text-ui md:text-xs", list.phase === "error" ? "text-destructive" : "text-muted-foreground")}
      >
        {calendarHelp}
      </p>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
        <Button type="submit" pending={pending} disabled={!canSubmit} className={cn(ACTION_BUTTON_CLASS, "w-full md:w-auto")}>
          {pending ? "저장하고 동기화 중" : "저장하고 동기화"}
        </Button>
      </div>
      <FeedbackMessages id={resultId} error={state.error} success={state.success} />
    </form>
  );
}
