/**
 * @file src/components/feedback/TimelineFeedback.tsx
 * @description 타임스탬프 기반 피드백 UI 컴포넌트.
 * - 타임스탬프 클릭 시 VideoPlayer의 해당 시점으로 이동
 * - Admin: 피드백 작성 폼 노출
 * - Student: 조회만 가능
 */
"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/input";
import { formatTimestamp } from "@/lib/utils/format";
import {
  createFeedback,
  deleteFeedback,
  type CreateFeedbackState,
} from "@/lib/actions/feedbacks";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { CREATION_OPERATION_FIELD, createCreationOperationId, parseCreationOperationId } from "@/lib/creation-operation";

export interface FeedbackItem {
  id: string;
  timeMarker: number;
  content: string;
  createdAt: Date | null;
}

interface TimelineFeedbackProps {
  assignmentId: string;
  actorId: string;
  feedbackList: FeedbackItem[];
  isAdmin: boolean;
  /** VideoPlayer의 특정 시점 이동 콜백 */
  onSeek?: (seconds: number) => void;
  onRefresh?: () => void | Promise<void>;
  /** 관리자 작성 폼이 현재 재생 위치로 시점을 채울 때 사용한다. */
  readPlaybackPosition?: () => Promise<number | null>;
}

// ─── 관리자 피드백 작성 폼 ────────────────────────

