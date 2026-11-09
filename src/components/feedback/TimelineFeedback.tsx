/**
 * @file src/components/feedback/TimelineFeedback.tsx
 * @description 과제 피드백 UI 컴포넌트.
 * - 타임스탬프 클릭 시 VideoPlayer의 해당 시점으로 이동
 * - 재생 시점이 없는 피드백은 "전체" 표시로 구분한다(글 제출·과제 전체에 대한 피드백)
 * - Admin: 피드백 작성 폼 노출(재생 시점은 비워 둘 수 있다), 남긴 피드백을 그 자리에서 고치기·삭제
 * - Student: 조회만 가능
 */
"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { Bookmark, Pencil, Trash2, X } from "lucide-react";
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
import { useFeedbackMarks } from "./useFeedbackMarks";
import { FeedbackEditForm } from "./FeedbackEditForm";

export interface FeedbackItem {
  id: string;
  /** 없으면 과제 전체에 대한 피드백 */
  timeMarker: number | null;
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
  /** 재생할 링크가 없는 글 제출이면 false: 시점 입력을 숨기고 전체 피드백만 남긴다. */
  allowTimeMarker?: boolean;
  /**
   * overall: 믹스셋 분석 상세의 "전체 피드백". 시점 피드백은 시점 메모 줄에서 쓰므로
   * 여기서는 시점 없이 한 줄 입력과 추가 버튼만 둔다(AnalysisDetail 보드).
   */
  variant?: "timeline" | "overall";
}

/** 폼의 시점 글자(분:초·초)를 초로 읽는다. 서버(createFeedback)와 같은 형식만 받는다. */
function parseMarker(value: string): number | null {
  const trimmed = value.trim();
  const minutesAndSeconds = /^(\d+):([0-5]\d)$/u.exec(trimmed);
  if (minutesAndSeconds) return Number(minutesAndSeconds[1]) * 60 + Number(minutesAndSeconds[2]);
  return /^\d+$/u.test(trimmed) ? Number(trimmed) : null;
}

function feedbackLabel(fb: FeedbackItem): string {
  return fb.timeMarker === null ? "전체" : formatTimestamp(fb.timeMarker);
}

// ─── 관리자 피드백 작성 폼 ────────────────────────

/** 찍어 두기 단축키(Alt/Option+M). 입력 칸에서도 듣던 위치를 바로 남긴다. */
const MARK_SHORTCUT_CODE = "KeyM";

