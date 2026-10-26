/**
 * @file src/components/community/NewPostForm.tsx
 * @description 새 게시물 작성(캔버스 CommunityNew 보드). 게시판 유형·채널·제목·본문(믹스셋은 오디오)을
 * 한 초안으로 보존하고, 게시는 "게시하기" 버튼으로만 한다.
 */
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Music2, X } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { ChoiceGroup, type ChoiceOption } from "@/components/community/ChoiceGroup";
import { cn } from "@/lib/utils";
import { FileUploader } from "@/components/upload/FileUploader";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createPost, type CreatePostState } from "@/lib/actions/posts";
import { getCategories } from "@/lib/actions/categories";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import { isRichTextEmpty } from "@/lib/rich-text";
import { isCreatePostDraftEmpty } from "@/lib/post-draft";
import { persistLocalDraftOnShortcut } from "@/lib/local-draft-shortcut";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
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

export type PostBoardType = "ANNOUNCEMENT" | "GENERAL" | "FEEDBACK";

const BOARD_TYPES: readonly ChoiceOption<PostBoardType>[] = [
  { value: "GENERAL", label: "자유" },
  { value: "FEEDBACK", label: "믹스셋" },
  { value: "ANNOUNCEMENT", label: "공지" },
];

type PostDraft = {
  operationId?: string;
  boardType: PostBoardType;
  category: string;
  isPinned: boolean;
  title: string;
  contentHtml: string;
  mediaUrl: string;
  mediaObjectId?: string;
};

type NewPostFormProps = {
  actorId: string;
  isAdmin: boolean;
  defaultBoardType: PostBoardType;
  defaultCategory: string;
  returnTo: string;
};

export function NewPostForm(props: NewPostFormProps) {
  return <NewPostFormContent key={props.actorId} {...props} />;
}

