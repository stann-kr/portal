/**
 * @file src/components/feedback/FeedbackEditForm.tsx
 * @description 남긴 피드백을 그 자리에서 고치는 줄(UsabilityBundle ⑫). 관리자 전용.
 * 시점(분:초) 칸과 내용 한 줄, 취소·저장. 고치는 중인 내용은 이 기기에 남고(local draft),
 * 저장 중에는 화면 이탈을 막는다. 서버는 고치기 시작할 때의 값과 같을 때만 바꾼다(updateFeedback).
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

type EditDraft = { timeMarker: string; content: string };

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
  const initialMarker = feedback.timeMarker === null ? "" : formatTimestamp(feedback.timeMarker);
  const [timeMarker, setTimeMarker] = useState(initialMarker);
  const [content, setContent] = useState(feedback.content);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const contentRef = useRef<HTMLInputElement>(null);
  const draft = useFormDraft<EditDraft>(
    createDocumentDraftKey("assignment-feedback", actorId, `edit:${feedback.id}`),
    (saved) => {
      if (typeof saved.timeMarker === "string" && allowTimeMarker) setTimeMarker(saved.timeMarker);
      if (typeof saved.content === "string") setContent(saved.content);
    },
    { onReset: () => { setTimeMarker(initialMarker); setContent(feedback.content); } },
  );
  useBusyNavigationGuard(isPending);
  useEffect(() => {
    contentRef.current?.focus();
  }, []);

  const change = (next: EditDraft) => {
    setTimeMarker(next.timeMarker);
    setContent(next.content);
    setError(null);
    if (next.timeMarker === initialMarker && next.content === feedback.content) draft.clear({ reason: "empty" });
    else draft.save(next);
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
        if (isPending || !draft.loaded || !draft.canSubmit) return;
        const submitted = { timeMarker: allowTimeMarker ? timeMarker : initialMarker, content };
        setError(null);
        startTransition(async () => {
          try {
            const result = await updateFeedback(feedback.id, submitted, { content: feedback.content, timeMarker: feedback.timeMarker });
            if (!result.success) {
              setError(result.error);
              return;
            }
            draft.clear({ reason: "submitted", submittedData: submitted });
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
              disabled={!draft.loaded || isPending}
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
        <Button type="submit" size="sm" pending={isPending} disabled={!draft.loaded || !draft.canSubmit || !content.trim()} className="font-medium max-md:h-11">
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
          disabled={!draft.loaded || isPending}
          onChange={(event) => change({ timeMarker, content: event.target.value })}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputIdBase}-error` : undefined}
          className="h-11 w-full rounded-md border border-foreground bg-background px-2.5 text-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9 md:text-body"
        />
      </label>
      {error ? <p id={`${inputIdBase}-error`} role="alert" className="text-xs text-destructive">{error}</p> : null}
      <DraftStatus {...draft} onRestoreRecovery={draft.restoreRecovery} onDiscardRecovery={draft.discardRecovery} disabled={isPending} quiet />
    </form>
  );
}
