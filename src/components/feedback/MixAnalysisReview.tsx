/**
 * @file src/components/feedback/MixAnalysisReview.tsx
 * @description 믹스셋 분석 제출 상세(AnalysisDetail·AnalysisDetailBlocked 보드)의 평가·시점 메모.
 * - 시점을 누르면 플레이어가 그 위치부터 재생한다(임베드가 막힌 영상은 부모가 원본을 그 위치로 연다).
 * - 관리자는 줄마다 "피드백"으로 그 시점 피드백을 남기고, 피드백은 그 줄 바로 아래에 붙는다.
 * - 학생 화면은 같은 배치에서 피드백 버튼·입력만 빠진다.
 */
"use client";

import { useActionState, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createFeedback, deleteFeedback, type CreateFeedbackState } from "@/lib/actions/feedbacks";
import { CREATION_OPERATION_FIELD, createCreationOperationId, parseCreationOperationId } from "@/lib/creation-operation";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { formatAnalysisClock, splitFeedbackByEntry, type MixAnalysis } from "@/lib/mix-analysis";
import { formatTimestamp } from "@/lib/utils/format";
import type { FeedbackItem } from "./TimelineFeedback";

const CHIP_CLASS =
  "relative inline-flex h-6 shrink-0 items-center rounded-sm bg-accent px-2 font-mono text-xs font-medium text-highlight transition-colors duration-[var(--duration-fast)] after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] hover:bg-highlight/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:after:hidden";

export function MixAnalysisRating({ analysis }: { analysis: MixAnalysis }) {
  const stars = analysis.rating === null ? null : "★".repeat(analysis.rating) + "☆".repeat(5 - analysis.rating);
  return (
    <section aria-label="평가" className="flex flex-col gap-1.5">
      <p className="flex flex-wrap items-center gap-x-2.5 text-ui text-secondary-foreground">
        {stars ? (
          <>
            <span role="img" aria-label={`평점 ${analysis.rating}점 / 5점`} className="text-base tracking-[1px] text-foreground">{stars}</span>
            <span className="font-mono">{analysis.rating} / 5</span>
          </>
        ) : (
          <span>평점 없음</span>
        )}
        <span aria-hidden="true" className="text-faint">·</span>
        {analysis.recommended ? "추천 믹스" : "추천 믹스 아님"}
      </p>
      {analysis.oneLiner ? <p className="text-base font-medium leading-[26px]">{analysis.oneLiner}</p> : null}
    </section>
  );
}

