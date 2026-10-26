/**
 * @file src/components/qna/QnaSlideForm.tsx
 * @description SlidePanel 내 Q&A 인라인 작성 폼.
 * 저장 성공 시 `onSuccess(newItem)` 콜백으로 낙관적 업데이트 트리거.
 * 첨부 파일 업로드 + 임시저장(draft) 자동 복원 지원.
 */
"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AttachmentField } from "@/components/qna/AttachmentField";
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { createQnaThreadInline, type CreateThreadInlineState } from "@/lib/actions/qna";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import { useRouter } from "next/navigation";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import { persistLocalDraftOnShortcut } from "@/lib/local-draft-shortcut";
import {
  CREATION_OPERATION_FIELD,
  createCreationOperationId,
  parseCreationOperationId,
} from "@/lib/creation-operation";
import { CreationConflictActions } from "@/components/editor/CreationConflictActions";
import { abandonMediaUpload } from "@/lib/actions/upload";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false },
);

interface QnaDraft {
  operationId?: string;
  title: string;
  contentHtml: string;
  attachmentUrl: string;
  attachmentObjectId?: string;
}

interface QnaSlideFormProps {
  actorId: string;
  spaceLabel: string;
  onSuccess: (item: UnifiedItem) => void;
  onClose: () => void;
  returnTo: string;
  onBusyChange?: (isBusy: boolean) => void;
}

export function QnaSlideForm(props: QnaSlideFormProps) {
  return <QnaSlideFormContent key={props.actorId} {...props} />;
}

