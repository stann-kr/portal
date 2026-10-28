"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createComment, type CreateCommentState } from "@/lib/actions/comments";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { CREATION_OPERATION_FIELD, createCreationOperationId, parseCreationOperationId } from "@/lib/creation-operation";
import { COMMENT_TIME_MARKER_FIELD, formatTimeMarker, parseTimeMarker } from "@/lib/community-mixset-media";

type CommentDraft = { content: string; timeMarker?: string; operationId?: string };

/**
 * 게시물 댓글 입력(캔버스 CommunityPost·MobileCommunityPost 댓글 줄: 한 줄 입력 + 등록).
 * 입력값은 이 기기 초안으로 조용히 보존하고, 복원·충돌·오류·복구본이 있을 때만 줄 아래에 안내한다.
 * 매체가 있는 믹스셋 게시물이면 선택 칸 "시점"을 더해 재생 위치에 댓글을 남긴다(비우면 일반 댓글).
 */
export function CommentForm({
  postId,
  actorId,
  onSaved,
  className,
  allowTimeMarker = false,
  readPlaybackPosition,
}: {
  postId: string;
  actorId: string;
  onSaved: () => void;
  /** 좁은 화면 아래 고정 막대처럼 놓일 자리의 모양 */
  className?: string;
  /** 매체가 있는 믹스셋 게시물에서만 true: 재생 시점 칸을 보인다. */
  allowTimeMarker?: boolean;
  /** "현재 위치"로 시점을 채울 때 읽는 플레이어 위치(초). 없거나 null이면 읽지 못했다고 알린다. */
  readPlaybackPosition?: () => Promise<number | null>;
}) {
  const contentId = useId();
  const errorId = useId();
  const timeId = useId();
  const timeHelpId = useId();
  const timeErrorId = useId();
  const contentRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  // 시점 입력·제출·초기화가 일어나면 진행 중인 ‘현재 위치’ 읽기 결과를 버린다.
  const positionReadGeneration = useRef(0);
  const [content, setContent] = useState("");
  const [timeMarker, setTimeMarker] = useState("");
  const [timeError, setTimeError] = useState<string | null>(null);
  const [positionStatus, setPositionStatus] = useState<string | null>(null);
  const [readingPosition, setReadingPosition] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [showResult, setShowResult] = useState(false);
  const draft = useFormDraft<CommentDraft>(
    createDocumentDraftKey("community-comment", actorId, postId),
    (saved) => {
      setContent(typeof saved.content === "string" ? saved.content : "");
      setTimeMarker(allowTimeMarker && typeof saved.timeMarker === "string" ? saved.timeMarker : "");
      setOperationId(parseCreationOperationId(saved.operationId) ?? createCreationOperationId());
      setTimeError(null);
      setShowResult(false);
    },
    { onReset: () => { positionReadGeneration.current += 1; setContent(""); setTimeMarker(""); setTimeError(null); setOperationId(createCreationOperationId()); setShowResult(false); } },
  );
  const [state, action, pending] = useActionState<CreateCommentState, FormData>(async (previous, data) => {
    let result: CreateCommentState;
    try {
      result = await createComment(postId, previous, data);
    } catch {
      return { error: "저장 결과를 확인하지 못했습니다. 댓글 목록을 확인한 뒤 다시 시도해 주세요." };
    }
    if (result.success && result.commentId) {
      const submittedContent = String(data.get("content") ?? "");
      const submittedTimeMarker = String(data.get(COMMENT_TIME_MARKER_FIELD) ?? "");
      draft.clear({
        reason: "submitted",
        submittedData: { content: submittedContent, timeMarker: submittedTimeMarker, operationId: String(data.get(CREATION_OPERATION_FIELD) ?? "") },
        submittedAliases: [{ content: submittedContent }, { content: submittedContent, timeMarker: submittedTimeMarker }],
      });
      setContent("");
      positionReadGeneration.current += 1;
      setTimeMarker("");
      setPositionStatus(null);
      setOperationId(createCreationOperationId());
      onSaved();
    }
    return result;
  }, {});
  useBusyNavigationGuard(pending);

  // 내용이나 시점이 바뀌면 다른 제출이므로 작업 식별자를 새로 만든다(서버 재시도 비교에 시점도 들어간다).
  const saveDraft = (next: { content: string; timeMarker: string }) => {
    const nextOperationId = createCreationOperationId();
    setOperationId(nextOperationId);
    setShowResult(false);
    if (next.content || next.timeMarker) draft.save({ ...next, operationId: nextOperationId });
    else draft.clear();
  };

  const changeTimeMarker = (value: string) => {
    positionReadGeneration.current += 1;
    setTimeMarker(value);
    setTimeError(null);
    setPositionStatus(null);
    saveDraft({ content, timeMarker: value });
  };

  // 듣다가 멈춘 위치를 옮겨 적지 않도록 현재 재생 위치(초 내림)로 시점을 채운다.
  const fillCurrentPosition = async () => {
    setPositionStatus(null);
    setReadingPosition(true);
    const generation = ++positionReadGeneration.current;
    try {
      const seconds = readPlaybackPosition ? await readPlaybackPosition() : null;
      if (generation !== positionReadGeneration.current) return;
      if (seconds === null) {
        setPositionStatus("재생 위치를 읽지 못했습니다. 플레이어를 재생한 뒤 다시 눌러 주세요.");
        return;
      }
      // 위치를 읽는 동안 입력한 내용도 초안에 함께 남도록 최신 내용을 쓴다.
      const marker = formatTimeMarker(Math.floor(seconds));
      setTimeMarker(marker);
      setTimeError(null);
      saveDraft({ content: contentRef.current?.value ?? content, timeMarker: marker });
      contentRef.current?.focus();
    } catch {
      if (generation !== positionReadGeneration.current) return;
      setPositionStatus("재생 위치를 읽지 못했습니다. 시점을 직접 입력해 주세요.");
    } finally {
      setReadingPosition(false);
    }
  };

  const controlsDisabled = !draft.loaded || pending;
  const timeDescribedBy = [timeHelpId, timeError ? timeErrorId : null].filter(Boolean).join(" ");

  return (
    <form
      action={action}
      // 평소에는 비어 있는 초안 상태 묶음이 줄 아래 간격을 만들지 않게 숨긴다.
      className={cn("flex flex-col gap-1 [&>[role=group]:empty]:hidden", className)}
      onBlur={draft.flush}
      onSubmit={(event) => {
        if (!draft.loaded || !draft.canSubmit || pending || !operationId) {
          event.preventDefault();
          return;
        }
        // 서버가 최종 판단하지만 형식이 틀린 시점은 보내기 전에 칸 옆에서 알린다.
        if (allowTimeMarker) {
          const parsed = parseTimeMarker(timeMarker);
          if (!parsed.ok) {
            event.preventDefault();
            setTimeError(parsed.error);
            timeRef.current?.focus();
            return;
          }
        }
        draft.save({ content, timeMarker, operationId });
        draft.flush();
        setShowResult(true);
      }}
    >
      <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
      {allowTimeMarker ? (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <label htmlFor={timeId} className="shrink-0 text-xs text-muted-foreground">시점</label>
          <Input
            ref={timeRef}
            id={timeId}
            name={COMMENT_TIME_MARKER_FIELD}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="12:34"
            value={timeMarker}
            onChange={(event) => changeTimeMarker(event.target.value)}
            disabled={controlsDisabled}
            aria-invalid={timeError ? true : undefined}
            aria-describedby={timeDescribedBy}
            className="w-[5.5rem] font-mono md:h-8"
          />
          {readPlaybackPosition ? (
            <button
              type="button"
              onClick={fillCurrentPosition}
              disabled={controlsDisabled || readingPosition}
              className="inline-flex h-11 items-center rounded-sm px-1.5 text-xs text-secondary-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:h-8"
            >
              현재 위치
            </button>
          ) : null}
          {timeMarker ? (
            <button
              type="button"
              onClick={() => { changeTimeMarker(""); timeRef.current?.focus(); }}
              disabled={controlsDisabled}
              aria-label="시점 비우기"
              className="inline-flex h-11 items-center rounded-sm px-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:h-8"
            >
              비우기
            </button>
          ) : null}
          <span id={timeHelpId} className="sr-only">선택 항목입니다. 예: 12:34 또는 1:05:30. 비우면 시점 없는 댓글로 남습니다.</span>
        </div>
      ) : null}
      {timeError ? <p id={timeErrorId} role="alert" className="text-xs text-destructive">{timeError}</p> : null}
      {positionStatus ? <p role="status" className="text-xs text-muted-foreground">{positionStatus}</p> : null}
      <label htmlFor={contentId} className="sr-only">댓글 내용</label>
      <div className="flex gap-2">
        <Input
          ref={contentRef}
          id={contentId}
          name="content"
          type="text"
          placeholder="댓글을 입력하세요..."
          value={content}
          onChange={(event) => {
            const value = event.target.value;
            setContent(value);
            saveDraft({ content: value, timeMarker });
          }}
          required
          disabled={!draft.loaded || pending}
          aria-describedby={showResult && state.error ? errorId : undefined}
          className="min-w-0 flex-1 md:h-10"
        />
        <Button
          type="submit"
          size="touch"
          disabled={!draft.loaded || !draft.canSubmit || pending || !operationId || !content.trim()}
          className="h-11 shrink-0 md:h-10 md:rounded-md md:px-4 md:text-ui"
        >
          {pending ? "등록 중..." : "등록"}
        </Button>
      </div>
      {showResult && state.error && <p id={errorId} role="alert" className="text-ui text-destructive">{state.error}</p>}
      {showResult && state.success && <p role="status" className="text-xs text-success">댓글이 저장되었습니다.</p>}
      <DraftStatus
        {...draft}
        quiet
        onRestoreRecovery={draft.restoreRecovery}
        onDiscardRecovery={draft.discardRecovery}
        disabled={pending}
      />
    </form>
  );
}
