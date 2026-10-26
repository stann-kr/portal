"use client";

import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createComment, type CreateCommentState } from "@/lib/actions/comments";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { CREATION_OPERATION_FIELD, createCreationOperationId, parseCreationOperationId } from "@/lib/creation-operation";

type CommentDraft = { content: string; operationId?: string };

/**
 * 게시물 댓글 입력(캔버스 CommunityPost·MobileCommunityPost 댓글 줄: 한 줄 입력 + 등록).
 * 입력값은 이 기기 초안으로 조용히 보존하고, 복원·충돌·오류·복구본이 있을 때만 줄 아래에 안내한다.
 */
export function CommentForm({
  postId,
  actorId,
  onSaved,
  className,
}: {
  postId: string;
  actorId: string;
  onSaved: () => void;
  /** 좁은 화면 아래 고정 막대처럼 놓일 자리의 모양 */
  className?: string;
}) {
  const contentId = useId();
  const errorId = useId();
  const [content, setContent] = useState("");
  const [operationId, setOperationId] = useState("");
  const [showResult, setShowResult] = useState(false);
  const draft = useFormDraft<CommentDraft>(
    createDocumentDraftKey("community-comment", actorId, postId),
    (saved) => {
      setContent(typeof saved.content === "string" ? saved.content : "");
      setOperationId(parseCreationOperationId(saved.operationId) ?? createCreationOperationId());
      setShowResult(false);
    },
    { onReset: () => { setContent(""); setOperationId(createCreationOperationId()); setShowResult(false); } },
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
      draft.clear({ reason: "submitted", submittedData: { content: submittedContent, operationId: String(data.get(CREATION_OPERATION_FIELD) ?? "") }, submittedAliases: [{ content: submittedContent }] });
      setContent("");
      setOperationId(createCreationOperationId());
      onSaved();
    }
    return result;
  }, {});
  useBusyNavigationGuard(pending);

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
        draft.save({ content, operationId });
        draft.flush();
        setShowResult(true);
      }}
    >
      <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
      <label htmlFor={contentId} className="sr-only">댓글 내용</label>
      <div className="flex gap-2">
        <Input
          id={contentId}
          name="content"
          type="text"
          placeholder="댓글을 입력하세요..."
          value={content}
          onChange={(event) => {
            const value = event.target.value;
            const nextOperationId = createCreationOperationId();
            setContent(value);
            setOperationId(nextOperationId);
            setShowResult(false);
            if (value) draft.save({ content: value, operationId: nextOperationId });
            else draft.clear();
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
