/**
 * @file src/components/feedback/FeedbackEditForm.tsx
 * @description 남긴 피드백을 그 자리에서 고치는 줄(UsabilityBundle ⑫). 관리자 전용.
 * 시점(분:초) 칸과 내용 한 줄, 취소·저장. 고치는 중인 내용은 이 기기에 남고(local draft),
 * 저장 중에는 화면 이탈을 막는다. 서버는 고치기 시작할 때의 값과 같을 때만 바꾼다(updateFeedback).
 * 기준값(expected)은 고치기 시작할 때 한 번 잡아 고정하고 보관본에도 함께 남긴다. 그래서 고치는 사이
 * 화면 값(props)이 새로 바뀌거나 예전 보관본을 되살려도, 시작했던 값과 서버 값이 다르면 덮지 않고 충돌로 알린다.
 * 기준값이 없는 예전 보관본은 바로 저장할 수 없다. "이전에 고치던 내용"으로 지금 값과 나란히 보여 주고,
 * 관리자가 비교한 뒤 "이 내용으로 바꾸기"를 눌러야 지금 값을 기준값으로 잡는다(그 사이 바뀐 값을 모르고 덮지 않게).
 */
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { updateFeedback } from "@/lib/actions/feedbacks";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { formatTimestamp } from "@/lib/utils/format";

type EditBaseline = { content: string; timeMarker: number | null };
type EditDraft = { timeMarker: string; content: string; expected?: EditBaseline };

function readBaseline(value: unknown): EditBaseline | null {
  if (!value || typeof value !== "object") return null;
  const { content, timeMarker } = value as Record<string, unknown>;
  if (typeof content !== "string") return null;
  if (!(timeMarker === null || (typeof timeMarker === "number" && Number.isSafeInteger(timeMarker)))) return null;
  return { content, timeMarker };
}

