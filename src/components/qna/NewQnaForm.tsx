/**
 * @file src/components/qna/NewQnaForm.tsx
 * @description 새 Q&A 질문 작성(캔버스 QnaNew·MobileQnaNew 보드).
 * 제목·본문·첨부를 한 초안으로 이 기기와 계정에 보존하고, 등록은 "질문 등록" 버튼으로만 한다.
 */
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { cn } from "@/lib/utils";
import { AttachmentField } from "@/components/qna/AttachmentField";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createQnaThread, type CreateThreadState } from "@/lib/actions/qna";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { isRichTextEmpty } from "@/lib/rich-text";
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
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

type QnaDraft = {
  operationId?: string;
  title: string;
  contentHtml: string;
  attachmentUrl: string;
  attachmentObjectId?: string;
};

export function NewQnaForm(props: { actorId: string; returnTo: string }) {
  return <NewQnaFormContent key={props.actorId} {...props} />;
}

function NewQnaFormContent({ actorId, returnTo }: { actorId: string; returnTo: string }) {
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
  const [state, formAction, isPending] = useActionState<CreateThreadState, FormData>(
    async (previous, data) => {
      try {
        return await createQnaThread(previous, data);
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
    (draft) => {
      setOperationId(
        parseCreationOperationId(draft.operationId) ?? createCreationOperationId(),
      );
      setTitle(draft.title ?? "");
      setContentHtml(draft.contentHtml ?? "");
      setAttachmentUrl(draft.attachmentUrl ?? "");
      setAttachmentObjectId(draft.attachmentObjectId ?? "");
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
    disabled: !loaded || !canSubmit || isFormBusy || !operationId,
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
    if (!title && isRichTextEmpty(latestContentHtml) && !attachmentUrl && !attachmentObjectId) {
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
  }, [attachmentObjectId, attachmentUrl, clear, contentHtml, loaded, operationId, readLatestContentHtml, save, title]);

  useEffect(() => {
    if (!state.thread?.id || handledThreadIdRef.current === state.thread.id) return;
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
    router.replace(`/dashboard/qna/${state.thread.id}?returnTo=${encodeURIComponent(returnTo)}`);
  }, [attachmentObjectId, attachmentUrl, clear, contentHtml, operationId, returnTo, router, state.thread?.id, title]);

  const hasOperationConflict = Boolean(
    state.operationConflict &&
    state.conflictedOperationId === operationId &&
    state.existingId,
  );

  const backLabel = returnTo.startsWith("/dashboard/qna") ? "Q&A 목록으로" : "이전 화면으로";

  return (
    <div className="px-5 pt-5 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <MobileTopBar title="새 질문 작성" back={{ href: returnTo, label: backLabel }} />
      <div className="flex max-w-[760px] flex-col gap-5 md:gap-7">
        <nav aria-label="위치" className="hidden items-center gap-1.5 text-ui md:flex">
          <Link
            href={returnTo}
            aria-disabled={isFormBusy}
            tabIndex={isFormBusy ? -1 : undefined}
            className={cn(
              "text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isFormBusy && "pointer-events-none opacity-50",
            )}
            onClick={(event) => {
              if (isFormBusy) event.preventDefault();
            }}
          >
            Q&amp;A
          </Link>
          <span aria-hidden="true" className="text-faint">/</span>
          <span aria-current="page" className="text-foreground">새 질문</span>
        </nav>
        <h1 className="sr-only md:not-sr-only md:text-display md:font-semibold md:tracking-display">새 질문 작성</h1>

        <form
          ref={formRef}
          action={formAction}
          aria-busy={!loaded || isFormBusy}
          className="flex flex-col gap-[18px] md:gap-5"
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

          {state.error && (!state.operationConflict || hasOperationConflict) ? (
            <p role="alert" className="rounded-lg border border-destructive-border bg-destructive-muted p-3 text-ui text-destructive">
              {state.error}
            </p>
          ) : null}

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

          <label className="flex flex-col gap-1.5 text-body font-medium text-secondary-foreground md:text-ui" htmlFor="qna-title">
            <span>
              제목 <span className="sr-only">필수</span>
            </span>
            <Input
              id="qna-title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="질문 제목을 입력하세요"
              required
              disabled={!loaded || isFormBusy}
              className="h-12 px-3.5 font-normal md:h-10 md:px-3 md:text-md"
            />
          </label>

          {/* 본문 칸 최소 높이: MobileQnaNew 220 + 위아래 12, QnaNew 200 + 위아래 14 */}
          <div className="flex flex-col gap-1.5 [--qna-body-min-h:15.25rem] md:[--qna-body-min-h:14.25rem]">
            <span className="text-body font-medium text-secondary-foreground md:text-ui">
              내용 <span className="sr-only">필수</span>
            </span>
            {loaded ? (
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
                placeholder="질문 내용을 자세히 작성하세요. 악보, 코드, 이미지 등을 첨부할 수 있습니다."
                disabled={isFormBusy}
                minHeight="var(--qna-body-min-h)"
                ariaLabel="Q&A 질문 내용"
                toolbar="compact"
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
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-body font-medium text-secondary-foreground md:text-ui">첨부 파일</span>
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
              trigger="inline"
            />
          </div>

          {/* 좁은 화면은 아래 고정 막대의 48px 주 버튼, 넓은 화면은 오른쪽 정렬 취소·등록 */}
          <div className="sticky bottom-0 -mx-5 border-t border-border bg-background px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:static md:mx-0 md:flex md:justify-end md:gap-2 md:border-muted md:px-0 md:pb-0 md:pt-2">
            <Link
              href={returnTo}
              aria-disabled={isFormBusy}
              tabIndex={isFormBusy ? -1 : undefined}
              className={cn(buttonClassName({ variant: "outline", className: "hidden h-9 md:inline-flex" }), isFormBusy && "pointer-events-none opacity-50")}
              onClick={(event) => {
                if (isFormBusy) event.preventDefault();
              }}
            >
              취소
            </Link>
            <Button
              type="submit"
              size="touch"
              disabled={!loaded || !canSubmit || isFormBusy || isEditorUploading || !operationId || !title.trim() || isRichTextEmpty(contentHtml)}
              className="w-full md:h-9 md:w-auto md:rounded-md md:px-4 md:text-ui"
            >
              {isUploading || isEditorUploading ? "업로드 완료 대기…" : isPending ? "등록 중…" : "질문 등록"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
