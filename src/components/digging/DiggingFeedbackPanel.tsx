/**
 * @file src/components/digging/DiggingFeedbackPanel.tsx
 * @description 디깅 피드백(캔버스 FlowGaps1123 ④).
 * - 관리자(학생 상세 디깅 탭): 학생이 디깅한 날마다 트랙·플레이리스트 수와 피드백을 보이고, 그 자리에서 남기기·고치기·지우기.
 * - 학생(디깅 화면): Stann이 남긴 피드백을 날짜 최근 순으로 읽는다.
 * 날짜 줄은 `digging-day-YYYY-MM-DD` id를 가져 알림·관리자 디깅 화면이 그 자리로 바로 간다.
 * 피드백 쓰기는 긴 글 form이라 고치는 중인 내용을 이 기기에 남기고(local draft) 이탈을 막는다.
 */
"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { SectionHeader } from "@/components/ui/section-header";
import { DraftStatus } from "@/components/editor/DraftStatus";
import {
  deleteDiggingFeedback,
  saveDiggingFeedback,
  type DiggingDay,
  type DiggingFeedback,
} from "@/lib/actions/digging-feedback";
import { DIGGING_FEEDBACK_MAX_LENGTH } from "@/lib/digging-contract";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { useUnsavedUnloadGuard } from "@/lib/hooks/useUnsavedUnloadGuard";
import { formatDiggingDay } from "@/lib/digging-day";
import { formatKstMonthDayTime } from "@/lib/kst-format";
import { diggingFeedbackAnchorId } from "@/lib/student-space-routes";

const TEXTAREA_CLASS =
  "w-full resize-y rounded-touch border border-input bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:rounded-md md:py-2 md:text-sm";
const TEXT_ACTION_CLASS =
  "inline-flex h-11 items-center rounded-sm px-2 text-ui text-secondary-foreground underline-offset-[3px] hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:h-8";

