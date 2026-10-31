/**
 * @file src/components/qna/NewQnaForm.tsx
 * @description 새 Q&A 질문 작성(캔버스 QnaNew·MobileQnaNew 보드).
 * 제목·본문·첨부는 실시간 작성본(여러 기기에서 같은 작성본, 선택창 없음)에 보관하고, 등록은 "질문 등록" 버튼으로만 한다.
 */
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { Button, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { cn } from "@/lib/utils";
import { AttachmentField } from "@/components/qna/AttachmentField";
import { CollabDraftStatus } from "@/components/editor/CollabDraftStatus";
import { createQnaThread, type CreateThreadState } from "@/lib/actions/qna";
import { useCollabFormDraft } from "@/lib/collab/client/useCollabFormDraft";
import { useEditorExtensions } from "@/components/editor/useEditorExtensions";
import { isRichTextEmpty } from "@/lib/rich-text";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import { CREATION_OPERATION_FIELD } from "@/lib/creation-operation";
import { CreationConflictActions } from "@/components/editor/CreationConflictActions";
import { abandonMediaUpload } from "@/lib/actions/upload";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

export function NewQnaForm(props: { actorId: string; returnTo: string }) {
  return <NewQnaFormContent key={props.actorId} {...props} />;
}

const QNA_FIELDS = { title: "", attachmentUrl: "", attachmentObjectId: "" };

function NewQnaFormContent({ actorId, returnTo }: { actorId: string; returnTo: string }) {
  // 같은 사람의 새 질문 작성본은 기기와 관계없이 하나다(room `draft:qna-thread:<본인>:new`).
  const getExtensions = useEditorExtensions();
  const draft = useCollabFormDraft({
    room: { draftKind: "qna-thread", ownerId: actorId, scope: "new" },
    fields: QNA_FIELDS,
    extensions: getExtensions,
  });
  const { title, attachmentUrl, attachmentObjectId } = draft.fields;
  const { contentHtml, operationId } = draft;
  const loaded = draft.ready && draft.collab.mode === "write";
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
  const handledThreadIdRef = useRef<string | null>(null);
  const router = useProgressRouter();
  // 등록에 성공하면 상세 화면으로 넘어갈 때까지 계속 막아 두 번 등록하지 않게 한다.
  const isRedirecting = Boolean(state.thread?.id);
  const isFormBusy = isPending || isUploading || isRedirecting;
  // 등록에 성공한 뒤에는 이탈 막기를 풀어, 하드 이동(배포 버전 차이 등)에서 나가기 확인이 뜨거나 링크가 막히지 않게 한다.
  useBusyNavigationGuard(isPending || isUploading);
  // 작성본은 입력하는 대로 실시간 보관되므로 Cmd/Ctrl+S는 따로 할 일이 없다(브라우저 저장 창만 막는다).
  const handleSaveShortcut = useDocumentSaveShortcut({ disabled: !loaded, onSave: () => undefined });

  useEffect(() => {
    if (!state.thread?.id || handledThreadIdRef.current === state.thread.id) return;
    handledThreadIdRef.current = state.thread.id;
    // 등록한 작성본은 모든 기기에서 비운다(제출 뒤 바뀐 입력이 있으면 남긴다).
    draft.clearSubmitted();
    router.replace(`/dashboard/qna/${state.thread.id}?returnTo=${encodeURIComponent(returnTo)}`);
  }, [draft, returnTo, router, state.thread?.id]);

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
            if (!loaded || isFormBusy || isEditorUploading || !operationId) {
              event.preventDefault();
              return;
            }
            const latestContentHtml = draft.readHtml();
            if (!title.trim() || isRichTextEmpty(latestContentHtml)) {
              event.preventDefault();
              return;
            }
            if (contentInputRef.current) contentInputRef.current.value = latestContentHtml;
            draft.markSubmitted();
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
                draft.setField("attachmentUrl", "");
                draft.setField("attachmentObjectId", "");
                draft.rotateOperation();
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
              onChange={(event) => draft.setField("title", event.target.value)}
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
            {loaded && draft.collaboration ? (
              <FullEditor
                key={draft.collab.generation}
                collaboration={draft.collaboration}
                onUploadingChange={setIsEditorUploading}
                placeholder="질문 내용을 자세히 작성하세요. 악보, 코드, 이미지 등을 첨부할 수 있습니다."
                disabled={isFormBusy}
                minHeight="var(--qna-body-min-h)"
                ariaLabel="Q&A 질문 내용"
                toolbar="compact"
                footer={<CollabDraftStatus draft={draft} />}
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
                draft.setField("attachmentUrl", upload?.deliveryUrl ?? "");
                draft.setField("attachmentObjectId", upload?.mediaObjectId ?? "");
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
              disabled={!loaded || isFormBusy || isEditorUploading || !operationId || !title.trim() || isRichTextEmpty(contentHtml)}
              pending={isPending || isRedirecting}
              className="w-full md:h-9 md:w-auto md:rounded-md md:px-4 md:text-ui"
            >
              {isUploading || isEditorUploading ? "업로드 완료 대기…" : isPending || isRedirecting ? "등록 중…" : "질문 등록"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
