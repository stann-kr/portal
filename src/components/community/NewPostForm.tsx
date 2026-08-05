"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Megaphone, MessageSquare, Music2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileUploader } from "@/components/upload/FileUploader";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createPost, type CreatePostState } from "@/lib/actions/posts";
import { getCategories } from "@/lib/actions/categories";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import { isRichTextEmpty } from "@/lib/rich-text";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import {
  CREATION_OPERATION_FIELD,
  createCreationOperationId,
  parseCreationOperationId,
} from "@/lib/creation-operation";
import { CreationConflictActions } from "@/components/editor/CreationConflictActions";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

export type PostBoardType = "ANNOUNCEMENT" | "GENERAL" | "FEEDBACK";

const BOARD_TYPES = [
  { value: "GENERAL" as const, label: "자유", icon: MessageSquare },
  { value: "ANNOUNCEMENT" as const, label: "공지", icon: Megaphone },
  { value: "FEEDBACK" as const, label: "믹스셋", icon: Music2 },
] as const;

type PostDraft = {
  operationId?: string;
  boardType: PostBoardType;
  category: string;
  isPinned: boolean;
  title: string;
  contentHtml: string;
  mediaUrl: string;
};

type NewPostFormProps = {
  actorId: string;
  isAdmin: boolean;
  defaultBoardType: PostBoardType;
  defaultCategory: string;
  returnTo: string;
};

