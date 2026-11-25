"use client";

import { type ChangeEvent, type Ref, useActionState, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createComment, type CreateCommentState } from "@/lib/actions/comments";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { CREATION_OPERATION_FIELD, createCreationOperationId, parseCreationOperationId } from "@/lib/creation-operation";
import {
  COMMENT_COUNTER_FROM,
  COMMENT_MAX_LENGTH,
  COMMENT_PARENT_FIELD,
  COMMENT_REPLY_TO_FIELD,
  commentReplyDraftContext,
  limitCommentContent,
} from "@/lib/community-comment";
import { COMMENT_TIME_MARKER_FIELD, formatTimeMarker, parseTimeMarkerRange } from "@/lib/community-mixset-media";
import { TIME_RANGE_SEPARATOR } from "@/lib/time-range";

const COMMENT_MAX_LABEL = new Intl.NumberFormat("ko-KR").format(COMMENT_MAX_LENGTH);

type CommentDraft = { content: string; timeMarker?: string; operationId?: string };

/** 게시물 댓글 입력(원 댓글)에 바깥에서 글을 넣는 손잡이. 지워진 원 댓글에 쓰던 답글을 새 댓글로 옮길 때 쓴다. */
export type CommentFormHandle = {
  /** 입력 끝에 글을 붙이고(쓰던 글이 있으면 한 칸 띄워) 초안에 남긴 뒤 입력으로 초점을 옮긴다. 붙이지 못하면 false. */
  appendText: (text: string) => boolean;
};

const ORPHAN_REPLY_MESSAGE = "원 댓글이 삭제되어 답글을 달 수 없습니다. 쓴 글은 새 댓글로 남길 수 있습니다.";

/**
 * 게시물 댓글 입력(캔버스 CommunityPost·MobileCommunityPost 댓글 줄: 한 줄 입력 + 등록).
 * 입력값은 이 기기 초안으로 조용히 보존하고, 복원·충돌·오류·복구본이 있을 때만 줄 아래에 안내한다.
 * 매체가 있는 믹스셋 게시물이면 선택 칸 "시점"을 더해 재생 위치에 댓글을 남긴다(비우면 일반 댓글).
 * 내용은 서버 한도(5,000자)에서 멈추고, 4,500자부터 줄 아래에 글자 수를 보인다(캔버스 "코드 리뷰 2차 후속" ③).
 * parentId가 있으면 답글 입력(캔버스 CommunityReplies): 묶음 아래에 열리고, 초안은 원 댓글 묶음마다 따로 보존하며,
 * 시점 칸 없이 취소·등록을 둔다. mention("@이름 ")은 입력이 비어 있을 때만 미리 넣는다.
 * 쓰는 사이 원 댓글이 지워지면(목록에서 사라졌거나 등록이 그 이유로 거절됨) 입력은 그대로 두고 등록 대신
 * 버리기·새 댓글로 남기기를 둔다(캔버스 UxReview1120Lessons ⑧).
 */
