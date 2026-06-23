/**
 * @file src/components/qna/ThreadDetailClient.tsx
 * @description Q&A 스레드 상세 클라이언트 컴포넌트.
 * 답변 작성 폼(TiptapEditor) + 어드민 상태 변경 버튼.
 */
"use client";

import { useActionState, useState, useEffect, useTransition } from "react";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false }
);
import { ReplyCard } from "./ReplyCard";
import { AttachmentField } from "./AttachmentField";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { createQnaReply, updateThreadStatus, type CreateReplyState } from "@/lib/actions/qna";
import { QNA_STATUS_LABELS } from "@/lib/qna-status";
import type { QnaStatus } from "@/db/schema";

type Reply = {
  id: string;
  contentHtml: string;
  attachmentUrl: string | null | undefined;
  createdAt: Date | null | undefined;
  authorName: string | null | undefined;
  authorEmail: string | null | undefined;
  authorRole: string | null | undefined;
};

interface ThreadDetailClientProps {
  threadId: string;
  status: QnaStatus;
  replies: Reply[];
  isAdmin: boolean;
  isClosed: boolean;
}

export function ThreadDetailClient({
  threadId,
  status,
  replies: initialReplies,
  isAdmin,
  isClosed,
}: ThreadDetailClientProps) {
  const [contentHtml, setContentHtml] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [isPending, startTransition] = useTransition();

  const boundAction = createQnaReply.bind(null, threadId);
  const [replyState, replyAction, isReplying] = useActionState<
    CreateReplyState,
    FormData
  >(boundAction, {});

  // 스레드별 임시저장 복원/저장
  const { loaded, save, clear } = useFormDraft<{ contentHtml: string; attachmentUrl: string }>(
    `draft:qna:reply:${threadId}`,
    (d) => {
      setContentHtml(d.contentHtml ?? "");
      setAttachmentUrl(d.attachmentUrl ?? "");
    },
  );

  useEffect(() => {
    if (!loaded) return;
    const isEmpty = (!contentHtml || contentHtml === "<p></p>") && !attachmentUrl;
    if (isEmpty) {
      clear();
      return;
    }
    save({ contentHtml, attachmentUrl });
  }, [loaded, contentHtml, attachmentUrl, save, clear]);

  // 답변 등록 성공 시 draft 삭제 + 폼 초기화 (에디터 remount)
  useEffect(() => {
    if (replyState.success) {
      clear();
      setContentHtml("");
      setAttachmentUrl("");
      setEditorKey((k) => k + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyState.success]);

  const handleStatusChange = (newStatus: QnaStatus) => {
    startTransition(() => updateThreadStatus(threadId, newStatus));
  };

  return (
    <div className="space-y-6">
      {/* 답변 목록 */}
      <div className="space-y-4">
        {initialReplies.map((reply) => (
          <ReplyCard key={reply.id} reply={reply} />
        ))}
      </div>

      {/* 구분선 */}
      <div className="border-t border-border" />

      {/* 어드민 상태 변경 */}
      {isAdmin && (
        <div className="flex items-center gap-2" aria-label="스레드 상태 변경">
          <span className="text-xs text-muted-foreground">상태 변경:</span>
          {(["OPEN", "ANSWERED", "CLOSED"] as QnaStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              disabled={status === s || isPending}
              aria-current={status === s ? "true" : undefined}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                status === s
                  ? s === "OPEN"
                    ? "bg-red-500/20 text-red-500"
                    : s === "ANSWERED"
                    ? "bg-green-500/20 text-green-500"
                    : "bg-muted text-muted-foreground"
                  : "border border-border text-muted-foreground hover:bg-accent"
              } disabled:cursor-default`}
            >
              {QNA_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}

      {/* 답변 작성 폼 */}
      {!isClosed && (
        <form action={replyAction} className="space-y-3">
          <input type="hidden" name="contentHtml" value={contentHtml} />
          <p className="text-sm font-medium text-foreground">
            {isAdmin ? "답변 작성" : "추가 질문"}
          </p>
          {replyState.error && (
            <p className="text-sm text-destructive">{replyState.error}</p>
          )}
          {loaded && (
            <FullEditor
              key={editorKey}
              initialContent={contentHtml}
              onChange={setContentHtml}
              placeholder={isAdmin ? "답변을 작성하세요..." : "추가 질문을 입력하세요..."}
              disabled={isReplying}
              minHeight="200px"
            />
          )}
          <AttachmentField value={attachmentUrl} onChange={setAttachmentUrl} disabled={isReplying} />
          <Button type="submit" disabled={isReplying} className="gap-2">
            {isReplying ? "등록 중..." : isAdmin ? "답변 등록" : "질문 추가"}
          </Button>
        </form>
      )}

      {isClosed && (
        <p className="text-sm text-muted-foreground text-center py-4">
          종료된 스레드입니다.
        </p>
      )}
    </div>
  );
}