function FeedbackForm({
  assignmentId,
  actorId,
  onSuccess,
  readPlaybackPosition,
}: {
  assignmentId: string;
  actorId: string;
  onSuccess: () => Promise<void>;
  readPlaybackPosition?: () => Promise<number | null>;
}) {
  const [timeMarker, setTimeMarker] = useState("");
  const [positionError, setPositionError] = useState<string | null>(null);
  const [readingPosition, setReadingPosition] = useState(false);
  const [content, setContent] = useState("");
  const [operationId, setOperationId] = useState("");
  const [showResult, setShowResult] = useState(false);
  const draft = useFormDraft<{ timeMarker: string; content: string; operationId?: string }>(
    createDocumentDraftKey("assignment-feedback", actorId, assignmentId),
    (saved) => {
      setTimeMarker(typeof saved.timeMarker === "string" ? saved.timeMarker : "");
      setContent(typeof saved.content === "string" ? saved.content : "");
      setOperationId(parseCreationOperationId(saved.operationId) ?? createCreationOperationId());
      setShowResult(false);
    },
    { onReset: () => { setTimeMarker(""); setContent(""); setOperationId(createCreationOperationId()); setShowResult(false); } },
  );
  const [state, action, isPending] = useActionState<
    CreateFeedbackState,
    FormData
  >(async (previous, data) => {
    let result: CreateFeedbackState;
    try {
      result = await createFeedback(assignmentId, previous, data);
    } catch {
      return { error: "저장 결과를 확인하지 못했습니다. 피드백 목록을 확인한 뒤 다시 시도해 주세요." };
    }
    if (result.success) {
      const submittedData = { timeMarker: String(data.get("timeMarker") ?? ""), content: String(data.get("content") ?? "") };
      draft.clear({ reason: "submitted", submittedData: {
        ...submittedData,
        operationId: String(data.get(CREATION_OPERATION_FIELD) ?? ""),
      }, submittedAliases: [submittedData] });
      setTimeMarker("");
      setContent("");
      setOperationId(createCreationOperationId());
      await onSuccess();
    }
    return result;
  }, {});
  useBusyNavigationGuard(isPending);

  const saveDraft = (next: { timeMarker: string; content: string }) => {
    const nextOperationId = createCreationOperationId();
    setOperationId(nextOperationId);
    setShowResult(false);
    if (next.timeMarker || next.content) draft.save({ ...next, operationId: nextOperationId });
    else draft.clear();
  };

  // 듣다가 멈춘 위치를 직접 옮겨 적지 않도록 현재 재생 위치로 시점을 채운다.
  const fillCurrentPosition = async () => {
    if (!readPlaybackPosition) return;
    setPositionError(null);
    setReadingPosition(true);
    try {
      const seconds = await readPlaybackPosition();
      if (seconds === null) {
        setPositionError("재생 위치를 읽지 못했습니다. 플레이어를 재생한 뒤 다시 시도해 주세요.");
        return;
      }
      const marker = formatTimestamp(Math.floor(seconds));
      setTimeMarker(marker);
      saveDraft({ timeMarker: marker, content });
      document.getElementById("feedback-content")?.focus();
    } catch {
      setPositionError("재생 위치를 읽지 못했습니다. 시점을 직접 입력해 주세요.");
    } finally {
      setReadingPosition(false);
    }
  };

  return (
    <form
      action={action}
      className="flex flex-col gap-3 border-t border-border pt-4"
      onBlur={draft.flush}
      onSubmit={(event) => {
        if (!draft.loaded || !draft.canSubmit || isPending || !operationId) {
          event.preventDefault();
          return;
        }
        draft.save({ timeMarker, content, operationId });
        draft.flush();
        setShowResult(true);
      }}
    >
      <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
      <p className="text-ui font-semibold text-secondary-foreground">
        새 피드백 추가
      </p>
      <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-end">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="feedback-time-marker" className="text-xs text-muted-foreground">
              재생 시점
            </label>
            {readPlaybackPosition ? (
              <button
                type="button"
                onClick={fillCurrentPosition}
                disabled={!draft.loaded || isPending || readingPosition}
                className="-my-3 inline-flex h-11 items-center rounded-sm text-xs text-secondary-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:my-0 md:h-auto"
              >
                현재 위치
              </button>
            ) : null}
          </div>
          <Input
            id="feedback-time-marker"
            name="timeMarker"
            type="text"
            placeholder="MM:SS"
            value={timeMarker}
            onChange={(event) => {
              setTimeMarker(event.target.value);
              saveDraft({ timeMarker: event.target.value, content });
            }}
            className="font-mono"
            pattern="[0-9]+:[0-5][0-9]"
            title="예: 01:30 (분:초)"
            required
            disabled={!draft.loaded || isPending}
            aria-describedby={showResult && state.error ? "feedback-error" : undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="feedback-content" className="text-xs text-muted-foreground">
            피드백 내용
          </label>
          <Input
            id="feedback-content"
            name="content"
            type="text"
            placeholder="구체적인 수정 지점을 입력하세요"
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              saveDraft({ timeMarker, content: event.target.value });
            }}
            required
            disabled={!draft.loaded || isPending}
            aria-describedby={showResult && state.error ? "feedback-error" : undefined}
          />
        </div>
        <Button type="submit" size="touch" disabled={!draft.loaded || !draft.canSubmit || isPending || !operationId} className="sm:h-11 md:h-9 md:rounded-md md:text-ui">
          {isPending ? "추가 중..." : "추가"}
        </Button>
      </div>
      {positionError ? <p role="alert" className="text-xs text-destructive">{positionError}</p> : null}
      {showResult && state.error && <p id="feedback-error" role="alert" className="text-xs text-destructive">{state.error}</p>}
      {showResult && state.success && <p role="status" className="text-xs text-success">피드백을 추가했습니다.</p>}
      <DraftStatus {...draft} onRestoreRecovery={draft.restoreRecovery} onDiscardRecovery={draft.discardRecovery} disabled={isPending} />
    </form>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────

export function TimelineFeedback({
  assignmentId,
  actorId,
  feedbackList,
  isAdmin,
  onSeek,
  onRefresh,
  readPlaybackPosition,
}: TimelineFeedbackProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const headingId = useId();

  const refreshAfterChange = async () => {
    try {
      await onRefresh?.();
      setRefreshError(false);
    } catch {
      setRefreshError(true);
    }
  };

  const deleteConfirm = useConfirmAction<string>();

  const handleDelete = (feedbackId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await deleteFeedback(feedbackId, assignmentId);
        await refreshAfterChange();
      } catch {
        setError("피드백을 삭제하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      {error && <p role="alert" className="mb-3 text-ui text-destructive">{error}</p>}
      {refreshError && <div role="alert" className="mb-3 flex flex-col items-start gap-2 text-ui">
        <p>변경은 저장됐지만 피드백 목록을 새로 불러오지 못했습니다.</p>
        <Button type="button" variant="outline" onClick={() => startTransition(refreshAfterChange)} pending={isPending}>목록 다시 불러오기</Button>
      </div>}
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <h2 id={headingId} className="text-ui font-semibold text-secondary-foreground">
          강사 피드백{" "}
          <span className="font-mono font-normal text-muted-foreground">{feedbackList.length}</span>
        </h2>
        {onSeek && feedbackList.length > 0 ? (
          <span className="text-xs text-muted-foreground md:hidden">누르면 그 위치부터 재생</span>
        ) : null}
      </div>

      {/* 피드백 목록 */}
      {feedbackList.length === 0 ? (
        <p className="py-6 text-body text-muted-foreground">아직 피드백이 없습니다.</p>
      ) : (
        <ul>
          {feedbackList.map((fb) => (
            <li key={fb.id} className="group flex flex-col gap-3 border-b border-muted py-3.5">
              <div className="flex items-start gap-3">
                {/* 타임스탬프: 누르면 그 위치부터 재생. 좁은 화면은 위아래로 터치 영역을 넓힌다. */}
                <button
                  type="button"
                  onClick={() => onSeek?.(fb.timeMarker)}
                  aria-label={`${formatTimestamp(fb.timeMarker)} 위치로 이동`}
                  className="relative inline-flex h-6 shrink-0 items-center rounded-sm bg-accent px-2 font-mono text-xs font-medium text-highlight transition-colors duration-[var(--duration-fast)] after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] hover:bg-highlight/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:after:hidden"
                >
                  {formatTimestamp(fb.timeMarker)}
                </button>

                <p className="min-w-0 flex-1 break-words text-md leading-6 md:text-body">{fb.content}</p>

                {/* 삭제 버튼 (Admin only) */}
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(event) => deleteConfirm.request(event.currentTarget, fb.id)}
                    disabled={isPending}
                    aria-expanded={deleteConfirm.value === fb.id}
                    aria-label={`${formatTimestamp(fb.timeMarker)} 피드백 삭제`}
                    className="-my-1 shrink-0 text-destructive opacity-100 transition-opacity hover:bg-destructive-muted hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus:opacity-100 aria-expanded:opacity-100"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                  </Button>
                )}
              </div>
              {isAdmin && deleteConfirm.value === fb.id ? (
                <ConfirmPanel
                  confirm={deleteConfirm}
                  message={`${formatTimestamp(fb.timeMarker)} 피드백을 삭제할까요? 학생 화면에서도 사라지며 되돌릴 수 없습니다.`}
                  confirmLabel="피드백 삭제 확인"
                  pendingLabel="삭제 중..."
                  pending={isPending}
                  onConfirm={() => handleDelete(fb.id)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* 관리자 피드백 작성 폼 */}
      {isAdmin && (
        <div className="mt-6">
          <FeedbackForm
            key={`${actorId}:${assignmentId}`}
            assignmentId={assignmentId}
            actorId={actorId}
            onSuccess={refreshAfterChange}
            readPlaybackPosition={readPlaybackPosition}
          />
        </div>
      )}
    </section>
  );
}