function FeedbackForm({
  assignmentId,
  actorId,
  onSuccess,
  onSeek,
  readPlaybackPosition,
  allowTimeMarker,
  overall,
}: {
  assignmentId: string;
  actorId: string;
  onSuccess: () => Promise<void>;
  onSeek?: (seconds: number) => void;
  readPlaybackPosition?: () => Promise<number | null>;
  allowTimeMarker: boolean;
  overall: boolean;
}) {
  const [timeMarker, setTimeMarker] = useState("");
  const [positionError, setPositionError] = useState<string | null>(null);
  const [readingPosition, setReadingPosition] = useState(false);
  const [content, setContent] = useState("");
  const [operationId, setOperationId] = useState("");
  const [showResult, setShowResult] = useState(false);
  const marks = useFeedbackMarks(actorId, assignmentId);
  const [markNotice, setMarkNotice] = useState<string | null>(null);
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
      // 찍어 둔 시점으로 쓴 피드백이면 그 시점을 목록에서 뺀다.
      const submittedSeconds = parseMarker(submittedData.timeMarker);
      if (submittedSeconds !== null) marks.remove(submittedSeconds);
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

  // 들으면서 위치만 남겨 두고 내용은 나중에 쓴다.
  const markCurrentPosition = async () => {
    if (!readPlaybackPosition) return;
    setMarkNotice(null);
    try {
      const seconds = await readPlaybackPosition();
      if (seconds === null) {
        setMarkNotice("재생 위치를 읽지 못했습니다. 플레이어를 재생한 뒤 다시 시도해 주세요.");
        return;
      }
      const marked = Math.floor(seconds);
      marks.add(marked);
      setMarkNotice(`${formatTimestamp(marked)}을 찍어 두었습니다.`);
    } catch {
      setMarkNotice("재생 위치를 읽지 못했습니다.");
    }
  };
  const markRef = useRef(markCurrentPosition);
  useEffect(() => {
    markRef.current = markCurrentPosition;
  });
  const canMark = allowTimeMarker && Boolean(readPlaybackPosition);
  useEffect(() => {
    if (!canMark) return;
    const handle = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.isComposing) return;
      if (event.code !== MARK_SHORTCUT_CODE) return;
      event.preventDefault();
      void markRef.current();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [canMark]);

  const pickMark = (seconds: number) => {
    const marker = formatTimestamp(seconds);
    setTimeMarker(marker);
    saveDraft({ timeMarker: marker, content });
    onSeek?.(seconds);
    document.getElementById("feedback-content")?.focus();
  };

  return (
    <form
      action={action}
      className={overall ? "flex flex-col gap-3" : "flex flex-col gap-3 border-t border-border pt-4"}
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
      {overall ? null : (
        <p className="text-ui font-semibold text-secondary-foreground">
          새 피드백 추가
        </p>
      )}
      <div className={allowTimeMarker ? "grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-end" : "grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"}>
        {allowTimeMarker ? <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="feedback-time-marker" className="text-xs text-muted-foreground">
              재생 시점 (선택)
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
            title="예: 01:30 (분:초). 비우면 전체 피드백"
            disabled={!draft.loaded || isPending}
            aria-describedby={showResult && state.error ? "feedback-error feedback-time-help" : "feedback-time-help"}
          />
        </div> : <input type="hidden" name="timeMarker" value="" />}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="feedback-content" className={overall ? "sr-only" : "text-xs text-muted-foreground"}>
            {overall ? "과제 전체에 남길 피드백" : "피드백 내용"}
          </label>
          <Input
            id="feedback-content"
            name="content"
            type="text"
            placeholder={overall ? "과제 전체에 남길 피드백" : "구체적인 수정 지점을 입력하세요"}
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
      {canMark ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={markCurrentPosition} disabled={isPending} aria-keyshortcuts="Alt+M">
              <Bookmark className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
              시점 찍어 두기
            </Button>
            <span className="text-xs text-muted-foreground">⌥M · 들으면서 위치만 남기고 내용은 나중에 씁니다</span>
          </div>
          {marks.marks.length > 0 ? (
            <ul aria-label="찍어 둔 시점" className="flex flex-wrap gap-1.5">
              {marks.marks.map((seconds) => (
                <li key={seconds} className="inline-flex items-center rounded-sm bg-accent text-highlight">
                  <button
                    type="button"
                    onClick={() => pickMark(seconds)}
                    aria-label={`${formatTimestamp(seconds)} 시점으로 피드백 쓰기`}
                    className="inline-flex h-8 items-center px-2 font-mono text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {formatTimestamp(seconds)}
                  </button>
                  <button
                    type="button"
                    onClick={() => marks.remove(seconds)}
                    aria-label={`${formatTimestamp(seconds)} 찍어 둔 시점 지우기`}
                    className="inline-flex size-8 items-center justify-center rounded-sm hover:bg-highlight/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3" strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {markNotice ? <p role="status" className="text-xs text-muted-foreground">{markNotice}</p> : null}
        </div>
      ) : null}
      {overall ? null : (
        <p id="feedback-time-help" className="text-xs text-muted-foreground">
          {allowTimeMarker ? "재생 시점을 비우면 과제 전체에 대한 피드백으로 남습니다." : "글 제출에는 전체 피드백으로 남깁니다."}
        </p>
      )}
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
  allowTimeMarker = true,
  variant = "timeline",
}: TimelineFeedbackProps) {
  const overall = variant === "overall";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const editTriggers = useRef(new Map<string, HTMLButtonElement>());
  const closeEdit = (feedbackId: string) => {
    setEditingId(null);
    requestAnimationFrame(() => editTriggers.current.get(feedbackId)?.focus());
  };

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
          {overall ? "전체 피드백" : "Stann의 피드백"}{" "}
          <span className="font-mono font-normal text-muted-foreground">{feedbackList.length}</span>
        </h2>
        {onSeek && feedbackList.some((fb) => fb.timeMarker !== null) ? (
          <span className="text-xs text-muted-foreground md:hidden">누르면 그 위치부터 재생</span>
        ) : null}
      </div>

      {/* 피드백 목록 */}
      {feedbackList.length === 0 ? (
        overall ? null : <p className="py-6 text-body text-muted-foreground">아직 피드백이 없습니다.</p>
      ) : (
        <ul>
          {feedbackList.map((fb) => (
            <li key={fb.id} className="group flex flex-col gap-3 border-b border-muted py-3.5">
              {isAdmin && editingId === fb.id ? (
                <FeedbackEditForm
                  actorId={actorId}
                  feedback={fb}
                  allowTimeMarker={allowTimeMarker && !overall}
                  onCancel={() => closeEdit(fb.id)}
                  onSaved={() => {
                    closeEdit(fb.id);
                    startTransition(refreshAfterChange);
                  }}
                />
              ) : (
              <div className="flex items-start gap-3">
                {/* 타임스탬프: 누르면 그 위치부터 재생. 좁은 화면은 위아래로 터치 영역을 넓힌다.
                    시점이 없는 전체 피드백은 누를 수 없는 "전체" 표시로 둔다. */}
                {fb.timeMarker === null ? (
                  <span className="inline-flex h-6 shrink-0 items-center rounded-sm bg-muted px-2 text-xs font-medium text-secondary-foreground">
                    전체
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => { if (fb.timeMarker !== null) onSeek?.(fb.timeMarker); }}
                    aria-label={`${formatTimestamp(fb.timeMarker)} 위치로 이동`}
                    className="relative inline-flex h-6 shrink-0 items-center rounded-sm bg-accent px-2 font-mono text-xs font-medium text-highlight transition-colors duration-[var(--duration-fast)] after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] hover:bg-highlight/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:after:hidden"
                  >
                    {formatTimestamp(fb.timeMarker)}
                  </button>
                )}

                <p className="min-w-0 flex-1 break-words text-md leading-6 md:text-body">{fb.content}</p>

                {/* 고치기·삭제 버튼 (Admin only) */}
                {isAdmin && (
                  <Button
                    ref={(node) => {
                      if (node) editTriggers.current.set(fb.id, node);
                      else editTriggers.current.delete(fb.id);
                    }}
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (deleteConfirm.isOpen) deleteConfirm.close();
                      setEditingId(fb.id);
                    }}
                    disabled={isPending}
                    aria-label={`${feedbackLabel(fb)} 피드백 고치기`}
                    className="-my-1 shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus:opacity-100"
                  >
                    <Pencil className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(event) => deleteConfirm.request(event.currentTarget, fb.id)}
                    disabled={isPending}
                    aria-expanded={deleteConfirm.value === fb.id}
                    aria-label={`${feedbackLabel(fb)} 피드백 삭제`}
                    className="-my-1 shrink-0 text-destructive opacity-100 transition-opacity hover:bg-destructive-muted hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus:opacity-100 aria-expanded:opacity-100"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                  </Button>
                )}
              </div>
              )}
              {isAdmin && deleteConfirm.value === fb.id ? (
                <ConfirmPanel
                  confirm={deleteConfirm}
                  message={`${feedbackLabel(fb)} 피드백을 삭제할까요? 학생 화면에서도 사라지며 되돌릴 수 없습니다.`}
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
        <div className={overall ? "mt-2.5" : "mt-6"}>
          <FeedbackForm
            key={`${actorId}:${assignmentId}`}
            assignmentId={assignmentId}
            actorId={actorId}
            onSuccess={refreshAfterChange}
            onSeek={onSeek}
            readPlaybackPosition={allowTimeMarker && !overall ? readPlaybackPosition : undefined}
            allowTimeMarker={allowTimeMarker && !overall}
            overall={overall}
          />
        </div>
      )}
    </section>
  );
}
