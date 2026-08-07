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
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { createQnaReply, updateThreadStatus, type CreateReplyState } from "@/lib/actions/qna";
import { QNA_STATUS_LABELS } from "@/lib/qna-status";
import { STATUS_TONE_CLASS_NAMES } from "@/lib/portal-status";
import type { QnaStatus } from "@/db/schema";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import { persistLocalDraftOnShortcut } from "@/lib/local-draft-shortcut";
import {
  CREATION_OPERATION_FIELD,
  createCreationOperationId,
  parseCreationOperationId,
} from "@/lib/creation-operation";
import { CreationConflictActions } from "@/components/editor/CreationConflictActions";

type Reply = {
  id: string;
  contentHtml: string;
  attachmentUrl: string | null | undefined;
  createdAt: Date | null | undefined;
  authorName: string | null | undefined;
  authorEmail: string | null | undefined;
  authorRole: string | null | undefined;
};

type QnaReplyDraft = {
  operationId?: string;
  contentHtml: string;
  attachmentUrl: string;
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
  const {
    contentHtml,
    contentVersion,
    setContentHtml,
    handleEditorChange,
    handleEditorDirty,
    readLatestContentHtml,
    commitLatestContentHtml,
  } = useDeferredEditorContent("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [operationId, setOperationId] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [currentStatus, setCurrentStatus] = useState(status);
  const [statusError, setStatusError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const contentInputRef = useRef<HTMLInputElement>(null);
  const submittedReplyRef = useRef<QnaReplyDraft | null>(null);
  const handledReplyIdRef = useRef<string | null>(null);
  const router = useRouter();

  useEffect(() => setCurrentStatus(status), [status]);

  const boundAction = createQnaReply.bind(null, threadId);
  const [replyState, replyAction, isReplying] = useActionState<
    CreateReplyState,
    FormData
  >(boundAction, {});
  const isReplyFormBusy = isReplying || isUploading || isPending;
  useBusyNavigationGuard(isReplyFormBusy);

  // 스레드별 임시저장 복원/저장
  const {
    loaded,
    canSubmit,
    save,
    clear,
    flush,
    status: draftStatus,
    savedAt,
    restored,
    recoveries,
    restoreRecovery,
    discardRecovery,
    serverSync,
  } = useSyncedFormDraft<QnaReplyDraft>(
    createDocumentDraftKey("qna-reply", actorId, threadId),
    (d) => {
      setOperationId(
        parseCreationOperationId(d.operationId) ?? createCreationOperationId(),
      );
      setContentHtml(d.contentHtml ?? "");
      setAttachmentUrl(d.attachmentUrl ?? "");
    },
    {
      onReset: () => {
        setOperationId(createCreationOperationId());
        setContentHtml("");
        setAttachmentUrl("");
        setEditorKey((key) => key + 1);
      },
    },
  );
  const handleReplySaveShortcut = useDocumentSaveShortcut({
    disabled:
      !loaded ||
      !canSubmit ||
      currentStatus === "CLOSED" ||
      isReplyFormBusy ||
      !operationId,
    onSave: () => persistLocalDraftOnShortcut({
      createSnapshot: () => ({
        operationId,
        contentHtml: readLatestContentHtml(),
        attachmentUrl,
      }),
      isEmpty: (draft) =>
        isRichTextEmpty(draft.contentHtml) && !draft.attachmentUrl,
      clear,
      save,
      flush,
    }),
  });

  useEffect(() => {
    if (!loaded) return;
    const latestContentHtml = readLatestContentHtml();
    const isEmpty = isRichTextEmpty(latestContentHtml) && !attachmentUrl;
    if (isEmpty) {
      clear();
      return;
    }
    if (!operationId) return;
    save({
      operationId,
      attachmentUrl,
      get contentHtml() {
        return readLatestContentHtml();
      },
    });
  }, [loaded, contentHtml, attachmentUrl, operationId, readLatestContentHtml, save, clear]);

  // 답변 등록 성공 시 draft 삭제 + 폼 초기화 (에디터 remount)
  useEffect(() => {
    if (replyState.replyId && handledReplyIdRef.current !== replyState.replyId) {
      handledReplyIdRef.current = replyState.replyId;
      clear({
        reason: "submitted",
        submittedData: submittedReplyRef.current ?? {
          operationId,
          contentHtml,
          attachmentUrl,
        },
      });
      submittedReplyRef.current = null;
      setOperationId(createCreationOperationId());
      setContentHtml("");
      setAttachmentUrl("");
      setEditorKey((k) => k + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyState.replyId]);

  const hasOperationConflict = Boolean(
    replyState.operationConflict &&
    replyState.conflictedOperationId === operationId &&
    replyState.existingId,
  );
  const hasReplyDraft =
    !isRichTextEmpty(contentHtml) ||
    Boolean(attachmentUrl) ||
    recoveries.length > 0 ||
    draftStatus !== "idle";
  const showReplyComposer = currentStatus !== "CLOSED" || hasReplyDraft;

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
              disabled={!loaded || currentStatus === s || isPending || isReplyFormBusy}
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
      {showReplyComposer && (
        <form
          ref={formRef}
          action={replyAction}
          aria-busy={!loaded || isReplyFormBusy}
          className="space-y-3"
          onKeyDownCapture={handleReplySaveShortcut}
          onSubmit={(event) => {
            if (!loaded || !canSubmit || currentStatus === "CLOSED" || isReplyFormBusy || !operationId) {
              event.preventDefault();
              return;
            }
            const latestContentHtml = commitLatestContentHtml();
            if (isRichTextEmpty(latestContentHtml)) {
              event.preventDefault();
              return;
            }
            if (contentInputRef.current) contentInputRef.current.value = latestContentHtml;
            const submittedReply = {
              operationId,
              contentHtml: latestContentHtml,
              attachmentUrl,
            };
            save(submittedReply);
            flush();
            submittedReplyRef.current = submittedReply;
          }}
        >
          <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
          <input ref={contentInputRef} type="hidden" name="contentHtml" value={contentHtml} />
          <p className="text-sm font-medium text-foreground">
            {currentStatus === "CLOSED"
              ? "미전송 초안"
              : isAdmin
                ? "답변 작성"
                : "추가 질문"}
          </p>
          {currentStatus === "CLOSED" ? (
            <p role="status" className="rounded-md border border-warning/25 bg-warning-muted px-3 py-2 text-sm text-foreground">
              스레드가 종료되어 등록할 수 없지만, 작성 중이던 내용은 이 기기에 보존되어 있습니다. 내용을 복사하거나 관리자가 다시 열 때 이어서 등록할 수 있습니다.
            </p>
          ) : null}
          {replyState.error && (!replyState.operationConflict || hasOperationConflict) && (
            <p role="alert" className="text-sm text-destructive">{replyState.error}</p>
          )}
          {hasOperationConflict ? (
            <CreationConflictActions
              existingLabel="현재 답변 새로고침"
              separateLabel="별도 답변으로 등록"
              onOpenExisting={() => router.refresh()}
              onSeparate={() => setOperationId(createCreationOperationId())}
              disabled={isReplyFormBusy}
            />
          ) : null}
          {replyState.success && !hasReplyDraft ? (
            <p role="status" className="text-sm text-success">등록했습니다.</p>
          ) : null}
          {loaded && (
            <FullEditor
              key={editorKey}
              initialContent={contentHtml}
              contentVersion={contentVersion}
              onChange={handleEditorChange}
              onDirty={(reader) => {
                handleEditorDirty(reader);
                if (!operationId) return;
                save({
                  operationId,
                  attachmentUrl,
                  get contentHtml() {
                    return reader();
                  },
                });
              }}
              placeholder={isAdmin ? "답변을 작성하세요..." : "추가 질문을 입력하세요..."}
              disabled={currentStatus === "CLOSED" || isReplyFormBusy}
              minHeight="200px"
              ariaLabel={isAdmin ? "Q&A 답변 내용" : "Q&A 추가 질문 내용"}
              footer={
                <DraftStatus
                  status={draftStatus}
                  canSubmit={canSubmit}
                  savedAt={savedAt}
                  restored={restored}
                  recoveries={recoveries}
                  onRestoreRecovery={restoreRecovery}
                  onDiscardRecovery={discardRecovery}
                  serverSync={serverSync}
                  disabled={isReplyFormBusy}
                />
              }
              saveShortcutLabel={
                canSubmit && currentStatus !== "CLOSED" ? "초안 저장" : undefined
              }
            />
          )}
          <AttachmentField
            value={attachmentUrl}
            onChange={setAttachmentUrl}
            disabled={!loaded || currentStatus === "CLOSED" || isReplyFormBusy}
            onUploadingChange={setIsUploading}
          />
          {currentStatus !== "CLOSED" ? (
            <Button type="submit" disabled={!loaded || !canSubmit || isReplyFormBusy || !operationId || isRichTextEmpty(contentHtml)} className="gap-2">
              {isUploading
                ? "업로드 완료 대기..."
                : isReplying
                  ? "등록 중..."
                  : isAdmin
                    ? "답변 등록"
                    : "질문 추가"}
            </Button>
          ) : null}
        </form>
      )}

      {currentStatus === "CLOSED" && !hasReplyDraft && (
        <p className="text-sm text-muted-foreground text-center py-4">
          종료된 스레드입니다.
        </p>
      )}
    </div>
  );
}