function NewPostFormContent({
  actorId,
  isAdmin,
  defaultBoardType,
  defaultCategory,
  returnTo,
}: NewPostFormProps) {
  const [boardType, setBoardType] = useState<PostBoardType>(defaultBoardType);
  const [category, setCategory] = useState(defaultCategory);
  const [isPinned, setIsPinned] = useState(false);
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
  const [categories, setCategories] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaObjectId, setMediaObjectId] = useState("");
  const [operationId, setOperationId] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  // 본문 이미지가 올라가는 동안에는 제출하지 않는다. 편집기는 계속 쓸 수 있다.
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  const [state, formAction, isPending] = useActionState<CreatePostState, FormData>(async (previous, data) => {
    try {
      return await createPost(previous, data);
    } catch {
      return { error: "저장 결과를 확인하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요." };
    }
  }, {});
  const formRef = useRef<HTMLFormElement>(null);
  const contentInputRef = useRef<HTMLInputElement>(null);
  const submittedDraftRef = useRef<PostDraft | null>(null);
  const handledPostIdRef = useRef<string | null>(null);
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
  } = useSyncedFormDraft<PostDraft>(
    createDocumentDraftKey("community-post", actorId),
    (draft) => {
      setOperationId(
        parseCreationOperationId(draft.operationId) ?? createCreationOperationId(),
      );
      setBoardType(draft.boardType === "ANNOUNCEMENT" && !isAdmin ? "GENERAL" : (draft.boardType ?? defaultBoardType));
      setCategory(draft.category ?? defaultCategory);
      setIsPinned(draft.isPinned ?? false);
      setTitle(draft.title ?? "");
      setContentHtml(draft.contentHtml ?? "");
      setMediaUrl(draft.mediaUrl ?? "");
      setMediaObjectId(draft.mediaObjectId ?? "");
    },
    {
      onReset: () => {
        setOperationId(createCreationOperationId());
        setBoardType(defaultBoardType);
        setCategory(defaultCategory);
        setIsPinned(false);
        setTitle("");
        setContentHtml("");
        setMediaUrl("");
        setMediaObjectId("");
      },
    },
  );
  const isSubmitBlocked = !loaded || !canSubmit || isFormBusy || isEditorUploading || !operationId;
  const isSubmitDisabled =
    isSubmitBlocked ||
    !title.trim() ||
    isRichTextEmpty(contentHtml);
  const handleSaveShortcut = useDocumentSaveShortcut({
    disabled: isSubmitBlocked,
    onSave: () => persistLocalDraftOnShortcut({
      createSnapshot: () => ({
        operationId,
        boardType,
        category,
        isPinned,
        title,
        contentHtml: readLatestContentHtml(),
        mediaUrl,
        mediaObjectId,
      }),
      isEmpty: (draft) =>
        isCreatePostDraftEmpty(draft, {
          boardType: defaultBoardType,
          category: defaultCategory,
        }),
      clear,
      save,
      flush,
    }),
  });

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const latestContentHtml = readLatestContentHtml();
    if (
      isCreatePostDraftEmpty(
        {
          boardType,
          category,
          isPinned,
          title,
          contentHtml: latestContentHtml,
          mediaUrl,
          mediaObjectId,
        },
        { boardType: defaultBoardType, category: defaultCategory },
      )
    ) {
      clear();
      return;
    }
    if (!operationId) return;
    save({
      operationId,
      boardType,
      category,
      isPinned,
      title,
      mediaUrl,
      mediaObjectId,
      get contentHtml() {
        return readLatestContentHtml();
      },
    });
  }, [boardType, category, clear, contentHtml, defaultBoardType, defaultCategory, isPinned, loaded, mediaObjectId, mediaUrl, operationId, readLatestContentHtml, save, title]);

  useEffect(() => {
    if (!state.postId || handledPostIdRef.current === state.postId) return;
    handledPostIdRef.current = state.postId;
    const submittedDraft = submittedDraftRef.current ?? {
      operationId,
      boardType,
      category,
      isPinned,
      title,
      contentHtml,
      mediaUrl,
      mediaObjectId,
    };
    clear({
      reason: "submitted",
      submittedData: submittedDraft,
    });
    submittedDraftRef.current = null;
    router.replace(`/community/${state.postId}?returnTo=${encodeURIComponent(returnTo)}`);
  }, [boardType, category, clear, contentHtml, isPinned, mediaObjectId, mediaUrl, operationId, returnTo, router, state.postId, title]);

  const hasOperationConflict = Boolean(
    state.operationConflict &&
    state.conflictedOperationId === operationId &&
    state.existingId,
  );

  const backLabel = returnTo.startsWith("/community") ? "커뮤니티 목록으로" : "이전 화면으로";
  const changeBoardType = (value: PostBoardType) => {
    if (value !== "FEEDBACK" && mediaObjectId) {
      void abandonMediaUpload(mediaObjectId).catch(() => undefined);
      setMediaUrl("");
      setMediaObjectId("");
    }
    setBoardType(value);
  };

  return (
    <div className="px-5 pt-5 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <MobileTopBar title="새 게시물" back={{ href: returnTo, label: backLabel }} />
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
            커뮤니티
          </Link>
          <span aria-hidden="true" className="text-faint">/</span>
          <span aria-current="page" className="text-foreground">새 게시물</span>
        </nav>
        <h1 className="sr-only md:not-sr-only md:text-display md:font-semibold md:tracking-display">새 게시물</h1>

        <form
          ref={formRef}
          action={formAction}
          aria-busy={!loaded || isFormBusy}
          className="flex flex-col gap-5"
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
              boardType,
              category,
              isPinned,
              title,
              contentHtml: latestContentHtml,
              mediaUrl,
              mediaObjectId,
            };
            save(submittedDraft);
            flush();
            submittedDraftRef.current = submittedDraft;
          }}
        >
          <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
          <input type="hidden" name="returnTo" value="community-editor" />
          <input type="hidden" name="boardType" value={boardType} />
          <input type="hidden" name="category" value={category} />
          <input ref={contentInputRef} type="hidden" name="contentHtml" value={contentHtml} />
          <input type="hidden" name="mediaUrl" value={mediaUrl} />
          <input type="hidden" name="mediaObjectId" value={mediaObjectId} />
          {isPinned ? <input type="hidden" name="isPinned" value="true" /> : null}

          {state.error && (!state.operationConflict || hasOperationConflict) ? (
            <p role="alert" className="rounded-lg border border-destructive-border bg-destructive-muted p-3 text-ui text-destructive">
              {state.error}
            </p>
          ) : null}

          {hasOperationConflict && state.existingId ? (
            <CreationConflictActions
              existingHref={`/community/${state.existingId}?returnTo=${encodeURIComponent(returnTo)}`}
              existingLabel="기존 게시물 열기"
              separateLabel="별도 게시물로 저장"
              onSeparate={() => {
                if (mediaObjectId) {
                  void abandonMediaUpload(mediaObjectId).catch(() => undefined);
                }
                setMediaUrl("");
                setMediaObjectId("");
                setOperationId(createCreationOperationId());
              }}
              disabled={isFormBusy}
            />
          ) : null}

          <ChoiceGroup
            label="게시판 유형"
            variant="segment"
            options={BOARD_TYPES.filter(({ value }) => value !== "ANNOUNCEMENT" || isAdmin)}
            value={boardType}
            onChange={changeBoardType}
            disabled={!loaded || isFormBusy}
          />

          {boardType === "GENERAL" && categories.length > 0 ? (
            <ChoiceGroup
              label="채널"
              variant="chips"
              options={categories.map((item) => ({ value: item.slug, label: `# ${item.name}` }))}
              value={category}
              onChange={setCategory}
              disabled={!loaded || isFormBusy}
            />
          ) : null}

          {boardType === "ANNOUNCEMENT" ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 self-start text-body text-foreground md:min-h-0 md:text-ui">
              <input
                type="checkbox"
                checked={isPinned}
                onChange={(event) => setIsPinned(event.target.checked)}
                className="size-4 rounded-sm border-faint accent-primary"
                disabled={!loaded || isFormBusy}
              />
              공지 상단 고정
            </label>
          ) : null}

          {boardType === "FEEDBACK" ? (
            <div className="flex flex-col gap-2">
              <span className="text-body font-medium text-secondary-foreground md:text-ui">
                오디오 파일 <span className="font-normal text-muted-foreground">(선택)</span>
              </span>
              {mediaUrl ? (
                <div role="status" className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-11 items-center gap-1 rounded-touch bg-muted pl-3 text-ui md:h-8 md:rounded-md md:pl-2.5 md:pr-1 md:text-xs">
                    <Music2 className="size-3.5 shrink-0 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
                    <span className="ml-1 text-foreground">업로드 완료</span>
                    <button
                      type="button"
                      aria-label="오디오 파일 제거"
                      onClick={() => {
                        const abandonedId = mediaObjectId;
                        setMediaUrl("");
                        setMediaObjectId("");
                        if (abandonedId) {
                          void abandonMediaUpload(abandonedId).catch(() => undefined);
                        }
                      }}
                      disabled={isFormBusy}
                      className="flex size-11 shrink-0 items-center justify-center rounded-touch text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 md:size-6 md:rounded-sm"
                    >
                      <X className="size-3.5 md:size-3" strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              ) : (
                <FileUploader
                  accept="audio/*"
                  purpose="COMMUNITY_POST_AUDIO"
                  draftOperationId={operationId}
                  label="오디오 파일 선택 (MP3, WAV, FLAC)"
                  onUploadComplete={(upload) => {
                    setMediaUrl(upload.deliveryUrl);
                    setMediaObjectId(upload.mediaObjectId);
                    setUploadError("");
                  }}
                  onError={setUploadError}
                  onUploadingChange={(uploading) => {
                    if (uploading) setUploadError("");
                    setIsUploading(uploading);
                  }}
                  disabled={!loaded || isFormBusy}
                />
              )}
              {uploadError ? <p role="alert" className="text-ui text-destructive">{uploadError}</p> : null}
            </div>
          ) : null}

          <label className="flex flex-col gap-1.5 text-body font-medium text-secondary-foreground md:text-ui" htmlFor="post-title">
            <span>
              제목 <span className="sr-only">필수</span>
            </span>
            <Input
              id="post-title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="게시물 제목"
              required
              disabled={!loaded || isFormBusy}
              className="h-12 px-3.5 font-normal md:h-10 md:px-3 md:text-md"
            />
          </label>

          <div className="flex flex-col gap-1.5">
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
                    boardType,
                    category,
                    isPinned,
                    title,
                    mediaUrl,
                    get contentHtml() {
                      return reader();
                    },
                  });
                }}
                placeholder="게시물 내용을 작성하세요…"
                disabled={isFormBusy}
                minHeight="15rem"
                ariaLabel="커뮤니티 게시물 내용"
                toolbar="none"
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

          {/* 좁은 화면은 아래 고정 막대의 48px 주 버튼, 넓은 화면은 오른쪽 정렬 취소·게시 */}
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
              disabled={isSubmitDisabled}
              className="w-full md:h-9 md:w-auto md:rounded-md md:px-4 md:text-ui"
            >
              {isUploading || isEditorUploading ? "업로드 완료 대기…" : isPending ? "게시 중…" : "게시하기"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
