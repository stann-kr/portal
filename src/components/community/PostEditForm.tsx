"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { generateJSON, getSchema } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
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
import type * as Y from "yjs";
import { collabSavedMarker } from "@/lib/collab/saved-marker";
import { CollabNotices } from "@/components/editor/CollabNotices";
import { CollabEditorPending } from "@/components/editor/CollabEditorPending";
import { isCollabEditorPending } from "@/lib/collab/client/collab-status";
import { cn } from "@/lib/utils";

const EMPTY_TITLE_ERROR = "제목을 입력해 주세요.";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false, loading: () => <CollabEditorPending minHeight="min(60dvh, 42rem)" /> },
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
 * "변경사항 저장"을 눌러야 게시본이 바뀐다(독자에게 수정 중인 내용이 보이지 않는다). "취소"는 화면만 닫고 작업본은 남긴다.
 * 게시하지 않은 수정을 버리려면 "게시된 글로 되돌리기"를 쓴다(확인 뒤 작업본을 서버의 최신 게시본으로 맞춘다, 2026-11-13 사용자 결정).
 */
export function PostEditForm(props: PostEditFormProps) {
  return <PostEditFormContent key={`${props.actorId}:${props.post.id}`} {...props} />;
}

function PostEditFormContent({ actorId, post, onCancel, onSaved, onBusyChange, mixsetLinkUrl: initialLinkUrl }: PostEditFormProps) {
  const hasLinkField = typeof initialLinkUrl === "string";
  const getExtensions = useEditorExtensions();
  const headRef = useRef<PostHead>({ version: post.version, title: post.title, contentHtml: post.contentHtml });
  // 게시본의 링크 칸 값(작업본이 게시본과 같은지 볼 때 쓴다).
  const headLinkRef = useRef(initialLinkUrl ?? "");
  // 화면이 "게시한 뒤에 고친 내용이 있는지"를 그릴 때 쓰는 게시본 사본(ref는 비동기 저장·시드가 읽는다).
  const [headView, setHeadView] = useState({ title: post.title, contentHtml: post.contentHtml, link: initialLinkUrl ?? "" });
  const applyHead = (head: PostHead, link: string) => {
    headRef.current = head;
    headLinkRef.current = link;
    setHeadView({ title: head.title, contentHtml: head.contentHtml, link });
  };
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
      const media = hasLinkField ? classifyMixsetMedia(latest) : null;
      applyHead({ version: latest.version, title: latest.title, contentHtml: latest.contentHtml }, media?.kind === "link" ? media.url : "");
      return {
        html: latest.contentHtml,
        fields: { title: latest.title, ...(hasLinkField ? { mixsetLinkUrl: media?.kind === "link" ? media.url : "" } : {}) },
        version: latest.version,
        lifecycle: latest.lifecycle,
      };
    },
    extensions: getExtensions,
  });
  /** 작업본(제목·링크·본문)이 게시본과 다른지. 게시하지 않은 수정이 있으면 복원을 막는 기준이다. */
  function isWorkingCopyDirty(doc: Y.Doc): boolean {
    const head = headRef.current;
    const meta = doc.getMap(COLLAB_META);
    const read = (name: string) => (typeof meta.get(name) === "string" ? (meta.get(name) as string) : "");
    if (read("title") !== head.title) return true;
    if (hasLinkField && read("mixsetLinkUrl") !== headLinkRef.current) return true;
    return collabDocHtml(doc, getExtensions()) !== canonicalCollabHtml(head.contentHtml, getExtensions());
  }
  // 작업본이 게시본과 같으면 room에 "밀린 내용 없음"을 알린다(수정 화면을 닫은 뒤에도 복원이 막히지 않게).
  const reportedCleanRef = useRef<unknown>(null);
  useEffect(() => {
    const doc = draft.collab.doc;
    if (!doc || !draft.ready || draft.collab.mode !== "write" || draft.collab.status !== "connected") return;
    if (reportedCleanRef.current === doc) return;
    reportedCleanRef.current = doc;
    if (!isWorkingCopyDirty(doc)) draft.collab.provider?.reportSaved(collabSavedMarker(doc));
  });
  const { title, mixsetLinkUrl: linkUrl } = draft.fields;
  const { contentHtml } = draft;
  const loaded = draft.ready && draft.collab.mode === "write";
  // 읽기·권한 없음·휴지통이면 같은 편집기를 그 자리에서 잠근다(연결 중·오프라인은 잠그지 않는다).
  const locked = !loaded || draft.collab.status === "denied" || draft.collab.status === "trashed";
  const [isPending, setIsPending] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const revertConfirm = useConfirmAction();
  const [error, setError] = useState<string | null>(null);
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [linkError, setLinkError] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const titleErrorId = useId();
  const linkFieldId = useId();
  const visibleTitleError = title.trim() ? "" : titleError;
  useBusyNavigationGuard(isPending || isReverting);

  useEffect(() => {
    onBusyChange?.(isPending || isReverting || isEditorUploading);
  }, [isEditorUploading, isPending, isReverting, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  const isSubmitBlocked = !loaded || isPending || isReverting || isEditorUploading;
  const isSubmitDisabled = isSubmitBlocked || !title.trim() || isRichTextEmpty(contentHtml);

  const submit = useCallback(async () => {
    if (isSubmitBlocked) return;
    // 본문·제목·링크·lifecycle은 작업본(doc)에서 같은 동기 구간에 읽고 재시도에서도 그대로 쓴다(복원 전 칸 + 새 lifecycle 조합 방지).
    const liveDoc = draft.collab.doc;
    const liveMeta = liveDoc && !liveDoc.isDestroyed ? liveDoc.getMap(COLLAB_META) : null;
    const readField = (name: string, fallback: string) => {
      const value = liveMeta?.get(name);
      return typeof value === "string" ? value : fallback;
    };
    const latestContentHtml = draft.readHtml();
    const title = readField("title", draft.fields.title);
    const linkUrl = readField("mixsetLinkUrl", draft.fields.mixsetLinkUrl ?? "");
    const lifecycle = draft.collab.readLifecycle();
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
    // 보낸 작업본의 저장 표지. 응답을 기다리는 동안 다른 기기가 고쳤으면 "저장됨"으로 알리지 않는다.
    const submittedMarker = draft.collab.doc && !draft.collab.doc.isDestroyed ? collabSavedMarker(draft.collab.doc) : null;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const head = headRef.current;
        const formData = new FormData();
        formData.set("title", title);
        formData.set("contentHtml", latestContentHtml);
        if (hasLinkField) formData.set(MIXSET_LINK_FIELD, linkUrl);
        formData.set(CREATION_OPERATION_FIELD, createCreationOperationId());
        formData.set(POST_BASE_REVISION_FIELD, String(head.version));
        if (typeof lifecycle === "number") formData.set(COLLAB_EPOCH_FIELD, String(lifecycle));
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
          if (state.post) {
            applyHead(
              { version: state.post.version, title: state.post.title, contentHtml: state.post.contentHtml },
              hasLinkField ? linkUrl : headLinkRef.current,
            );
          } else if (hasLinkField) {
            applyHead(headRef.current, linkUrl);
          }
          // 작업본이 게시본과 같아졌음을 room에 알린다(복원 준비 때 "밀린 내용 없음"). 그사이 바뀌었으면 알리지 않는다.
          const doc = draft.collab.doc;
          if (doc && !doc.isDestroyed && submittedMarker) {
            const now = collabSavedMarker(doc);
            if (now.length === submittedMarker.length && now.every((byte, index) => byte === submittedMarker[index])) {
              draft.collab.provider?.reportSaved(now);
            }
          }
          onSaved();
          return;
        }
        if (state.collabStale) {
          // 다른 화면에서 이전 버전으로 되돌렸고 이 작업본에 아직 반영되기 전이다. 작업본은 그대로 두고 다시 저장하게 한다.
          setError("다른 화면에서 이 게시물을 이전 버전으로 되돌렸습니다. 되돌린 내용이 반영되면 다시 저장해 주세요. 수정 내용은 작업본에 남아 있습니다.");
          return;
        }
        // 작업본은 이미 합쳐진 결과다. 선택창 없이 최신 게시본을 기준으로 한 번 더 저장한다.
        if (!state.collabStale && state.conflictKind === "VERSION_CONFLICT" && state.conflictPost && attempt === 0) {
          applyHead(
            { version: state.conflictPost.version, title: state.conflictPost.title, contentHtml: state.conflictPost.contentHtml },
            headLinkRef.current,
          );
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
  }, [draft, hasLinkField, isSubmitBlocked, onSaved, post.id]);

  // 게시한 뒤에 고친 내용이 있는지(제목·링크·본문). 본문은 200ms 늦게 따라오는 작업본 HTML과 게시본을 같은 형태로 맞춰 비교한다.
  const canonicalHeadHtml = useMemo(
    () => canonicalCollabHtml(headView.contentHtml, getExtensions()),
    [getExtensions, headView.contentHtml],
  );
  const hasUnpublishedEdits = loaded && (
    title !== headView.title ||
    (hasLinkField && linkUrl !== headView.link) ||
    // 작업본 HTML을 아직 한 번도 읽지 않은 첫 순간("")은 고친 것으로 보지 않는다(버튼이 깜박이지 않게).
    (contentHtml !== "" && contentHtml !== canonicalHeadHtml)
  );

  /**
   * 게시된 글로 되돌리기: 작업본(제목·링크·본문)을 서버의 최신 게시본으로 맞춘다. 같은 작업본을 연 다른 기기·편집자의
   * 게시 전 입력도 함께 사라지므로 확인을 거친 뒤에만 부른다. 이 화면을 연 뒤 다른 기기가 게시했을 수 있어 처음 받은
   * 게시본이 아니라 최신 게시본을 다시 읽는다(옛 게시본으로 되돌리면 다음 저장이 그 사이의 게시를 덮는다).
   * 최신 게시본을 읽지 못하면 아무것도 바꾸지 않는다.
   */
  const revertToPublished = async () => {
    const doc = draft.collab.doc;
    if (!doc || doc.isDestroyed || !loaded || isPending || isReverting) return;
    setIsReverting(true);
    setError(null);
    try {
      const latest = await getPostCollabSeed(post.id).catch(() => null);
      if (!latest || doc.isDestroyed) {
        setError("게시된 글을 읽지 못해 되돌리지 않았습니다. 수정 내용은 작업본에 남아 있습니다. 다시 시도해 주세요.");
        return;
      }
      const media = hasLinkField ? classifyMixsetMedia(latest) : null;
      const head = { version: latest.version, title: latest.title, contentHtml: latest.contentHtml };
      applyHead(head, media?.kind === "link" ? media.url : "");
      // 이미 게시본과 같으면 쓰지 않는다(같은 내용을 지우고 다시 쓰면 다른 기기의 커서·입력과 겹친다).
      if (isWorkingCopyDirty(doc)) {
        const extensions = getExtensions();
        doc.transact(() => {
          const fragment = doc.getXmlFragment(COLLAB_FRAGMENT);
          if (fragment.length > 0) fragment.delete(0, fragment.length);
          prosemirrorJSONToYXmlFragment(getSchema(extensions), generateJSON(head.contentHtml || "<p></p>", extensions), fragment);
          const meta = doc.getMap(COLLAB_META);
          meta.set("title", head.title);
          if (hasLinkField) meta.set("mixsetLinkUrl", headLinkRef.current);
        });
      }
      setTitleError("");
      setLinkError("");
      // 작업본이 게시본과 같아졌음을 room에 알린다(변경 이력 복원이 다시 가능해진다).
      if (draft.collab.status === "connected") draft.collab.provider?.reportSaved(collabSavedMarker(doc));
      focusTitleAfterRevertRef.current = true;
    } finally {
      setIsReverting(false);
    }
  };
  // 되돌린 뒤에는 "게시된 글로 되돌리기" 버튼이 사라진다. 초점이 사라진 버튼에 남아 body로 떨어지지 않게 제목으로 옮긴다.
  const focusTitleAfterRevertRef = useRef(false);
  useEffect(() => {
    if (hasUnpublishedEdits || revertConfirm.isOpen || !focusTitleAfterRevertRef.current) return;
    focusTitleAfterRevertRef.current = false;
    titleInputRef.current?.focus({ preventScroll: true });
  }, [hasUnpublishedEdits, revertConfirm.isOpen]);

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
            disabled={locked || isPending || isReverting}
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
            disabled={locked || isPending || isReverting}
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

      <CollabNotices collab={draft.collab} />
      {!isCollabEditorPending(draft.collab) && draft.collaboration ? (
        <FullEditor
          collaboration={draft.collaboration}
          onUploadingChange={setIsEditorUploading}
          minHeight="min(60dvh, 42rem)"
          placeholder="게시물 내용을 이어서 작성하세요…"
          ariaLabel="커뮤니티 게시물 내용"
          toolbar="none"
          disabled={locked || isPending || isReverting}
          footer={<CollabDraftStatus draft={draft} />}
          saveShortcutLabel={isSubmitBlocked ? undefined : "변경 저장"}
        />
      ) : (
        <CollabEditorPending
          collab={draft.collab}
          minHeight="min(60dvh, 42rem)"
          label="게시물을 불러오는 중…"
          deniedMessage="이 게시물을 수정할 수 없습니다."
        />
      )}

      {revertConfirm.isOpen ? (
        <ConfirmPanel
          confirm={revertConfirm}
          message="게시한 뒤에 고친 내용을 버리고 게시된 글로 되돌립니다. 함께 고치던 사람이 넣은 내용도 사라지며 되살릴 수 없습니다."
          confirmLabel="게시된 글로 되돌리기"
          pendingLabel="되돌리는 중…"
          pending={isReverting}
          onConfirm={() => void revertToPublished()}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-muted pt-3 md:pt-2">
        {/* 게시한 뒤에 고친 내용이 있을 때만 보인다. 확인이 열린 동안에는 자리만 두고 숨긴다(닫으면 초점이 이 버튼으로 돌아온다). */}
        {hasUnpublishedEdits || revertConfirm.isOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="touch"
            aria-expanded={revertConfirm.isOpen}
            disabled={isPending || isReverting || isEditorUploading || revertConfirm.isOpen}
            onClick={(event) => revertConfirm.request(event.currentTarget)}
            className={cn("-ml-2 gap-1.5 px-2 text-secondary-foreground md:h-9 md:rounded-md md:px-2 md:text-ui", revertConfirm.isOpen && "invisible")}
          >
            <RotateCcw className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            게시된 글로 되돌리기
          </Button>
        ) : null}
        {/* 취소는 화면만 닫는다. 작업본은 다른 기기·다른 편집자와 함께 쓰므로 닫는다고 되돌리지 않는다.
            게시하지 않은 수정은 작업본에 남고, 버리려면 왼쪽 "게시된 글로 되돌리기"를 쓴다. */}
        <div className="ml-auto flex gap-2 max-md:w-full">
          <Button type="button" variant="outline" size="touch" onClick={onCancel} disabled={isPending || isReverting || isEditorUploading || revertConfirm.isOpen} className="md:h-9 md:rounded-md md:px-3.5 md:text-ui">
            취소
          </Button>
          <Button
            type="submit"
            size="touch"
            disabled={isSubmitDisabled || revertConfirm.isOpen}
            className="flex-1 md:h-9 md:flex-none md:rounded-md md:px-4 md:text-ui"
          >
            {isEditorUploading ? "업로드 완료 대기…" : isPending ? "저장 중…" : "변경사항 저장"}
          </Button>
        </div>
      </div>
    </form>
  );
}