function dayCounts(day: Pick<DiggingDay, "trackCount" | "playlistCount">): string {
  const parts = [
    day.trackCount > 0 ? `트랙 ${day.trackCount}` : null,
    day.playlistCount > 0 ? `플레이리스트 ${day.playlistCount}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "디깅 기록 없음";
}

function FeedbackBody({ feedback }: { feedback: DiggingFeedback }) {
  const edited = new Date(feedback.updatedAt).getTime() !== new Date(feedback.createdAt).getTime();
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-sidebar px-4 py-3">
      <p className="text-xs text-muted-foreground">
        Stann의 피드백 · <span className="font-mono">{formatKstMonthDayTime(new Date(feedback.createdAt))}</span>
        {edited ? <> · 수정됨 <span className="font-mono">{formatKstMonthDayTime(new Date(feedback.updatedAt))}</span></> : null}
      </p>
      <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-foreground">{feedback.body}</p>
    </div>
  );
}

/** 학생 디깅 화면: Stann이 남긴 피드백. 없으면 아무것도 그리지 않는다. */
export function DiggingFeedbackList({ feedbacks }: { feedbacks: DiggingFeedback[] }) {
  const headingId = useId();
  if (feedbacks.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionHeader title="Stann의 디깅 피드백" titleId={headingId} count={feedbacks.length} />
      <ul className="flex flex-col gap-4">
        {feedbacks.map((feedback) => (
          <li key={feedback.dugOn} id={diggingFeedbackAnchorId(feedback.dugOn)} className="flex scroll-mt-24 flex-col gap-2">
            <h3 className="text-ui font-semibold text-secondary-foreground">{formatDiggingDay(feedback.dugOn)}</h3>
            <FeedbackBody feedback={feedback} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 관리자 학생 상세 디깅 탭: 디깅한 날마다 피드백을 남긴다. */
export function DiggingFeedbackPanel({
  actorId,
  studentId,
  days,
}: {
  actorId: string;
  studentId: string;
  days: DiggingDay[];
}) {
  const headingId = useId();
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const deleteConfirm = useConfirmAction<string>();
  useBusyNavigationGuard(isDeleting);

  // 다른 화면(관리자 디깅·알림)에서 날짜 자리로 왔으면 그 줄을 보이게 한다.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, []);

  const remove = (day: DiggingDay) => {
    if (!day.feedback) return;
    const expectedUpdatedAt = new Date(day.feedback.updatedAt).getTime();
    setError(null);
    startDelete(async () => {
      try {
        const result = await deleteDiggingFeedback(studentId, { dugOn: day.dugOn, expectedUpdatedAt });
        if (!result.ok) setError(result.error);
        router.refresh();
      } catch {
        setError("피드백을 지우지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.");
      }
    });
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionHeader title="디깅한 날 · 피드백" titleId={headingId} count={days.length} />
      {error ? <p role="alert" className="rounded-md bg-destructive-muted px-3 py-2 text-ui text-destructive">{error}</p> : null}
      {days.length === 0 ? (
        <p className="rounded-lg border border-muted px-4 py-8 text-center text-ui text-muted-foreground">
          아직 디깅한 날이 없습니다. 학생이 트랙이나 플레이리스트를 올리면 날짜별로 피드백을 남길 수 있습니다.
        </p>
      ) : (
        <ul className="flex flex-col">
          {days.map((day) => {
            const label = formatDiggingDay(day.dugOn);
            const isEditing = editing === day.dugOn;
            return (
              <li key={day.dugOn} id={diggingFeedbackAnchorId(day.dugOn)} className="flex scroll-mt-24 flex-col gap-3 border-b border-muted py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="text-body font-semibold">{label}</h3>
                  <span className="font-mono text-xs text-muted-foreground">{dayCounts(day)}</span>
                  <span className="flex-1" />
                  {!isEditing ? (
                    <span className="-mr-2 flex items-center">
                      <button
                        type="button"
                        onClick={() => { setEditing(day.dugOn); setError(null); }}
                        className={TEXT_ACTION_CLASS}
                      >
                        {day.feedback ? "고치기" : "피드백 남기기"}<span className="sr-only">: {label}</span>
                      </button>
                      {day.feedback ? (
                        <button
                          type="button"
                          disabled={isDeleting}
                          aria-expanded={deleteConfirm.value === day.dugOn}
                          onClick={(event) => deleteConfirm.request(event.currentTarget, day.dugOn)}
                          className={`${TEXT_ACTION_CLASS} text-destructive hover:text-destructive`}
                        >
                          지우기<span className="sr-only">: {label} 피드백</span>
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                {isEditing ? (
                  <DiggingFeedbackForm
                    actorId={actorId}
                    studentId={studentId}
                    day={day}
                    onDone={() => { setEditing(null); router.refresh(); }}
                    onCancel={() => setEditing(null)}
                  />
                ) : day.feedback ? (
                  <FeedbackBody feedback={day.feedback} />
                ) : null}
                {deleteConfirm.value === day.dugOn ? (
                  <ConfirmPanel
                    confirm={deleteConfirm}
                    message={`${label} 피드백을 지울까요? 학생 화면에서도 사라지며 되돌릴 수 없습니다.`}
                    confirmLabel="피드백 지우기"
                    pendingLabel="지우는 중..."
                    pending={isDeleting}
                    onConfirm={() => remove(day)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

type FeedbackDraft = { body: string; expectedUpdatedAt: number | null };

function DiggingFeedbackForm({
  actorId,
  studentId,
  day,
  onDone,
  onCancel,
}: {
  actorId: string;
  studentId: string;
  day: DiggingDay;
  onDone: () => void;
  onCancel: () => void;
}) {
  const formId = useId();
  const initialBody = day.feedback?.body ?? "";
  // 쓰기 시작할 때의 피드백 시각. 보관본을 되살리면 보관본의 기준을 써서, 그 사이 바뀐 피드백을 모르고 덮지 않는다.
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<number | null>(
    day.feedback ? new Date(day.feedback.updatedAt).getTime() : null,
  );
  const [body, setBody] = useState(initialBody);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draft = useFormDraft<FeedbackDraft>(
    createDocumentDraftKey("assignment-feedback", actorId, `digging:${studentId}:${day.dugOn}`),
    (saved) => {
      if (typeof saved.body === "string") setBody(saved.body);
      if (saved.expectedUpdatedAt === null || typeof saved.expectedUpdatedAt === "number") {
        setExpectedUpdatedAt(saved.expectedUpdatedAt);
      }
    },
  );
  const dirty = body !== initialBody;
  useBusyNavigationGuard(isPending);
  useUnsavedUnloadGuard(dirty && !isPending);
  useEffect(() => { textareaRef.current?.focus(); }, []);

  const change = (next: string) => {
    setBody(next);
    setError(null);
    if (next === initialBody) draft.clear({ reason: "empty" });
    else draft.save({ body: next, expectedUpdatedAt });
  };

  // 취소는 쓰던 내용을 버린다(이 기기 보관본도 지운다).
  const cancel = () => {
    draft.clear({ reason: "discard" });
    onCancel();
  };

  // Esc는 줄만 닫고 보관본을 남긴다. 다시 열면 되살아난다.
  const dismiss = () => {
    if (!dirty) {
      cancel();
      return;
    }
    draft.flush();
    onCancel();
  };

  return (
    <form
      aria-label={`${formatDiggingDay(day.dugOn)} 디깅 피드백`}
      className="flex flex-col gap-2"
      onBlur={draft.flush}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || isPending || event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        dismiss();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (isPending || !draft.loaded || !draft.canSubmit || !body.trim()) return;
        const submitted = { body, expectedUpdatedAt };
        setError(null);
        startTransition(async () => {
          try {
            const result = await saveDiggingFeedback(studentId, { dugOn: day.dugOn, ...submitted });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            draft.clear({ reason: "submitted", submittedData: submitted });
            onDone();
          } catch {
            setError("피드백을 저장하지 못했습니다. 다시 시도해 주세요.");
          }
        });
      }}
    >
      <label htmlFor={`${formId}-body`} className="sr-only">이날 디깅 피드백</label>
      <textarea
        ref={textareaRef}
        id={`${formId}-body`}
        rows={4}
        maxLength={DIGGING_FEEDBACK_MAX_LENGTH}
        value={body}
        disabled={!draft.loaded || isPending}
        onChange={(event) => change(event.target.value)}
        placeholder="이날 고른 트랙과 플레이리스트에 대한 피드백"
        className={TEXTAREA_CLASS}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${formId}-error` : `${formId}-hint`}
      />
      {error ? <p id={`${formId}-error`} role="alert" className="text-ui text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`${formId}-hint`} className="text-xs text-muted-foreground">
          {day.feedback ? "고친 내용은 학생 화면에 바로 보입니다." : "남기면 학생에게 알림이 갑니다."}
        </span>
        <span className="flex gap-2">
          <Button type="button" variant="ghost" onClick={cancel} disabled={isPending} className="max-md:h-11">취소</Button>
          <Button type="submit" pending={isPending} disabled={!draft.loaded || !draft.canSubmit || !body.trim()} className="max-md:h-11">
            {day.feedback ? "저장" : "남기기"}
          </Button>
        </span>
      </div>
      <DraftStatus {...draft} onRestoreRecovery={draft.restoreRecovery} onDiscardRecovery={draft.discardRecovery} disabled={isPending} quiet />
    </form>
  );
}