export function NewPostForm({
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
  const [operationId, setOperationId] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [state, formAction, isPending] = useActionState<CreatePostState, FormData>(createPost, {});
  const formRef = useRef<HTMLFormElement>(null);
  const contentInputRef = useRef<HTMLInputElement>(null);
  const submittedDraftRef = useRef<PostDraft | null>(null);
  const handledPostIdRef = useRef<string | null>(null);
  const router = useRouter();
  const isFormBusy = isPending || isUploading;
  useBusyNavigationGuard(isFormBusy);

  const {
    loaded,
    save,
    clear,
    flush,
    status,
    savedAt,
    restored,
    recoveries,
    restoreRecovery,
    discardRecovery,
  } = useFormDraft<PostDraft>(
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
      },
    },
  );
  const isSubmitBlocked = !loaded || isFormBusy || !operationId;
  const isSubmitDisabled =
    isSubmitBlocked ||
    !title.trim() ||
    isRichTextEmpty(contentHtml);
  const handleSaveShortcut = useDocumentSaveShortcut({
    disabled: isSubmitBlocked,
    onSave: () => formRef.current?.requestSubmit(),
  });

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const latestContentHtml = readLatestContentHtml();
    if (!title && isRichTextEmpty(latestContentHtml) && !mediaUrl) {
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
      get contentHtml() {
        return readLatestContentHtml();
      },
    });
  }, [boardType, category, clear, contentHtml, isPinned, loaded, mediaUrl, operationId, readLatestContentHtml, save, title]);

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
    };
    clear({
      reason: "submitted",
      submittedData: submittedDraft,
    });
    submittedDraftRef.current = null;
    router.replace(`/community/${state.postId}?returnTo=${encodeURIComponent(returnTo)}`);
  }, [boardType, category, clear, contentHtml, isPinned, mediaUrl, operationId, returnTo, router, state.postId, title]);

  const hasOperationConflict = Boolean(
    state.operationConflict &&
    state.conflictedOperationId === operationId &&
    state.existingId,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link
          href={returnTo}
          aria-disabled={isFormBusy}
          tabIndex={isFormBusy ? -1 : undefined}
          className={`inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground ${
            isFormBusy ? "pointer-events-none opacity-50" : ""
          }`}
          onClick={(event) => {
            if (isFormBusy) event.preventDefault();
          }}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          커뮤니티
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">새 게시물</h1>
      </div>

      <form
        ref={formRef}
        action={formAction}
        aria-busy={!loaded || isFormBusy}
        className="space-y-5"
        onKeyDownCapture={handleSaveShortcut}
        onSubmit={(event) => {
          if (!loaded || isFormBusy) {
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
        {isPinned ? <input type="hidden" name="isPinned" value="true" /> : null}

        {state.error && (!state.operationConflict || hasOperationConflict) ? (
          <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {state.error}
          </p>
        ) : null}

        {hasOperationConflict && state.existingId ? (
          <CreationConflictActions
            existingHref={`/community/${state.existingId}?returnTo=${encodeURIComponent(returnTo)}`}
            existingLabel="기존 게시물 열기"
            separateLabel="별도 게시물로 저장"
            onSeparate={() => setOperationId(createCreationOperationId())}
            disabled={isFormBusy}
          />
        ) : null}

        <fieldset className="space-y-1.5" disabled={!loaded || isFormBusy}>
          <legend className="text-sm font-medium">게시판 유형</legend>
          <div className="flex flex-wrap gap-2">
            {BOARD_TYPES.filter(({ value }) => value !== "ANNOUNCEMENT" || isAdmin).map(
              ({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={boardType === value}
                  onClick={() => setBoardType(value)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    boardType === value
                      ? "border-foreground font-medium text-foreground"
                      : "border-border text-muted-foreground hover:border-foreground/50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {label}
                </button>
              ),
            )}
          </div>
        </fieldset>

        {boardType === "GENERAL" ? (
          <fieldset className="space-y-1.5" disabled={!loaded || isPending}>
            <legend className="text-sm font-medium">채널</legend>
            <div className="flex flex-wrap gap-2">
              {categories.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={category === item.slug}
                  onClick={() => setCategory(item.slug)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    category === item.slug
                      ? "border-foreground font-medium text-foreground"
                      : "border-border text-muted-foreground hover:border-foreground/50"
                  }`}
                >
                  # {item.name}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        {boardType === "ANNOUNCEMENT" ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(event) => setIsPinned(event.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
              disabled={!loaded || isPending}
            />
            공지 상단 고정
          </label>
        ) : null}

        {boardType === "FEEDBACK" ? (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">
              오디오 파일 <span className="text-muted-foreground">(선택)</span>
            </p>
            {mediaUrl ? (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <Music2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1 truncate text-sm text-foreground">업로드 완료</span>
                <button
                  type="button"
                  onClick={() => setMediaUrl("")}
                  disabled={isFormBusy}
                  className="text-xs text-muted-foreground transition-colors hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
                >
                  제거
                </button>
              </div>
            ) : (
              <FileUploader
                accept="audio/*"
                prefix="community/audio/"
                label="오디오 파일 선택 (MP3, WAV, FLAC)"
                onUploadComplete={(url) => {
                  setMediaUrl(url);
                  setUploadError("");
                }}
                onError={setUploadError}
                onUploadingChange={(uploading) => {
                  if (uploading) setUploadError("");
                  setIsUploading(uploading);
                }}
                disabled={!loaded || isPending}
              />
            )}
            {uploadError ? <p role="alert" className="text-sm text-destructive">{uploadError}</p> : null}
          </div>
        ) : null}

        <label className="block space-y-1.5" htmlFor="post-title">
          <span className="text-sm font-medium">
            제목 <span className="text-destructive">*</span>
          </span>
          <Input
            id="post-title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="게시물 제목"
            required
            disabled={!loaded || isPending}
          />
        </label>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">
            내용 <span className="text-destructive">*</span>
          </p>
          {loaded ? (
            <FullEditor
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
              disabled={isPending}
              ariaLabel="커뮤니티 게시물 내용"
              footer={
                <DraftStatus
                  status={status}
                  savedAt={savedAt}
                  restored={restored}
                  recoveries={recoveries}
                  onRestoreRecovery={restoreRecovery}
                  onDiscardRecovery={discardRecovery}
                  disabled={isFormBusy}
                />
              }
              onSave={() => {
                if (!isFormBusy) formRef.current?.requestSubmit();
              }}
            />
          ) : null}
        </div>

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={isSubmitDisabled}
            className="flex-1 gap-2"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {isUploading ? "업로드 완료 대기…" : isPending ? "게시 중…" : "게시하기"}
          </Button>
          <Button variant="outline" asChild>
            <Link
              href={returnTo}
              aria-disabled={isFormBusy}
              tabIndex={isFormBusy ? -1 : undefined}
              className={isFormBusy ? "pointer-events-none opacity-50" : undefined}
              onClick={(event) => {
                if (isFormBusy) event.preventDefault();
              }}
            >
              취소
            </Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
