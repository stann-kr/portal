/**
 * @file src/components/qna/ThreadDetailClient.tsx
 * @description Q&A 스레드 상세 클라이언트 컴포넌트.
 * 답변 작성 폼(TiptapEditor) + 어드민 상태 변경 버튼.
 */
"use client";

import { useActionState, useState, useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
import { STATUS_TONE_CLASS_NAMES } from "@/lib/portal-status";
import type { QnaStatus } from "@/db/schema";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";

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
  actorId: string;
  title: string;
  studentName: string;
  createdAt: string | null;
  returnTo: string;
}

export function ThreadDetailClient({
  threadId,
  status,
  replies: initialReplies,
  isAdmin,
  actorId,
  title,
  studentName,
  createdAt,
  returnTo,
}: ThreadDetailClientProps) {
  const [contentHtml, setContentHtml] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [currentStatus, setCurrentStatus] = useState(status);
  const [statusError, setStatusError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submittedReplyRef = useRef<{
    contentHtml: string;
    attachmentUrl: string;
  } | null>(null);
  const handledReplyIdRef = useRef<string | null>(null);
  const router = useRouter();

  useEffect(() => setCurrentStatus(status), [status]);

  const boundAction = createQnaReply.bind(null, threadId);
  const [replyState, replyAction, isReplying] = useActionState<
    CreateReplyState,
    FormData
  >(boundAction, {});
  const isReplyFormBusy = isReplying || isUploading;
  useBusyNavigationGuard(isReplyFormBusy);

  // 스레드별 임시저장 복원/저장
  const {
    loaded,
    save,
    clear,
    status: draftStatus,
    savedAt,
    restored,
    recoveries,
    restoreRecovery,
    discardRecovery,
  } = useFormDraft<{ contentHtml: string; attachmentUrl: string }>(
    createDocumentDraftKey("qna-reply", actorId, threadId),
    (d) => {
      setContentHtml(d.contentHtml ?? "");
      setAttachmentUrl(d.attachmentUrl ?? "");
    },
    {
      onReset: () => {
        setContentHtml("");
        setAttachmentUrl("");
        setEditorKey((key) => key + 1);
      },
    },
  );

  useEffect(() => {
    if (!loaded) return;
    const isEmpty = isRichTextEmpty(contentHtml) && !attachmentUrl;
    if (isEmpty) {
      clear();
      return;
    }
    save({ contentHtml, attachmentUrl });
  }, [loaded, contentHtml, attachmentUrl, save, clear]);

  // 답변 등록 성공 시 draft 삭제 + 폼 초기화 (에디터 remount)
  useEffect(() => {
    if (replyState.replyId && handledReplyIdRef.current !== replyState.replyId) {
      handledReplyIdRef.current = replyState.replyId;
      clear({
        reason: "submitted",
        submittedData: submittedReplyRef.current ?? { contentHtml, attachmentUrl },
      });
      submittedReplyRef.current = null;
      setContentHtml("");
      setAttachmentUrl("");
      setEditorKey((k) => k + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyState.replyId]);

  const handleStatusChange = (newStatus: QnaStatus) => {
    setStatusError(null);
    startTransition(async () => {
      try {
        await updateThreadStatus(threadId, newStatus);
        setCurrentStatus(newStatus);
        router.refresh();
      } catch {
        setStatusError("상태를 변경하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={returnTo}
          aria-disabled={isReplyFormBusy}
          tabIndex={isReplyFormBusy ? -1 : undefined}
          className={`inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground ${
            isReplyFormBusy ? "pointer-events-none opacity-50" : ""
          }`}
          onClick={(event) => {
            if (isReplyFormBusy) event.preventDefault();
          }}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Q&amp;A 목록
        </Link>

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {isAdmin ? <span>{studentName} /</span> : null}
              <span>
                {createdAt
                  ? new Date(createdAt).toLocaleDateString("ko-KR", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : "작성일 미정"}
              </span>
            </div>
          </div>
          <StatusBadge
            status={
              currentStatus === "OPEN"
                ? "qnaOpen"
                : currentStatus === "ANSWERED"
                  ? "qnaAnswered"
                  : "qnaClosed"
            }
          />
        </div>
      </div>

      <div className="border-t border-border" />

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
              type="button"
              disabled={currentStatus === s || isPending || isReplyFormBusy}
              aria-pressed={currentStatus === s}
              className={`rounded-md border px-3 py-1 text-xs font-semibold transition-colors ${
                currentStatus === s
                  ? s === "OPEN"
                    ? STATUS_TONE_CLASS_NAMES.warning
                    : s === "ANSWERED"
                      ? STATUS_TONE_CLASS_NAMES.success
                      : STATUS_TONE_CLASS_NAMES.neutral
                  : "border border-border text-muted-foreground hover:bg-accent"
              } disabled:cursor-default`}
            >
              {QNA_STATUS_LABELS[s]}
            </button>
          ))}
          {isPending ? <span className="text-xs text-muted-foreground">변경 중...</span> : null}
        </div>
      )}
      {statusError ? <p role="alert" className="text-sm text-destructive">{statusError}</p> : null}

      {/* 답변 작성 폼 */}
      {currentStatus !== "CLOSED" && (
        <form
          ref={formRef}
          action={replyAction}
          className="space-y-3"
          onSubmit={(event) => {
            if (isReplyFormBusy) {
              event.preventDefault();
              return;
            }
            submittedReplyRef.current = { contentHtml, attachmentUrl };
          }}
        >
          <input type="hidden" name="contentHtml" value={contentHtml} />
          <p className="text-sm font-medium text-foreground">
            {isAdmin ? "답변 작성" : "추가 질문"}
          </p>
          {replyState.error && (
            <p role="alert" className="text-sm text-destructive">{replyState.error}</p>
          )}
          {replyState.success ? (
            <p role="status" className="text-sm text-success">등록했습니다.</p>
          ) : null}
          {loaded && (
            <FullEditor
              key={editorKey}
              initialContent={contentHtml}
              onChange={setContentHtml}
              placeholder={isAdmin ? "답변을 작성하세요..." : "추가 질문을 입력하세요..."}
              disabled={isReplying}
              minHeight="200px"
              ariaLabel={isAdmin ? "Q&A 답변 내용" : "Q&A 추가 질문 내용"}
              footer={
                <DraftStatus
                  status={draftStatus}
                  savedAt={savedAt}
                  restored={restored}
                  recoveries={recoveries}
                  onRestoreRecovery={restoreRecovery}
                  onDiscardRecovery={discardRecovery}
                  disabled={isReplyFormBusy}
                />
              }
              onSave={() => {
                if (!isReplyFormBusy) formRef.current?.requestSubmit();
              }}
            />
          )}
          <AttachmentField
            value={attachmentUrl}
            onChange={setAttachmentUrl}
            disabled={isReplying}
            onUploadingChange={setIsUploading}
          />
          <Button type="submit" disabled={isReplyFormBusy || isRichTextEmpty(contentHtml)} className="gap-2">
            {isUploading
              ? "업로드 완료 대기..."
              : isReplying
                ? "등록 중..."
                : isAdmin
                  ? "답변 등록"
                  : "질문 추가"}
          </Button>
        </form>
      )}

      {currentStatus === "CLOSED" && (
        <p className="text-sm text-muted-foreground text-center py-4">
          종료된 스레드입니다.
        </p>
      )}
    </div>
  );
}
