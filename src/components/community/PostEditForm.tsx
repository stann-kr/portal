"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { generateJSON, getSchema } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CollabDraftStatus } from "@/components/editor/CollabDraftStatus";
import { useEditorExtensions } from "@/components/editor/useEditorExtensions";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import { isRichTextEmpty } from "@/lib/rich-text";
import { getPostCollabSeed, updatePostContent } from "@/lib/actions/posts";
import { COLLAB_EPOCH_FIELD } from "@/lib/collab/protocol";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { CREATION_OPERATION_FIELD, createCreationOperationId } from "@/lib/creation-operation";
import {
  createDocumentSnapshotFingerprint,
  DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD,
} from "@/lib/document-snapshot-fingerprint";
import { POST_BASE_REVISION_FIELD } from "@/lib/post-continuity";
import { classifyMixsetMedia, MIXSET_LINK_FIELD, normalizeMixsetLinkUrl } from "@/lib/community-mixset-media";
import { isImplicitSubmitEnter } from "@/components/community/empty-title-enter";
import { useCollabFormDraft } from "@/lib/collab/client/useCollabFormDraft";
import { COLLAB_FRAGMENT, COLLAB_META } from "@/lib/collab/client/seed";
import { canonicalCollabHtml, collabDocHtml } from "@/lib/collab/client/doc-html";
import * as Y from "yjs";

const EMPTY_TITLE_ERROR = "제목을 입력해 주세요.";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

type PostEditFormProps = {
  post: { id: string; title: string; contentHtml: string; version: number };
  actorId: string;
  onCancel: () => void;
  onSaved: () => void;
  onBusyChange?: (isBusy: boolean) => void;
  /**
   * 링크로 올린 믹스셋 게시물의 현재 링크. 있으면 필수 링크 칸을 보이고 `mixsetLinkUrl`로 함께 저장한다.
   * 없으면(일반·오디오 게시물) 매체 칸 없이 예전과 같이 동작한다.
   */
  mixsetLinkUrl?: string | null;
};

/** 마지막으로 확인한 게시본(fingerprint·version 기준). */
type PostHead = { version: number; title: string; contentHtml: string };

/**
 * 게시물 수정(작성자·관리자). 수정 중인 내용은 `post:<id>` 공동 편집 작업본에 실시간으로 보관된다:
 * 같은 게시물을 연 기기·사람과 바로 합쳐지고 새로고침해도 남으며, 선택창이 없다.
 * "변경사항 저장"을 눌러야 게시본이 바뀐다(독자에게 수정 중인 내용이 보이지 않는다). "취소"는 작업본을 게시본으로 되돌린다.
 */
export function PostEditForm(props: PostEditFormProps) {
  return <PostEditFormContent key={`${props.actorId}:${props.post.id}`} {...props} />;
}