/** 한 줄 아래 붙는 Stann 피드백. 관리자는 지울 수 있다. */
function LineFeedback({
  feedback,
  assignmentId,
  isAdmin,
  onChanged,
}: {
  feedback: FeedbackItem;
  assignmentId: string;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const confirm = useConfirmAction();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = feedback.timeMarker === null ? "전체" : formatAnalysisClock(feedback.timeMarker);
  return (
    <div className="group flex flex-col gap-2 rounded-md bg-sidebar px-3 py-2 md:ml-16">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-xs font-semibold text-secondary-foreground">Stann</span>
          <p className="whitespace-pre-wrap break-words text-md leading-[22px] md:text-body">{feedback.content}</p>
        </div>
        {isAdmin ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={(event) => confirm.request(event.currentTarget)}
            disabled={isPending}
            aria-expanded={confirm.value === true}
            aria-label={`${label} 피드백 삭제`}
            className="-my-1 shrink-0 text-destructive hover:bg-destructive-muted hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus:opacity-100 aria-expanded:opacity-100"
          >
            <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {isAdmin && confirm.value ? (
        <ConfirmPanel
          confirm={confirm}
          message={`${label} 피드백을 삭제할까요? 학생 화면에서도 사라지며 되돌릴 수 없습니다.`}
          confirmLabel="피드백 삭제 확인"
          pendingLabel="삭제 중..."
          pending={isPending}
          onConfirm={() => startTransition(async () => {
            setError(null);
            try {
              await deleteFeedback(feedback.id, assignmentId);
              onChanged();
            } catch {
              setError("피드백을 삭제하지 못했습니다. 다시 시도해 주세요.");
            }
          })}
        />
      ) : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** 줄 하나에 시점 피드백을 쓰는 폼. 쓰는 중인 내용은 줄마다 이 기기에 남는다. */
function LineFeedbackForm({
  assignmentId,
  actorId,
  seconds,
  onDone,
  onCancel,
}: {
  assignmentId: string;
  actorId: string;
  seconds: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState("");
  const [operationId, setOperationId] = useState("");
  const [showResult, setShowResult] = useState(false);
  const draft = useFormDraft<{ content: string; operationId?: string }>(
    createDocumentDraftKey("assignment-feedback", actorId, `${assignmentId}:line:${seconds}`),
    (saved) => {
      setContent(typeof saved.content === "string" ? saved.content : "");
      setOperationId(parseCreationOperationId(saved.operationId) ?? createCreationOperationId());
    },
    { onReset: () => { setContent(""); setOperationId(createCreationOperationId()); } },
  );
  const [state, action, isPending] = useActionState<CreateFeedbackState, FormData>(async (previous, data) => {
    let result: CreateFeedbackState;
    try {
      result = await createFeedback(assignmentId, previous, data);
    } catch {
      return { error: "저장 결과를 확인하지 못했습니다. 피드백 목록을 확인한 뒤 다시 시도해 주세요." };
    }
    if (result.success) {
      const submitted = { content: String(data.get("content") ?? ""), operationId: String(data.get(CREATION_OPERATION_FIELD) ?? "") };
      draft.clear({ reason: "submitted", submittedData: submitted, submittedAliases: [{ content: submitted.content }] });
      setContent("");
      setOperationId(createCreationOperationId());
      onDone();
    }
    return result;
  }, {});
  useBusyNavigationGuard(isPending);
  const clock = formatAnalysisClock(seconds);
  const inputId = `line-feedback-${seconds}`;

  return (
    <form
      action={action}
      aria-label={`${clock} 메모에 피드백`}
      className="flex flex-col gap-2 md:ml-16"
      onBlur={draft.flush}
      onSubmit={(event) => {
        if (!draft.loaded || !draft.canSubmit || isPending || !operationId) {
          event.preventDefault();
          return;
        }
        draft.save({ content, operationId });
        draft.flush();
        setShowResult(true);
      }}
    >
      <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
      {/* createFeedback은 분:초(분은 60 이상 가능)나 정수 초를 받는다. */}
      <input type="hidden" name="timeMarker" value={formatTimestamp(seconds)} />
      <label htmlFor={inputId} className="sr-only">{clock} 메모에 남길 피드백</label>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
        <Input
          id={inputId}
          name="content"
          type="text"
          autoFocus
          placeholder={`${clock}에 남길 피드백`}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setShowResult(false);
            const nextOperationId = createCreationOperationId();
            setOperationId(nextOperationId);
            if (event.target.value) draft.save({ content: event.target.value, operationId: nextOperationId });
            else draft.clear();
          }}
          required
          disabled={!draft.loaded || isPending}
        />
        <Button type="submit" size="touch" disabled={!draft.loaded || !draft.canSubmit || isPending || !operationId} className="md:h-9 md:rounded-md md:text-ui">
          {isPending ? "추가 중..." : "추가"}
        </Button>
        <Button type="button" variant="outline" size="touch" onClick={onCancel} disabled={isPending} className="md:h-9 md:rounded-md md:text-ui">
          닫기
        </Button>
      </div>
      {showResult && state.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
      <DraftStatus {...draft} onRestoreRecovery={draft.restoreRecovery} onDiscardRecovery={draft.discardRecovery} disabled={isPending} />
    </form>
  );
}

/**
 * 시점 메모 목록. 반환한 rest(줄에 붙지 않은 피드백)는 부모가 전체 피드백 목록에 그린다.
 */
export function MixAnalysisEntries({
  assignmentId,
  actorId,
  analysis,
  feedbackList,
  isAdmin,
  seekMode,
  onSeek,
  onChanged,
}: {
  assignmentId: string;
  actorId: string;
  analysis: MixAnalysis;
  feedbackList: FeedbackItem[];
  isAdmin: boolean;
  /** play: 플레이어가 그 위치부터 재생, original: 임베드가 막혀 YouTube를 그 위치로 연다, null: 누를 수 없다. */
  seekMode: "play" | "original" | null;
  onSeek?: (seconds: number) => void;
  onChanged: () => void;
}) {
  const [writingAt, setWritingAt] = useState<number | null>(null);
  const { byEntry } = splitFeedbackByEntry(analysis.entries, feedbackList);
  const opensOriginal = seekMode === "original";
  const seekHint = seekMode === "original"
    ? "시점을 누르면 YouTube에서 그 위치로 열립니다"
    : seekMode === "play" ? "시점을 누르면 그 위치부터 재생" : null;

  return (
    <section aria-labelledby="analysis-entries-heading" className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <h2 id="analysis-entries-heading" className="text-ui font-semibold text-secondary-foreground">
          시점 메모 <span className="font-mono font-normal text-muted-foreground">{analysis.entries.length}</span>
        </h2>
        {seekHint && analysis.entries.some((entry) => entry.at !== null) ? (
          <span className="text-xs text-muted-foreground">{seekHint}</span>
        ) : null}
      </div>
      {analysis.entries.length === 0 ? (
        <p className="py-6 text-body text-muted-foreground">시점 메모가 없습니다.</p>
      ) : (
        <ol>
          {analysis.entries.map((entry, index) => {
            const clock = entry.at === null ? null : formatAnalysisClock(entry.at);
            const firstAtThisTime = entry.at !== null && analysis.entries.findIndex((other) => other.at === entry.at) === index;
            return (
              <li key={index} className="flex flex-col gap-2 border-b border-muted py-3">
                <div className="flex items-start gap-3">
                  {entry.at === null ? (
                    <span className="inline-flex h-6 shrink-0 items-center rounded-sm bg-muted px-2 text-xs text-muted-foreground">메모</span>
                  ) : onSeek && seekMode ? (
                    <button
                      type="button"
                      onClick={() => { if (entry.at !== null) onSeek(entry.at); }}
                      aria-label={opensOriginal ? `${clock} 위치를 YouTube에서 열기` : `${clock}부터 재생`}
                      className={CHIP_CLASS}
                    >
                      {clock}
                    </button>
                  ) : (
                    <span className="inline-flex h-6 shrink-0 items-center rounded-sm bg-accent px-2 font-mono text-xs font-medium text-highlight">{clock}</span>
                  )}
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-md leading-[22px] md:text-body">{entry.memo}</p>
                  {isAdmin && entry.at !== null && firstAtThisTime ? (
                    <button
                      type="button"
                      onClick={() => setWritingAt(writingAt === entry.at ? null : entry.at)}
                      aria-expanded={writingAt === entry.at}
                      aria-label={`${clock} 메모에 피드백 쓰기`}
                      className="relative inline-flex h-6 shrink-0 items-center rounded-sm px-1.5 text-xs text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-muted aria-expanded:text-foreground md:after:hidden"
                    >
                      피드백
                    </button>
                  ) : null}
                </div>
                {byEntry[index]!.map((feedback) => (
                  <LineFeedback key={feedback.id} feedback={feedback} assignmentId={assignmentId} isAdmin={isAdmin} onChanged={onChanged} />
                ))}
                {isAdmin && entry.at !== null && firstAtThisTime && writingAt === entry.at ? (
                  <LineFeedbackForm
                    key={`${actorId}:${assignmentId}:${entry.at}`}
                    assignmentId={assignmentId}
                    actorId={actorId}
                    seconds={entry.at}
                    onDone={() => {
                      setWritingAt(null);
                      onChanged();
                    }}
                    onCancel={() => setWritingAt(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