export function FeedbackEditForm({
  actorId,
  feedback,
  allowTimeMarker,
  formatMarker = formatTimestamp,
  onSaved,
  onCancel,
}: {
  actorId: string;
  feedback: { id: string; timeMarker: number | null; content: string };
  /** false면 시점을 고치지 않는다(글 제출의 전체 피드백·분석 줄 피드백). */
  allowTimeMarker: boolean;
  formatMarker?: (seconds: number) => string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  // 고치기 시작할 때의 값. 이후 props가 바뀌어도 그대로 두고, 보관본을 되살리면 보관본의 기준값을 쓴다.
  const [baseline, setBaseline] = useState<EditBaseline>(() => ({ content: feedback.content, timeMarker: feedback.timeMarker }));
  const initialMarker = baseline.timeMarker === null ? "" : formatTimestamp(baseline.timeMarker);
  const [timeMarker, setTimeMarker] = useState(initialMarker);
  const [content, setContent] = useState(baseline.content);
  const [error, setError] = useState<string | null>(null);
  // 기준값 없이 되살린 예전 보관본. 관리자가 지금 값과 비교해 고르기 전에는 저장할 수 없다.
  const [legacy, setLegacy] = useState<{ timeMarker: string; content: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const contentRef = useRef<HTMLInputElement>(null);
  const draft = useFormDraft<EditDraft>(
    createDocumentDraftKey("assignment-feedback", actorId, `edit:${feedback.id}`),
    (saved) => {
      const savedBaseline = readBaseline(saved.expected);
      const savedMarker = typeof saved.timeMarker === "string" && allowTimeMarker ? saved.timeMarker : null;
      const savedContent = typeof saved.content === "string" ? saved.content : null;
      if (!savedBaseline) {
        // 기준값이 없으면 지금 값을 기준으로 삼아 바로 보내지 않는다(그 사이 바뀐 값을 덮을 수 있다).
        setLegacy({ timeMarker: savedMarker ?? initialMarker, content: savedContent ?? baseline.content });
        return;
      }
      setLegacy(null);
      setBaseline(savedBaseline);
      if (savedMarker !== null) setTimeMarker(savedMarker);
      if (savedContent !== null) setContent(savedContent);
    },
    { onReset: () => { setLegacy(null); setTimeMarker(initialMarker); setContent(baseline.content); } },
  );
  useBusyNavigationGuard(isPending);
  useEffect(() => {
    contentRef.current?.focus();
  }, []);

  const change = (next: EditDraft) => {
    setTimeMarker(next.timeMarker);
    setContent(next.content);
    setError(null);
    if (next.timeMarker === initialMarker && next.content === baseline.content) draft.clear({ reason: "empty" });
    else draft.save({ ...next, expected: baseline });
  };

  const currentMarker = feedback.timeMarker === null ? "" : formatTimestamp(feedback.timeMarker);

  // 비교를 마친 관리자가 고른 경우에만 지금 값을 기준값으로 잡고 예전 내용을 입력 칸에 넣는다.
  const applyLegacy = () => {
    if (!legacy) return;
    const nextBaseline = { content: feedback.content, timeMarker: feedback.timeMarker };
    setBaseline(nextBaseline);
    setTimeMarker(legacy.timeMarker);
    setContent(legacy.content);
    setLegacy(null);
    setError(null);
    draft.save({ ...legacy, expected: nextBaseline });
    contentRef.current?.focus();
  };

  // 예전 내용을 버리고 지금 값에서 다시 고친다.
  const discardLegacy = () => {
    setLegacy(null);
    draft.clear({ reason: "discard" });
    contentRef.current?.focus();
  };

  // 취소는 고치던 내용을 버린다(이 기기 보관본도 지운다).
  const cancel = () => {
    draft.clear({ reason: "discard" });
    onCancel();
  };

  const label = feedback.timeMarker === null ? "전체" : formatMarker(feedback.timeMarker);
  const inputIdBase = `feedback-edit-${feedback.id}`;

  return (
    <form
      aria-label={`${label} 피드백 고치기`}
      className="flex flex-col gap-2"
      onBlur={draft.flush}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isPending) {
          event.preventDefault();
          cancel();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (isPending || !draft.loaded || !draft.canSubmit || legacy) return;
        const submitted = { timeMarker: allowTimeMarker ? timeMarker : initialMarker, content };
        setError(null);
        startTransition(async () => {
          try {
            const result = await updateFeedback(feedback.id, submitted, baseline);
            if (!result.success) {
              setError(result.error);
              return;
            }
            draft.clear({ reason: "submitted", submittedData: { ...submitted, expected: baseline } });
            onSaved();
          } catch {
            setError("피드백을 고치지 못했습니다. 다시 시도해 주세요.");
          }
        });
      }}
    >
      <div className="flex items-center gap-2">
        {allowTimeMarker ? (
          <label className="flex items-center">
            <span className="sr-only">재생 시점 (비우면 전체 피드백)</span>
            <input
              id={`${inputIdBase}-time`}
              type="text"
              inputMode="numeric"
              value={timeMarker}
              placeholder="전체"
              pattern="[0-9]+:[0-5][0-9]|[0-9]+"
              title="예: 01:30 (분:초). 비우면 전체 피드백"
              disabled={!draft.loaded || isPending || legacy !== null}
              onChange={(event) => change({ timeMarker: event.target.value, content })}
              className="h-11 w-20 rounded-sm border border-border bg-muted px-1.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-6 md:w-16"
            />
          </label>
        ) : (
          <span className="inline-flex h-6 shrink-0 items-center rounded-sm bg-muted px-1.5 font-mono text-xs text-secondary-foreground">{label}</span>
        )}
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={isPending} className="max-md:h-11">
          취소
        </Button>
        <Button type="submit" size="sm" pending={isPending} disabled={!draft.loaded || !draft.canSubmit || !content.trim() || legacy !== null} className="font-medium max-md:h-11">
          저장
        </Button>
      </div>
      <label className="flex">
        <span className="sr-only">피드백 내용</span>
        <input
          ref={contentRef}
          id={`${inputIdBase}-content`}
          type="text"
          value={content}
          required
          disabled={!draft.loaded || isPending || legacy !== null}
          onChange={(event) => change({ timeMarker, content: event.target.value })}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputIdBase}-error` : undefined}
          className="h-11 w-full rounded-md border border-foreground bg-background px-2.5 text-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9 md:text-body"
        />
      </label>
      {legacy ? (
        <section aria-label="이전에 고치던 내용" className="flex flex-col gap-2 rounded-md border border-border bg-muted px-3 py-2.5 text-ui">
          <p className="font-medium text-foreground">이전에 고치던 내용</p>
          <p className="text-xs text-secondary-foreground">언제 고치던 내용인지 알 수 없어 바로 저장하지 않습니다. 지금 값과 비교한 뒤 골라 주세요.</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt className="text-xs text-muted-foreground">지금 값</dt>
            <dd className="min-w-0 break-words">
              {allowTimeMarker ? <span className="mr-1.5 font-mono text-xs">{currentMarker || "전체"}</span> : null}
              {feedback.content}
            </dd>
            <dt className="text-xs text-muted-foreground">고치던 내용</dt>
            <dd className="min-w-0 break-words">
              {allowTimeMarker ? <span className="mr-1.5 font-mono text-xs">{legacy.timeMarker || "전체"}</span> : null}
              {legacy.content}
            </dd>
          </dl>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={discardLegacy} disabled={isPending} className="max-md:h-11">
              버리기
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={applyLegacy} disabled={isPending} className="max-md:h-11">
              이 내용으로 바꾸기
            </Button>
          </div>
        </section>
      ) : null}
      {error ? <p id={`${inputIdBase}-error`} role="alert" className="text-xs text-destructive">{error}</p> : null}
      <DraftStatus {...draft} onRestoreRecovery={draft.restoreRecovery} onDiscardRecovery={draft.discardRecovery} disabled={isPending} quiet />
    </form>
  );
}
