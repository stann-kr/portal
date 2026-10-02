"use client";

import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createComment, type CreateCommentState } from "@/lib/actions/comments";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";

type CommentDraft = { content: string };

export function CommentForm({
  postId,
  actorId,
  onSaved,
}: {
  postId: string;
  actorId: string;
  onSaved: () => void;
}) {
  const contentId = useId();
  const errorId = useId();
  const [content, setContent] = useState("");
  const [showResult, setShowResult] = useState(false);
  const draft = useFormDraft<CommentDraft>(
    createDocumentDraftKey("community-comment", actorId, postId),
    (saved) => {
      setContent(typeof saved.content === "string" ? saved.content : "");
      setShowResult(false);
    },
    { onReset: () => { setContent(""); setShowResult(false); } },
  );
  const [state, action, pending] = useActionState<CreateCommentState, FormData>(async (previous, data) => {
    let result: CreateCommentState;
    try {
      result = await createComment(postId, previous, data);
    } catch {
      return { error: "저장 결과를 확인하지 못했습니다. 댓글 목록을 확인한 뒤 다시 시도해 주세요." };
    }
    if (result.success && result.commentId) {
      draft.clear({ reason: "submitted", submittedData: { content: String(data.get("content") ?? "") } });
      setContent("");
      onSaved();
    }
    return result;
  }, {});
  useBusyNavigationGuard(pending);

  return (
    <form
      action={action}
      className="space-y-2"
      onBlur={draft.flush}
      onSubmit={(event) => {
        if (!draft.loaded || !draft.canSubmit || pending) {
          event.preventDefault();
          return;
        }
        draft.save({ content });
        draft.flush();
        setShowResult(true);
      }}
    >
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
            setContent(value);
            setShowResult(false);
            if (value) draft.save({ content: value });
            else draft.clear();
          }}
          required
          disabled={!draft.loaded || pending}
          aria-describedby={showResult && state.error ? errorId : undefined}
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={!draft.loaded || !draft.canSubmit || pending || !content.trim()} size="sm">
          {pending ? "등록 중..." : "등록"}
        </Button>
      </div>
      {showResult && state.error && <p id={errorId} role="alert" className="text-sm text-destructive">{state.error}</p>}
      {showResult && state.success && <p role="status" className="text-xs text-success">댓글이 저장되었습니다.</p>}
      <DraftStatus
        {...draft}
        onRestoreRecovery={draft.restoreRecovery}
        onDiscardRecovery={draft.discardRecovery}
        disabled={pending}
      />
    </form>
  );
}
