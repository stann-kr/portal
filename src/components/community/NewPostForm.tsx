/**
 * @file src/components/community/NewPostForm.tsx
 * @description 새 게시물 작성(캔버스 CommunityNew 보드). 게시판 유형·채널·제목·본문(믹스셋은 오디오)을
 * 한 초안으로 보존하고, 게시는 "게시하기" 버튼으로만 한다.
 * 믹스셋은 업로드한 오디오 파일 또는 YouTube·SoundCloud 링크 중 하나를 고른다. 두 값은 각각 보존하고
 * 고른 방식의 값만 전송한다(전환해도 업로드한 파일을 잃지 않는다).
 */
"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { Music2, X } from "lucide-react";
import { Button, ButtonSpinner, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { ChoiceGroup, type ChoiceOption } from "@/components/ui/choice-group";
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
import { MIXSET_LINK_FIELD, normalizeMixsetLinkUrl } from "@/lib/community-mixset-media";

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

type MixsetMediaMode = "audio" | "link";

const MIXSET_MEDIA_MODES: readonly ChoiceOption<MixsetMediaMode>[] = [
  { value: "audio", label: "오디오 파일" },
  { value: "link", label: "링크 (YouTube·SoundCloud)" },
];

/** 이전 초안에는 방식이 없으므로 링크 값이 있을 때만 링크로 본다. */
function restoreMixsetMediaMode(draft: { mixsetMediaMode?: unknown; mixsetLinkUrl?: unknown }): MixsetMediaMode {
  if (draft.mixsetMediaMode === "link" || draft.mixsetMediaMode === "audio") return draft.mixsetMediaMode;
  return typeof draft.mixsetLinkUrl === "string" && draft.mixsetLinkUrl.trim() ? "link" : "audio";
}

type PostDraft = {
  operationId?: string;
  boardType: PostBoardType;
  category: string;
  isPinned: boolean;
  title: string;
  contentHtml: string;
  mediaUrl: string;
  mediaObjectId?: string;
  mixsetMediaMode?: MixsetMediaMode;
  mixsetLinkUrl?: string;
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
  const [mixsetMediaMode, setMixsetMediaMode] = useState<MixsetMediaMode>("audio");
  const [mixsetLinkUrl, setMixsetLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkFieldId = useId();
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
  const router = useProgressRouter();
  // 등록에 성공하면 상세 화면으로 넘어갈 때까지 계속 막아 두 번 등록하지 않게 한다.
  const isRedirecting = Boolean(state.postId);
  const isFormBusy = isPending || isUploading || isRedirecting;
  // 등록에 성공한 뒤에는 이탈 막기를 풀어, 하드 이동(배포 버전 차이 등)에서 나가기 확인이 뜨거나 링크가 막히지 않게 한다.
  useBusyNavigationGuard(isPending || isUploading);

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
      setMixsetMediaMode(restoreMixsetMediaMode(draft));
      setMixsetLinkUrl(typeof draft.mixsetLinkUrl === "string" ? draft.mixsetLinkUrl : "");
      setLinkError("");
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
        setMixsetMediaMode("audio");
        setMixsetLinkUrl("");
        setLinkError("");
      },
    },
  );
  const isLinkMode = boardType === "FEEDBACK" && mixsetMediaMode === "link";
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
        mixsetMediaMode,
        mixsetLinkUrl,
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

  const [categoriesLoading, setCategoriesLoading] = useState(true);
  useEffect(() => {
    getCategories()
      .then(setCategories)
      .catch(() => undefined)
      .finally(() => setCategoriesLoading(false));
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
          mixsetLinkUrl,
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
      mixsetMediaMode,
      mixsetLinkUrl,
      get contentHtml() {
        return readLatestContentHtml();
      },
    });
  }, [boardType, category, clear, contentHtml, defaultBoardType, defaultCategory, isPinned, loaded, mediaObjectId, mediaUrl, mixsetLinkUrl, mixsetMediaMode, operationId, readLatestContentHtml, save, title]);

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
      mixsetMediaMode,
      mixsetLinkUrl,
    };
    clear({
      reason: "submitted",
      submittedData: submittedDraft,
    });
    // 링크로 게시했으면 보관만 하던 업로드 오디오는 게시물에 붙지 않았으므로 정리한다.
    if (
      submittedDraft.boardType === "FEEDBACK" &&
      submittedDraft.mixsetMediaMode === "link" &&
      submittedDraft.mediaObjectId
    ) {
      void abandonMediaUpload(submittedDraft.mediaObjectId).catch(() => undefined);
    }
    submittedDraftRef.current = null;
    router.replace(`/community/${state.postId}?returnTo=${encodeURIComponent(returnTo)}`);
  }, [boardType, category, clear, contentHtml, isPinned, mediaObjectId, mediaUrl, mixsetLinkUrl, mixsetMediaMode, operationId, returnTo, router, state.postId, title]);

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
    if (value !== "FEEDBACK") {
      // 오디오와 같이 믹스셋 전용 링크도 다른 게시판으로 옮길 때 비운다(보이지 않는 값이 초안에 남지 않게).
      setMixsetMediaMode("audio");
      setMixsetLinkUrl("");
      setLinkError("");
    }
    setBoardType(value);
  };
  const changeMixsetMediaMode = (value: MixsetMediaMode) => {
    // 업로드한 파일과 입력한 링크는 그대로 두고, 게시할 때 고른 방식의 값만 보낸다.
    setLinkError("");
    setMixsetMediaMode(value);
  };
  const linkHintId = `${linkFieldId}-hint`;
  const linkHeldAudioId = `${linkFieldId}-held-audio`;
  const linkErrorId = `${linkFieldId}-error`;

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
          noValidate={isLinkMode || undefined}
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
            if (isLinkMode) {
              const normalizedLink = normalizeMixsetLinkUrl(mixsetLinkUrl);
              if (!normalizedLink.ok) {
                event.preventDefault();
                setLinkError(normalizedLink.error);
                linkInputRef.current?.focus();
                return;
              }
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
              mixsetMediaMode,
              mixsetLinkUrl,
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
          {/* 링크 방식이면 업로드 오디오 칸을 보내지 않는다(서버는 둘을 함께 받지 않는다). */}
          {isLinkMode ? null : (
            <>
              <input type="hidden" name="mediaUrl" value={mediaUrl} />
              <input type="hidden" name="mediaObjectId" value={mediaObjectId} />
            </>
          )}
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

          {boardType === "GENERAL" && categoriesLoading ? (
            <p role="status" className="flex items-center gap-1.5 text-ui text-muted-foreground">
              <ButtonSpinner />채널을 불러오는 중
            </p>
          ) : null}
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
            <ChoiceGroup
              label="믹스셋 첨부 방식"
              variant="segment"
              options={MIXSET_MEDIA_MODES}
              value={mixsetMediaMode}
              onChange={changeMixsetMediaMode}
              disabled={!loaded || isFormBusy}
            />
          ) : null}

          {isLinkMode ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={linkFieldId} className="text-body font-medium text-secondary-foreground md:text-ui">
                믹스셋 링크 <span className="sr-only">필수</span>
              </label>
              <Input
                ref={linkInputRef}
                id={linkFieldId}
                name={MIXSET_LINK_FIELD}
                type="url"
                inputMode="url"
                autoComplete="off"
                required
                placeholder="YouTube 또는 SoundCloud 링크 붙여넣기"
                value={mixsetLinkUrl}
                onChange={(event) => {
                  setMixsetLinkUrl(event.target.value);
                  setLinkError("");
                }}
                onBlur={() => {
                  // 입력 도중에는 막지 않고, 칸을 떠날 때 값이 있으면 형식을 알려 준다.
                  if (!mixsetLinkUrl.trim()) return;
                  const normalizedLink = normalizeMixsetLinkUrl(mixsetLinkUrl);
                  setLinkError(normalizedLink.ok ? "" : normalizedLink.error);
                }}
                disabled={!loaded || isFormBusy}
                aria-invalid={linkError ? true : undefined}
                aria-describedby={[linkHintId, mediaUrl ? linkHeldAudioId : null, linkError ? linkErrorId : null].filter(Boolean).join(" ")}
                className="h-12 px-3.5 font-normal md:h-10 md:px-3"
              />
              <p id={linkHintId} className="text-xs leading-[18px] text-muted-foreground md:leading-4">
                YouTube 영상·Shorts·라이브와 SoundCloud 트랙·세트 링크를 올릴 수 있습니다.
              </p>
              {mediaUrl ? (
                <p id={linkHeldAudioId} className="text-xs leading-[18px] text-muted-foreground md:leading-4">
                  업로드한 오디오 파일은 보관 중입니다. 링크로 게시하면 오디오 파일은 첨부되지 않습니다.
                </p>
              ) : null}
              {linkError ? (
                <p id={linkErrorId} role="alert" className="text-ui text-destructive">{linkError}</p>
              ) : null}
            </div>
          ) : null}

          {boardType === "FEEDBACK" && !isLinkMode ? (
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
                    mediaObjectId,
                    mixsetMediaMode,
                    mixsetLinkUrl,
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
              pending={isPending || isRedirecting}
              className="w-full md:h-9 md:w-auto md:rounded-md md:px-4 md:text-ui"
            >
              {isUploading || isEditorUploading ? "업로드 완료 대기…" : isPending || isRedirecting ? "게시 중…" : "게시하기"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