export function CommentForm({
  postId,
  actorId,
  onSaved,
  className,
  allowTimeMarker: allowTimeMarkerProp = false,
  readPlaybackPosition,
  parentId,
  replyToId,
  replyLabel,
  mention = null,
  onCancel,
  orphaned = false,
  onRootMissing,
  onDiscardOrphan,
  onMoveToComment,
  ref,
}: {
  postId: string;
  actorId: string;
  /** 저장된 댓글 ID와 함께 부른다. */
  onSaved: (commentId: string) => void;
  /** 좁은 화면 아래 고정 막대처럼 놓일 자리의 모양 */
  className?: string;
  /** 매체가 있는 믹스셋 게시물에서만 true: 재생 시점 칸을 보인다. */
  allowTimeMarker?: boolean;
  /** "현재 위치"로 시점을 채울 때 읽는 플레이어 위치(초). 없거나 null이면 읽지 못했다고 알린다. */
  readPlaybackPosition?: () => Promise<number | null>;
  /** 답글을 달 원 댓글 ID. 있으면 답글 입력이다. */
  parentId?: string;
  /** 답글의 답글이면 "답글"을 누른 그 답글 ID. 알림 대상만 정하고 초안·묶음은 parentId를 따른다. */
  replyToId?: string;
  /** 답글 입력 칸 이름(예: "이학생 댓글에 답글"). */
  replyLabel?: string;
  /** 답글의 답글이면 미리 넣을 "@이름 ". */
  mention?: string | null;
  /** 답글 입력 닫기(취소·Esc). 입력값은 초안으로 남는다. */
  onCancel?: () => void;
  /** 답글을 달 원 댓글이 목록에서 사라졌다. */
  orphaned?: boolean;
  /** 등록했는데 원 댓글이 지워져 저장되지 않았다(목록을 다시 받을 때 쓴다). */
  onRootMissing?: () => void;
  /** 원 댓글이 지워진 답글을 버렸다(초안은 이미 지움). */
  onDiscardOrphan?: () => void;
  /** 원 댓글이 지워진 답글을 새 댓글 입력으로 옮긴다. 옮겼으면 true를 돌려주고 답글 초안을 지운다. */
  onMoveToComment?: (text: string) => boolean;
  /** 원 댓글 입력에 바깥에서 글을 넣는 손잡이. */
  ref?: Ref<CommentFormHandle>;
}) {
  const isReply = Boolean(parentId);
  // 답글에는 재생 시점이 없다(파형 아이콘은 원 댓글만).
  const allowTimeMarker = allowTimeMarkerProp && !isReply;
  const contentId = useId();
  const errorId = useId();
  const lengthId = useId();
  const timeId = useId();
  const timeHelpId = useId();
  const timeErrorId = useId();
  const orphanAlertId = useId();
  const contentRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  // 시점 입력·제출·초기화가 일어나면 진행 중인 ‘현재 위치’ 읽기 결과를 버린다.
  const positionReadGeneration = useRef(0);
  const [content, setContent] = useState("");
  // 한도를 넘겨 붙여넣어 뒷부분이 잘렸는지. 한 글자씩 더 치다 멈춘 것과 안내 문구가 다르다.
  const [pasteCut, setPasteCut] = useState(false);
  const [timeMarker, setTimeMarker] = useState("");
  const [timeError, setTimeError] = useState<string | null>(null);
  const [positionStatus, setPositionStatus] = useState<string | null>(null);
  const [readingPosition, setReadingPosition] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [showResult, setShowResult] = useState(false);
  const draft = useFormDraft<CommentDraft>(
    createDocumentDraftKey("community-comment", actorId, parentId ? commentReplyDraftContext(postId, parentId) : postId),
    (saved) => {
      setContent(typeof saved.content === "string" ? limitCommentContent(saved.content).value : "");
      setPasteCut(false);
      setTimeMarker(allowTimeMarker && typeof saved.timeMarker === "string" ? saved.timeMarker : "");
      setOperationId(parseCreationOperationId(saved.operationId) ?? createCreationOperationId());
      setTimeError(null);
      setShowResult(false);
    },
    { onReset: () => { positionReadGeneration.current += 1; setContent(""); setPasteCut(false); setTimeMarker(""); setTimeError(null); setOperationId(createCreationOperationId()); setShowResult(false); } },
  );
  const [state, action, pending] = useActionState<CreateCommentState, FormData>(async (previous, data) => {
    let result: CreateCommentState;
    try {
      result = await createComment(postId, previous, data);
    } catch {
      return { error: "저장 결과를 확인하지 못했습니다. 댓글 목록을 확인한 뒤 다시 시도해 주세요." };
    }
    if (result.replyRootMissing) onRootMissing?.();
    if (result.success && result.commentId) {
      const submittedContent = String(data.get("content") ?? "");
      const submittedTimeMarker = String(data.get(COMMENT_TIME_MARKER_FIELD) ?? "");
      draft.clear({
        reason: "submitted",
        submittedData: { content: submittedContent, timeMarker: submittedTimeMarker, operationId: String(data.get(CREATION_OPERATION_FIELD) ?? "") },
        submittedAliases: [{ content: submittedContent }, { content: submittedContent, timeMarker: submittedTimeMarker }],
      });
      setContent("");
      setPasteCut(false);
      positionReadGeneration.current += 1;
      setTimeMarker("");
      setPositionStatus(null);
      setOperationId(createCreationOperationId());
      onSaved(result.commentId);
    }
    return result;
  }, {});
  useBusyNavigationGuard(pending);

  // 답글의 답글: 입력이 비어 있거나 앞서 넣은 "@이름 " 그대로일 때만 새 이름으로 바꾼다(초안·직접 쓴 글은 두고).
  // 원 댓글의 "답글"로 바꾸면(이름 없음) 앞서 넣은 "@이름 "만 있던 입력을 비운다.
  const [appliedMention, setAppliedMention] = useState<string | null>(null);
  if (draft.loaded && (mention ?? null) !== appliedMention) {
    setAppliedMention(mention ?? null);
    if (content === "" || content === appliedMention) setContent(mention ?? "");
  }
  const untouchedMention = appliedMention !== null && content === appliedMention;
  const orphan = isReply && (orphaned || state.replyRootMissing === true);

  // 답글 입력은 열리거나 다른 답글에 답하면 입력 칸으로 초점을 옮기고 커서를 끝에 둔다.
  useEffect(() => {
    if (!isReply || !draft.loaded) return;
    const input = contentRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [isReply, draft.loaded, mention]);

  // 내용이나 시점이 바뀌면 다른 제출이므로 작업 식별자를 새로 만든다(서버 재시도 비교에 시점도 들어간다).
  const saveDraft = (next: { content: string; timeMarker: string }) => {
    const nextOperationId = createCreationOperationId();
    setOperationId(nextOperationId);
    setShowResult(false);
    if (next.content || next.timeMarker) draft.save({ ...next, operationId: nextOperationId });
    else draft.clear();
  };

  const changeContent = (event: ChangeEvent<HTMLInputElement>) => {
    const limited = limitCommentContent(event.target.value);
    setContent(limited.value);
    setPasteCut(limited.cut > 1);
    saveDraft({ content: limited.value, timeMarker });
  };
  const changeTimeMarker = (value: string) => {
    positionReadGeneration.current += 1;
    setTimeMarker(value);
    setTimeError(null);
    setPositionStatus(null);
    saveDraft({ content, timeMarker: value });
  };

  useImperativeHandle(ref, () => ({
    appendText(text) {
      const input = contentRef.current;
      if (!draft.loaded || !draft.canSubmit || pending || !input || !text.trim()) return false;
      const current = input.value;
      const limited = limitCommentContent(current.trim() ? `${current.trimEnd()} ${text.trimEnd()}` : text.trimEnd());
      setContent(limited.value);
      setPasteCut(limited.cut > 0);
      saveDraft({ content: limited.value, timeMarker });
      input.focus({ preventScroll: true });
      input.scrollIntoView?.({ block: "nearest" });
      // 새 값이 그려진 뒤 커서를 끝에 둔다.
      requestAnimationFrame(() => {
        if (contentRef.current !== input) return;
        input.setSelectionRange(input.value.length, input.value.length);
      });
      return true;
    },
  }));

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

  // 시작 한 점만 채운 뒤 더 듣다가 누르면 지금 위치를 구간 끝으로 붙인다.
  const parsedMarker = allowTimeMarker ? parseTimeMarkerRange(timeMarker) : null;
  const rangeStart = parsedMarker?.ok && parsedMarker.seconds !== null && parsedMarker.endSeconds === null ? parsedMarker.seconds : null;
  const fillRangeEnd = async () => {
    if (rangeStart === null) return;
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
      const end = Math.floor(seconds);
      if (end <= rangeStart) {
        setPositionStatus("끝 위치는 시작보다 뒤여야 합니다. 조금 더 들은 뒤 눌러 주세요.");
        return;
      }
      const marker = `${formatTimeMarker(rangeStart)}${TIME_RANGE_SEPARATOR}${formatTimeMarker(end)}`;
      setTimeMarker(marker);
      setTimeError(null);
      saveDraft({ content: contentRef.current?.value ?? content, timeMarker: marker });
      contentRef.current?.focus();
    } catch {
      if (generation !== positionReadGeneration.current) return;
      setPositionStatus("재생 위치를 읽지 못했습니다. 끝 시점을 직접 입력해 주세요.");
    } finally {
      setReadingPosition(false);
    }
  };

  const controlsDisabled = !draft.loaded || pending;
  const contentLength = content.length < COMMENT_COUNTER_FROM ? 0 : [...content].length;
  const showLength = contentLength >= COMMENT_COUNTER_FROM;
  const atLimit = contentLength >= COMMENT_MAX_LENGTH;
  const contentDescribedBy = [showLength ? lengthId : null, showResult && state.error ? errorId : null].filter(Boolean).join(" ");
  const timeDescribedBy = [timeHelpId, timeError ? timeErrorId : null].filter(Boolean).join(" ");

  return (
    <form
      action={action}
      // 평소에는 비어 있는 초안 상태 묶음이 줄 아래 간격을 만들지 않게 숨긴다.
      className={cn("flex flex-col gap-1 [&>[role=group]:empty]:hidden", className)}
      onBlur={draft.flush}
      onSubmit={(event) => {
        if (!draft.loaded || !draft.canSubmit || pending || !operationId || orphan) {
          event.preventDefault();
          return;
        }
        // 서버가 최종 판단하지만 형식이 틀린 시점은 보내기 전에 칸 옆에서 알린다.
        if (allowTimeMarker) {
          const parsed = parseTimeMarkerRange(timeMarker);
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
      {parentId ? <input type="hidden" name={COMMENT_PARENT_FIELD} value={parentId} /> : null}
      {parentId && replyToId ? <input type="hidden" name={COMMENT_REPLY_TO_FIELD} value={replyToId} /> : null}
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
            placeholder="분:초"
            value={timeMarker}
            onChange={(event) => changeTimeMarker(event.target.value)}
            disabled={controlsDisabled}
            aria-invalid={timeError ? true : undefined}
            aria-describedby={timeDescribedBy}
            className="w-[8.5rem] font-mono placeholder:text-faint md:h-8"
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
          {readPlaybackPosition && rangeStart !== null ? (
            <button
              type="button"
              onClick={fillRangeEnd}
              disabled={controlsDisabled || readingPosition}
              aria-label={`${formatTimeMarker(rangeStart)}부터 지금 위치까지 구간으로`}
              className="inline-flex h-11 items-center rounded-sm px-1.5 text-xs text-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:h-8"
            >
              여기까지
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
          <span id={timeHelpId} className="sr-only">선택 항목입니다. 예: 12:34 또는 1:05:30, 구간은 12:34~13:10. 비우면 시점 없는 댓글로 남습니다.</span>
        </div>
      ) : null}
      {timeError ? <p id={timeErrorId} role="alert" className="text-xs text-destructive">{timeError}</p> : null}
      {/* 첫 안내 전에 화면 낭독기가 영역을 알도록 시점 칸이 있으면 늘 둔다. 비어 있으면 줄 간격을 만들지 않게 감춘다. */}
      {allowTimeMarker ? (
        <p role="status" className={positionStatus ? "text-xs text-muted-foreground" : "sr-only"}>{positionStatus ?? ""}</p>
      ) : null}
      <label htmlFor={contentId} className="sr-only">{orphan ? "삭제된 댓글에 쓰던 답글" : isReply ? (replyLabel ?? "답글 내용") : "댓글 내용"}</label>
      {orphan ? (
        // 원 댓글이 지워진 답글: 입력은 그대로 두고 아래에 이유와 버리기·새 댓글로 남기기를 둔다.
        <div className="flex flex-col gap-1.5">
          <Input
            ref={contentRef}
            id={contentId}
            name="content"
            type="text"
            value={content}
            onChange={changeContent}
            disabled={!draft.loaded}
            aria-describedby={[orphanAlertId, contentDescribedBy].filter(Boolean).join(" ") || undefined}
            className="min-w-0"
          />
          <p id={orphanAlertId} role="alert" className="text-xs leading-[18px] text-destructive">{ORPHAN_REPLY_MESSAGE}</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                draft.clear({ reason: "discard" });
                setContent("");
                onDiscardOrphan?.();
              }}
              disabled={!draft.loaded}
              className="h-11 rounded-touch px-3 text-md md:h-8 md:rounded-md md:px-2.5 md:text-ui"
            >
              버리기
            </Button>
            {onMoveToComment ? (
              <Button
                type="button"
                onClick={() => {
                  if (!onMoveToComment(content)) return;
                  draft.clear({ reason: "discard" });
                  setContent("");
                }}
                disabled={!draft.loaded || !content.trim() || untouchedMention}
                className="h-11 rounded-touch px-4 text-md md:h-8 md:rounded-md md:px-3 md:text-ui"
              >
                새 댓글로 남기기
              </Button>
            ) : null}
          </div>
        </div>
      ) : isReply ? (
        // 답글 입력: 넓은 화면은 한 줄(입력 36 · 취소 · 등록), 휴대폰은 입력 44 아래 오른쪽에 취소·등록 44.
        <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-2">
          <Input
            ref={contentRef}
            id={contentId}
            name="content"
            type="text"
            placeholder="답글을 입력하세요..."
            value={content}
            onChange={changeContent}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !onCancel || pending) return;
              event.preventDefault();
              onCancel();
            }}
            required
            disabled={!draft.loaded || pending}
            aria-describedby={contentDescribedBy || undefined}
            className="min-w-0 md:flex-1"
          />
          <div className="flex justify-end gap-2">
            {onCancel ? (
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                disabled={pending}
                className="h-11 rounded-touch px-3 text-md md:h-9 md:rounded-md md:px-2.5 md:text-ui"
              >
                취소
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={!draft.loaded || !draft.canSubmit || pending || !operationId || !content.trim() || untouchedMention}
              className="h-11 rounded-touch px-4 text-md md:h-9 md:rounded-md md:px-3.5 md:text-ui"
            >
              {pending ? "등록 중..." : "등록"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            ref={contentRef}
            id={contentId}
            name="content"
            type="text"
            placeholder="댓글을 입력하세요..."
            value={content}
            onChange={changeContent}
            required
            disabled={!draft.loaded || pending}
            aria-describedby={contentDescribedBy || undefined}
            className="min-w-0 flex-1 md:h-10"
          />
          {/* 좁은 화면은 Q&A 답변 입력줄과 같은 44px 화살표 버튼, 넓은 화면은 글자 버튼(B 묶음 ④). */}
          <Button
            type="submit"
            size="touch"
            disabled={!draft.loaded || !draft.canSubmit || pending || !operationId || !content.trim()}
            aria-label={pending ? "등록 중" : "댓글 등록"}
            className="size-11 shrink-0 px-0 md:h-10 md:w-auto md:rounded-md md:px-4 md:text-ui"
          >
            <ArrowUp className="size-4 md:hidden" strokeWidth={1.8} aria-hidden="true" />
            <span aria-hidden="true" className="hidden md:inline">{pending ? "등록 중..." : "등록"}</span>
          </Button>
        </div>
      )}
      {/* 글자 수 줄은 한도에 가까워졌을 때만 보인다. 첫 안내가 읽히도록 자리는 늘 두고, 평소에는 간격을 만들지 않게 감춘다. */}
      <p
        id={lengthId}
        role="status"
        className={showLength ? cn("text-xs", atLimit ? "text-destructive" : "text-muted-foreground") : "sr-only"}
      >
        {showLength ? (
          <>
            <span className="font-mono">{new Intl.NumberFormat("ko-KR").format(contentLength)} / {COMMENT_MAX_LABEL}</span>
            {atLimit ? ` · ${pasteCut ? `${COMMENT_MAX_LABEL}자까지만 들어갔습니다.` : "더 입력할 수 없습니다."}` : null}
          </>
        ) : null}
      </p>
      {showResult && state.error && !orphan && <p id={errorId} role="alert" className="text-ui text-destructive">{state.error}</p>}
      {showResult && state.success && !isReply && <p role="status" className="text-xs text-success">댓글이 저장되었습니다.</p>}
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