function QnaSlideFormContent({
  actorId,
  spaceLabel,
  onSuccess,
  onClose,
  returnTo,
  onBusyChange,
}: QnaSlideFormProps) {
  const [title, setTitle] = useState("");
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
  const [attachmentObjectId, setAttachmentObjectId] = useState("");
  const [operationId, setOperationId] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  // 본문 이미지가 올라가는 동안에는 제출하지 않는다. 편집기는 계속 쓸 수 있다.
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  const [state, formAction, isPending] = useActionState<CreateThreadInlineState, FormData>(
    async (previous, data) => {
      try {
        return await createQnaThreadInline(previous, data);
      } catch {
        return { error: "저장 결과를 확인하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요." };
      }
    },
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const contentInputRef = useRef<HTMLInputElement>(null);
  const submittedDraftRef = useRef<QnaDraft | null>(null);
  const handledThreadIdRef = useRef<string | null>(null);
  const router = useRouter();
  const isFormBusy = isPending || isUploading;
  useBusyNavigationGuard(isFormBusy);

  useEffect(() => {
    onBusyChange?.(isFormBusy || isEditorUploading);
  }, [isEditorUploading, isFormBusy, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // 임시저장 복원/저장
  const {
    loaded,
    canSubmit,
    save,
    clear,
    flush,
    status,
    savedAt,
    restored,
    recoveries,
    restoreRecovery,
    discardRecovery,
    serverSync,
  } = useSyncedFormDraft<QnaDraft>(
    createDocumentDraftKey("qna-thread", actorId),
    (d) => {
      setOperationId(
        parseCreationOperationId(d.operationId) ?? createCreationOperationId(),
      );
      setTitle(d.title ?? "");
      setContentHtml(d.contentHtml ?? "");
      setAttachmentUrl(d.attachmentUrl ?? "");
      setAttachmentObjectId(d.attachmentObjectId ?? "");
    },
    {
      onReset: () => {
        setOperationId(createCreationOperationId());
        setTitle("");
        setContentHtml("");
        setAttachmentUrl("");
        setAttachmentObjectId("");
      },
    },
  );
  const handleSaveShortcut = useDocumentSaveShortcut({
    disabled: !loaded || !canSubmit || isFormBusy || isEditorUploading || !operationId,
    onSave: () => persistLocalDraftOnShortcut({
      createSnapshot: () => ({
        operationId,
        title,
        contentHtml: readLatestContentHtml(),
        attachmentUrl,
        attachmentObjectId,
      }),
      isEmpty: (draft) =>
        !draft.title &&
        isRichTextEmpty(draft.contentHtml) &&
        !draft.attachmentUrl &&
        !draft.attachmentObjectId,
      clear,
      save,
      flush,
    }),
  });

  useEffect(() => {
    if (!loaded) return;
    const latestContentHtml = readLatestContentHtml();
    const isEmpty =
      !title &&
      isRichTextEmpty(latestContentHtml) &&
      !attachmentUrl &&
      !attachmentObjectId;
    if (isEmpty) {
      clear();
      return;
    }
    if (!operationId) return;
    save({
      operationId,
      title,
      attachmentUrl,
      attachmentObjectId,
      get contentHtml() {
        return readLatestContentHtml();
      },
    });
  }, [loaded, title, contentHtml, attachmentUrl, attachmentObjectId, operationId, readLatestContentHtml, save, clear]);

  // 저장 성공 시 draft 삭제 + 낙관적 업데이트 + 패널 닫기
  useEffect(() => {
    if (
      state.success &&
      state.thread &&
      handledThreadIdRef.current !== state.thread.id
    ) {
      handledThreadIdRef.current = state.thread.id;
      clear({
        reason: "submitted",
        submittedData: submittedDraftRef.current ?? {
          operationId,
          title,
          contentHtml,
          attachmentUrl,
          attachmentObjectId,
        },
      });
      submittedDraftRef.current = null;
      const { id, title: savedTitle, createdAt } = state.thread;
      const newItem: UnifiedItem = {
        id,
        type: "QNA",
        subType: "OPEN",
        title: savedTitle,
        date: new Date(createdAt),
        metadata: { status: "OPEN" },
        space: { studentId: actorId, label: spaceLabel },
        source: { kind: "PORTAL", entity: "QNA_THREAD", label: "포털" },
      };
      onSuccess(newItem);
      router.push(`/dashboard/qna/${id}?returnTo=${encodeURIComponent(returnTo)}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.thread?.id]);

  const hasOperationConflict = Boolean(
    state.operationConflict &&
    state.conflictedOperationId === operationId &&
    state.existingId,
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={!loaded || isFormBusy}
      className="space-y-4"
      onKeyDownCapture={handleSaveShortcut}
      onSubmit={(event) => {
        if (!loaded || !canSubmit || isFormBusy || isEditorUploading) {
          event.preventDefault();
          return;
        }
        if (!operationId) {
          event.preventDefault();
          return;
        }
        const latestContentHtml = commitLatestContentHtml();
        if (!title.trim() || isRichTextEmpty(latestContentHtml)) {
          event.preventDefault();
          return;
        }
        if (contentInputRef.current) contentInputRef.current.value = latestContentHtml;
        const submittedDraft = {
          operationId,
          title,
          contentHtml: latestContentHtml,
          attachmentUrl,
          attachmentObjectId,
        };
        save(submittedDraft);
        flush();
        submittedDraftRef.current = submittedDraft;
      }}
    >
      <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
      <input ref={contentInputRef} type="hidden" name="contentHtml" value={contentHtml} />

      {state.error && (!state.operationConflict || hasOperationConflict) && (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      )}

      {hasOperationConflict && state.existingId ? (
        <CreationConflictActions
          existingHref={`/dashboard/qna/${state.existingId}?returnTo=${encodeURIComponent(returnTo)}`}
          existingLabel="기존 질문 열기"
          separateLabel="별도 질문으로 저장"
          onSeparate={() => {
            if (attachmentObjectId) {
              void abandonMediaUpload(attachmentObjectId).catch(() => undefined);
            }
            setAttachmentUrl("");
            setAttachmentObjectId("");
            setOperationId(createCreationOperationId());
          }}
          disabled={isFormBusy}
        />
      ) : null}

      {/* 제목 */}
      <div className="space-y-1.5">
        <label htmlFor="qna-slide-title" className="text-sm font-medium">
          질문 제목 <span className="text-destructive">*</span>
        </label>
        <Input
          id="qna-slide-title"
          name="title"
          placeholder="질문 제목을 입력하세요"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          disabled={!loaded || isFormBusy}
        />
      </div>

      {/* 에디터 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          내용 <span className="text-destructive">*</span>
        </label>
        {loaded && (
          <FullEditor
            onUploadingChange={setIsEditorUploading}
            initialContent={contentHtml}
            contentVersion={contentVersion}
            onChange={handleEditorChange}
            onDirty={(reader) => {
              handleEditorDirty(reader);
              if (!operationId) return;
              save({
                operationId,
                title,
                attachmentUrl,
                attachmentObjectId,
                get contentHtml() {
                  return reader();
                },
              });
            }}
            placeholder="질문 내용을 자세히 작성하세요..."
            disabled={isFormBusy}
            minHeight="300px"
            ariaLabel="Q&A 질문 내용"
            footer={
              <DraftStatus
                status={status}
                canSubmit={canSubmit}
                savedAt={savedAt}
                restored={restored}
                recoveries={recoveries}
                onRestoreRecovery={restoreRecovery}
                onDiscardRecovery={discardRecovery}
                serverSync={serverSync}
                disabled={isFormBusy}
              />
            }
            saveShortcutLabel={canSubmit ? "초안 저장" : undefined}
          />
        )}
      </div>

      {/* 첨부 파일 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">첨부 파일</label>
        <AttachmentField
          value={attachmentUrl}
          mediaObjectId={attachmentObjectId}
          draftOperationId={operationId}
          onChange={(upload) => {
            setAttachmentUrl(upload?.deliveryUrl ?? "");
            setAttachmentObjectId(upload?.mediaObjectId ?? "");
          }}
          disabled={!loaded || isFormBusy}
          onUploadingChange={setIsUploading}
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={!loaded || !canSubmit || isFormBusy || isEditorUploading || !operationId || !title.trim() || isRichTextEmpty(contentHtml)} className="flex-1">
          {isUploading || isEditorUploading ? "업로드 완료 대기..." : isPending ? "전송 중..." : "질문 등록"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={isFormBusy || isEditorUploading}>
          취소
        </Button>
      </div>
    </form>
  );
}