function PostEditFormContent({ actorId, post, onCancel, onSaved, onBusyChange, mixsetLinkUrl: initialLinkUrl }: PostEditFormProps) {
  const hasLinkField = typeof initialLinkUrl === "string";
  const getExtensions = useEditorExtensions();
  const headRef = useRef<PostHead>({ version: post.version, title: post.title, contentHtml: post.contentHtml });
  const docRef = useRef<Y.Doc | null>(null);
  const draft = useCollabFormDraft({
    ownerId: actorId,
    room: { postId: post.id },
    fields: { title: post.title, mixsetLinkUrl: initialLinkUrl ?? "" },
    seedHtml: post.contentHtml,
    seedVersion: post.version,
    // 연결돼 있거나 복원 등으로 작업본이 다시 시작되면 서버의 최신 게시본(lifecycle 포함)으로 시드한다.
    loadLatest: async () => {
      const latest = await getPostCollabSeed(post.id);
      if (!latest) return null;
      headRef.current = { version: latest.version, title: latest.title, contentHtml: latest.contentHtml };
      const media = hasLinkField ? classifyMixsetMedia(latest) : null;
      return {
        html: latest.contentHtml,
        fields: { title: latest.title, ...(hasLinkField ? { mixsetLinkUrl: media?.kind === "link" ? media.url : "" } : {}) },
        version: latest.version,
        lifecycle: latest.lifecycle,
      };
    },
    extensions: getExtensions,
    // 복원 준비: 작업본에 게시하지 않은 수정이 있으면 복원을 막는다(작업본을 저장하면 미게시 편집이 게시되므로 저장하지 않는다).
    onFlush: async (): Promise<{ ok: boolean; dirty?: boolean }> => {
      const head = headRef.current;
      const doc = docRef.current;
      if (!doc || doc.isDestroyed) return { ok: false };
      const meta = doc.getMap(COLLAB_META);
      const workingTitle = typeof meta.get("title") === "string" ? (meta.get("title") as string) : "";
      const dirty =
        workingTitle !== head.title || collabDocHtml(doc, getExtensions()) !== canonicalCollabHtml(head.contentHtml, getExtensions());
      return { ok: true, dirty };
    },
  });
  useEffect(() => {
    docRef.current = draft.collab.doc;
  });
  const frozen = draft.collab.frozen;
  const { title, mixsetLinkUrl: linkUrl } = draft.fields;
  const generationRef = useRef(draft.collab.generation);
  useEffect(() => {
    generationRef.current = draft.collab.generation;
  });
  const { contentHtml } = draft;
  const loaded = draft.ready && draft.collab.mode === "write";
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [linkError, setLinkError] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const titleErrorId = useId();
  const linkFieldId = useId();
  const visibleTitleError = title.trim() ? "" : titleError;
  useBusyNavigationGuard(isPending);

  useEffect(() => {
    onBusyChange?.(isPending || isEditorUploading);
  }, [isEditorUploading, isPending, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  const isSubmitBlocked = !loaded || isPending || isEditorUploading;
  const isSubmitDisabled = isSubmitBlocked || !title.trim() || isRichTextEmpty(contentHtml);

  const submit = useCallback(async () => {
    if (isSubmitBlocked) return;
    const latestContentHtml = draft.readHtml();
    if (!title.trim()) {
      setTitleError(EMPTY_TITLE_ERROR);
      titleInputRef.current?.focus();
      return;
    }
    if (isRichTextEmpty(latestContentHtml)) return;
    if (hasLinkField) {
      const normalizedLink = normalizeMixsetLinkUrl(linkUrl);
      if (!normalizedLink.ok) {
        setLinkError(normalizedLink.error);
        linkInputRef.current?.focus();
        return;
      }
    }
    setIsPending(true);
    setError(null);
    // 이 저장의 room epoch·작업본 세대는 시작할 때 고정한다(복원 뒤 옛 내용을 다시 보내지 않게).
    const epoch = draft.collab.epoch;
    const generation = draft.collab.generation;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0 && generationRef.current !== generation) {
          setError("작업본이 다시 시작되어 이 저장은 보내지 않았습니다. 내용을 확인한 뒤 다시 저장해 주세요.");
          return;
        }
        const head = headRef.current;
        const formData = new FormData();
        formData.set("title", title);
        formData.set("contentHtml", latestContentHtml);
        if (hasLinkField) formData.set(MIXSET_LINK_FIELD, linkUrl);
        formData.set(CREATION_OPERATION_FIELD, createCreationOperationId());
        formData.set(POST_BASE_REVISION_FIELD, String(head.version));
        if (typeof epoch === "number") formData.set(COLLAB_EPOCH_FIELD, String(epoch));
        formData.set(
          DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD,
          createDocumentSnapshotFingerprint({
            kind: "community-post",
            id: post.id,
            title: head.title,
            contentHtml: head.contentHtml,
            noteDate: null,
          }),
        );
        const state = await updatePostContent(post.id, {}, formData);
        if (state.success) {
          if (state.post) headRef.current = { version: state.post.version, title: state.post.title, contentHtml: state.post.contentHtml };
          // 작업본이 게시본과 같아졌음을 room에 알린다(복원 준비 때 "밀린 내용 없음").
          const doc = draft.collab.doc;
          if (doc && !doc.isDestroyed) draft.collab.provider?.reportSaved(Y.encodeStateVector(doc));
          onSaved();
          return;
        }
        if (state.collabStale) {
          draft.collab.reconnect();
          setError(state.error ?? "게시물이 복원되어 최신 내용으로 다시 불러옵니다.");
          return;
        }
        // 작업본은 이미 합쳐진 결과다. 선택창 없이 최신 게시본을 기준으로 한 번 더 저장한다.
        if (!state.collabStale && state.conflictKind === "VERSION_CONFLICT" && state.conflictPost && attempt === 0) {
          headRef.current = {
            version: state.conflictPost.version,
            title: state.conflictPost.title,
            contentHtml: state.conflictPost.contentHtml,
          };
          continue;
        }
        setError(state.error ?? "저장하지 못했습니다. 수정 내용은 작업본에 남아 있습니다.");
        return;
      }
    } catch {
      setError("저장 결과를 확인하지 못했습니다. 수정 내용은 작업본에 남아 있습니다. 다시 시도해 주세요.");
    } finally {
      setIsPending(false);
    }
  }, [draft, hasLinkField, isSubmitBlocked, linkUrl, onSaved, post.id, title]);

  /** 취소: 작업본을 마지막 게시본으로 되돌린 뒤 닫는다(같은 작업본을 연 다른 기기도 함께 되돌아간다). */
  const cancel = useCallback(() => {
    const doc = draft.collab.doc;
    if (doc && !doc.isDestroyed && loaded) {
      const head = headRef.current;
      const extensions = getExtensions();
      doc.transact(() => {
        const fragment = doc.getXmlFragment(COLLAB_FRAGMENT);
        if (fragment.length > 0) fragment.delete(0, fragment.length);
        prosemirrorJSONToYXmlFragment(getSchema(extensions), generateJSON(head.contentHtml || "<p></p>", extensions), fragment);
        const meta = doc.getMap(COLLAB_META);
        meta.set("title", head.title);
        if (hasLinkField) meta.set("mixsetLinkUrl", initialLinkUrl ?? "");
      });
    }
    onCancel();
  }, [draft.collab.doc, getExtensions, hasLinkField, initialLinkUrl, loaded, onCancel]);

  const handleSaveShortcut = useDocumentSaveShortcut({ disabled: isSubmitBlocked, onSave: () => void submit() });
  const linkHintId = `${linkFieldId}-hint`;
  const linkErrorId = `${linkFieldId}-error`;

  return (
    <form
      aria-busy={!loaded || isPending}
      noValidate={hasLinkField || undefined}
      className="flex flex-col gap-5"
      onKeyDownCapture={handleSaveShortcut}
      onKeyDown={(event) => {
        // 빈 제목이면 제출 버튼이 disabled라 Enter가 아무 일도 하지 않는다. 버튼 제출과 같은 안내를 보인다.
        if (isPending || isEditorUploading || title.trim() || !isImplicitSubmitEnter(event)) return;
        event.preventDefault();
        setTitleError(EMPTY_TITLE_ERROR);
        titleInputRef.current?.focus();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive-border bg-destructive-muted p-3 text-ui text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label className="flex flex-col gap-1.5 text-body font-medium text-secondary-foreground md:text-ui" htmlFor="edit-post-title">
          <span>제목</span>
          <Input
            ref={titleInputRef}
            id="edit-post-title"
            name="title"
            value={title}
            onChange={(event) => {
              draft.setField("title", event.target.value);
              setTitleError("");
            }}
            required
            disabled={!loaded || isPending || frozen}
            aria-invalid={visibleTitleError ? true : undefined}
            aria-describedby={visibleTitleError ? titleErrorId : undefined}
            className="h-12 px-3.5 font-normal md:h-10 md:px-3 md:text-md"
          />
        </label>
        {visibleTitleError ? <p id={titleErrorId} role="alert" className="text-ui text-destructive">{visibleTitleError}</p> : null}
      </div>

      {hasLinkField ? (
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
            value={linkUrl}
            onChange={(event) => {
              draft.setField("mixsetLinkUrl", event.target.value);
              setLinkError("");
            }}
            onBlur={() => {
              const normalizedLink = normalizeMixsetLinkUrl(linkUrl);
              setLinkError(normalizedLink.ok ? "" : normalizedLink.error);
            }}
            disabled={!loaded || isPending || frozen}
            aria-invalid={linkError ? true : undefined}
            aria-describedby={linkError ? `${linkHintId} ${linkErrorId}` : linkHintId}
            className="h-12 px-3.5 font-normal md:h-10 md:px-3"
          />
          <p id={linkHintId} className="text-xs leading-[18px] text-muted-foreground md:leading-4">
            YouTube 영상·Shorts·라이브와 SoundCloud 트랙·세트 링크로 바꿀 수 있습니다.
          </p>
          {linkError ? (
            <p id={linkErrorId} role="alert" className="text-ui text-destructive">{linkError}</p>
          ) : null}
        </div>
      ) : null}

      {loaded && draft.collaboration ? (
        <FullEditor
          key={draft.collab.generation}
          collaboration={draft.collaboration}
          onUploadingChange={setIsEditorUploading}
          minHeight="min(60dvh, 42rem)"
          placeholder="게시물 내용을 이어서 작성하세요…"
          ariaLabel="커뮤니티 게시물 내용"
          toolbar="none"
          disabled={isPending || frozen}
          footer={<CollabDraftStatus draft={draft} />}
          saveShortcutLabel={isSubmitBlocked ? undefined : "변경 저장"}
        />
      ) : (
        <p className="py-6 text-ui text-muted-foreground" role="status">
          {draft.collab.status === "denied" ? "이 게시물을 수정할 수 없습니다." : "게시물을 불러오는 중…"}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-muted pt-3 md:pt-2">
        <Button type="button" variant="outline" size="touch" onClick={cancel} disabled={isPending || isEditorUploading} className="md:h-9 md:rounded-md md:px-3.5 md:text-ui">
          취소
        </Button>
        <Button
          type="submit"
          size="touch"
          disabled={isSubmitDisabled}
          className="flex-1 md:h-9 md:flex-none md:rounded-md md:px-4 md:text-ui"
        >
          {isEditorUploading ? "업로드 완료 대기…" : isPending ? "저장 중…" : "변경사항 저장"}
        </Button>
      </div>
    </form>
  );
}
