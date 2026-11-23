/**
 * @file src/components/community/CommentEditForm.tsx
 * @description 내가 쓴 댓글·답글을 그 자리에서 고치는 칸(감사 보완, 2026-11-23). 작성자 본인만 연다.
 * 고치는 중인 내용은 이 기기에 남고(local draft) 저장 중에는 이탈을 막는다. "취소"는 보관본까지 버리고,
 * Esc는 칸만 닫고 보관본을 남긴다(다시 열면 되살아난다. 한글 조합 중 Esc는 무시).
 * 서버는 고치기 시작할 때 본 내용과 지금 내용이 같을 때만 바꾼다(updateComment).
 */
"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { updateComment } from "@/lib/actions/comments";
import { COMMENT_MAX_LENGTH, commentPlainText } from "@/lib/community-comment";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { useUnsavedUnloadGuard } from "@/lib/hooks/useUnsavedUnloadGuard";
import { cn } from "@/lib/utils";

type EditDraft = { content: string; expectedHtml: string };

export function CommentEditForm({
  actorId,
  postId,
  comment,
  label,
  onSaved,
  onCancel,
  className,
}: {
  actorId: string;
  postId: string;
  comment: { id: string; contentHtml: string };
  /** 화면 읽기용 이름(예: "Stann 댓글"). */
  label: string;
  onSaved: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const fieldId = useId();
  // 고치기 시작할 때 본 내용. 보관본을 되살리면 보관본이 본 내용을 써서, 그 사이 바뀐 댓글을 모르고 덮지 않는다.
  const [expectedHtml, setExpectedHtml] = useState(comment.contentHtml);
  const initialText = commentPlainText(comment.contentHtml);
  const [content, setContent] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draft = useFormDraft<EditDraft>(
    createDocumentDraftKey("community-comment", actorId, `edit:${comment.id}`),
    (saved) => {
      if (typeof saved.content === "string") setContent(saved.content);
      if (typeof saved.expectedHtml === "string") setExpectedHtml(saved.expectedHtml);
    },
  );
  const dirty = content !== initialText;
  useBusyNavigationGuard(isPending);
  useUnsavedUnloadGuard(dirty && !isPending);
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);

  const change = (next: string) => {
    setContent(next);
    setError(null);
    if (next === initialText) draft.clear({ reason: "empty" });
    else draft.save({ content: next, expectedHtml });
  };

  const cancel = () => {
    draft.clear({ reason: "discard" });
    onCancel();
  };

  const dismiss = () => {
    if (!dirty) {
      cancel();
      return;
    }
    draft.flush();
    onCancel();
  };

  const tooLong = [...content].length > COMMENT_MAX_LENGTH;

  return (
    <form
      aria-label={`${label} 고치기`}
      className={cn("flex flex-col gap-2", className)}
      onBlur={draft.flush}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || isPending || event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        dismiss();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (isPending || !draft.loaded || !draft.canSubmit || !content.trim() || tooLong) return;
        const submitted = { content, expectedHtml };
        setError(null);
        startTransition(async () => {
          try {
            const result = await updateComment(comment.id, postId, submitted);
            if ("error" in result) {
              setError(result.error);
              return;
            }
            draft.clear({ reason: "submitted", submittedData: submitted });
            onSaved();
          } catch {
            setError("댓글을 고치지 못했습니다. 다시 시도해 주세요.");
          }
        });
      }}
    >
      <label htmlFor={fieldId} className="sr-only">{label} 내용</label>
      <textarea
        ref={textareaRef}
        id={fieldId}
        rows={3}
        value={content}
        disabled={!draft.loaded || isPending}
        onChange={(event) => change(event.target.value)}
        aria-invalid={error || tooLong ? true : undefined}
        className="w-full resize-y rounded-touch border border-input bg-background px-3 py-2.5 text-base text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:rounded-md md:py-2 md:text-sm"
      />
      {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : null}
      {tooLong ? (
        <p role="alert" className="text-ui text-destructive">
          댓글은 {new Intl.NumberFormat("ko-KR").format(COMMENT_MAX_LENGTH)}자까지 쓸 수 있습니다.
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={isPending} className="max-md:h-11">취소</Button>
        <Button type="submit" size="sm" pending={isPending} disabled={!draft.loaded || !draft.canSubmit || !content.trim() || tooLong} className="max-md:h-11">
          저장
        </Button>
      </div>
      <DraftStatus {...draft} onRestoreRecovery={draft.restoreRecovery} onDiscardRecovery={draft.discardRecovery} disabled={isPending} quiet />
    </form>
  );
}
