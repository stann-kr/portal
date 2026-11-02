"use client";

/**
 * 공용 가이드 페이지 편집 form(관리자). 노트 편집과 같은 실시간 공동 편집을 쓴다:
 * 같은 페이지를 연 기기들이 `guide:<id>` room에서 바로 합쳐지고, 저장 담당 한 탭이 자동 저장한다.
 * 선택창 없이 version 충돌은 최신 version으로 다시 저장하고, 저장·업로드 중 이탈을 막는다.
 * 본문 이미지는 가이드 이미지 저장소로 올리고, 블록 data-block-id(질문 위치)를 편집 중에도 보존한다.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Eye } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { AutosaveStatus } from "@/components/editor/AutosaveStatus";
import { CollabPresence } from "@/components/editor/CollabPresence";
import { createFullEditorExtensions } from "@/components/editor/FullEditor";
import {
  NOTE_TITLE_FIELD_CLASS,
  NOTE_TOPBAR_BUTTON,
  NoteBreadcrumb,
  NoteDocumentBody,
  NoteDocumentStrip,
} from "@/components/notes/NoteDocumentChrome";
import { buttonClassName } from "@/components/ui/button";
import { getGuidePage, type UpdateGuidePageState } from "@/lib/actions/guide";
import { COLLAB_EPOCH_FIELD } from "@/lib/collab/protocol";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import { GUIDE_BASE_REVISION_FIELD, GUIDE_TITLE_MAX_LENGTH, guidePagePath } from "@/lib/guide-content";
import { formatCollabDocKey } from "@/lib/collab/doc-key";
import { collabDocHtml } from "@/lib/collab/client/doc-html";
import { describeCollabStatus } from "@/lib/collab/client/collab-status";
import { COLLAB_META } from "@/lib/collab/client/seed";
import { useCollabAutosave, type CollabSaveResult } from "@/lib/collab/client/useCollabAutosave";
import { useCollabDocument } from "@/lib/collab/client/useCollabDocument";
import { useCollabHeadVersion } from "@/lib/collab/client/useCollabHeadVersion";
import { useCollabLeaveGuard } from "@/lib/collab/client/useCollabLeaveGuard";
import { useCollabMetaField } from "@/lib/collab/client/useCollabMetaField";
import { GUIDE_IMAGE_UPLOADER } from "./guide-image-uploader";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

type GuideSnapshot = { title: string; contentHtml: string };

type GuideEditorFormProps = {
  page: { id: string; title: string; contentHtml: string; version: number };
  actorId: string;
  action: (previous: UpdateGuidePageState, formData: FormData) => Promise<UpdateGuidePageState>;
};

/** 서버는 제목 공백을 한 칸으로 줄인다. */
function normalizeTitle(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function GuideEditorForm({ page, actorId, action }: GuideEditorFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const roomKey = formatCollabDocKey({ kind: "guide", id: page.id });
  const request = useMemo(() => ({ key: roomKey }), [roomKey]);
  const extensionsRef = useRef<ReturnType<typeof createFullEditorExtensions> | null>(null);
  const getExtensions = useCallback(() => {
    extensionsRef.current ??= createFullEditorExtensions({ preserveBlockIds: true });
    return extensionsRef.current;
  }, []);
  const collab = useCollabDocument({
    offlineWritable: true,
    ownerId: actorId,
    request,
    storageKey: roomKey,
    user: { name: "", colorIndex: 0 },
    extensions: getExtensions,
    // 연결돼 있으면 서버의 최신 페이지로 시드한다(못 읽으면 화면이 받은 페이지).
    getSeed: async (_reason, { online }) => {
      const latest = online ? await getGuidePage(page.id).catch(() => null) : null;
      const source = latest ?? page;
      return { key: roomKey, version: source.version, html: source.contentHtml, fields: { title: source.title } };
    },
  });
  const { doc, provider } = collab;
  const epochRef = useRef(collab.epoch);
  useEffect(() => {
    epochRef.current = collab.epoch;
  });
  const [title, setTitle] = useCollabMetaField(doc, "title", page.title);
  const head = useCollabHeadVersion(doc, page.version);
  const [isEditorUploading, setIsEditorUploading] = useState(false);

  const readSnapshot = useCallback((): GuideSnapshot | null => {
    if (!doc || doc.isDestroyed) return null;
    const rawTitle = doc.getMap(COLLAB_META).get("title");
    const currentTitle = normalizeTitle(typeof rawTitle === "string" ? rawTitle : "");
    if (!currentTitle) return null;
    return { title: currentTitle, contentHtml: collabDocHtml(doc, getExtensions()) };
  }, [doc, getExtensions]);

  const save = useCallback(
    async (snapshot: GuideSnapshot): Promise<CollabSaveResult> => {
      // 이 저장의 room 세대는 시작할 때 고정한다(삭제 뒤 옛 내용을 다시 보내지 않게).
      const epoch = epochRef.current;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const formData = new FormData();
        formData.set("title", snapshot.title);
        formData.set("contentHtml", snapshot.contentHtml);
        formData.set(GUIDE_BASE_REVISION_FIELD, String(head.current()));
        if (typeof epoch === "number") formData.set(COLLAB_EPOCH_FIELD, String(epoch));
        const state = await action({}, formData);
        if (state.success) {
          head.publish(state.page?.version ?? state.currentRevision ?? head.current());
          return { ok: true };
        }
        // room 내용이 이미 합쳐진 결과다. 선택창 없이 최신 version으로 한 번 더 저장한다.
        const latest = state.conflictPage?.version ?? state.currentRevision;
        // room이 비워진 뒤의 옛 저장(collabStale)은 다시 보내지 않는다.
        if (state.collabStale || state.conflictKind !== "VERSION_CONFLICT" || attempt > 0 || typeof latest !== "number") {
          return { ok: false, error: state.error ?? "저장하지 못했습니다. 입력 내용은 이 기기와 실시간 문서에 남아 있습니다." };
        }
        head.adopt(latest);
      }
      return { ok: false, error: "저장하지 못했습니다." };
    },
    [action, head],
  );

  const writable = collab.mode === "write" && collab.ready && (collab.status === "connected" || collab.status === "solo");
  const autosave = useCollabAutosave({
    doc,
    enabled: writable && !isEditorUploading,
    isSaver: collab.isSaver,
    readSnapshot,
    save,
  });
  useCollabLeaveGuard(() => autosave.hasPendingSave() || collab.hasUnsentChanges() || isEditorUploading);
  const handleSaveShortcut = useDocumentSaveShortcut({ disabled: !writable, onSave: () => void autosave.flush() });

  // 긴 제목도 잘리지 않게 내용 높이에 맞춘다.
  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [title]);

  const statusView = describeCollabStatus({
    connection: collab.status,
    mode: collab.mode,
    isSaver: collab.isSaver,
    autosave: autosave.status,
    autosaveError: autosave.error,
    blockedMessage: "제목을 입력하면 자동으로 저장됩니다.",
  });
  const solo = collab.status === "solo";
  const collaboration = useMemo(
    () => (doc ? { doc, awareness: solo ? null : provider?.awareness ?? null, user: collab.user } : undefined),
    [doc, provider, solo, collab.user],
  );
  const statusBar = (
    <span className="mr-1 inline-flex min-w-0 items-center gap-3">
      <CollabPresence awareness={solo ? null : provider?.awareness} />
      <AutosaveStatus
        variant="bar"
        status={statusView.kind}
        message={statusView.message}
        label={statusView.message}
        shortMessage={statusView.shortMessage}
      />
    </span>
  );
  const viewHref = guidePagePath(page.id);
  const currentTitle = normalizeTitle(title) || "제목 없음";

  return (
    <form
      ref={formRef}
      aria-busy={!collab.ready || autosave.status === "saving"}
      data-collab-status={collab.status}
      data-collab-saver={collab.isSaver ? "true" : "false"}
      onKeyDownCapture={handleSaveShortcut}
      onSubmit={(event) => {
        event.preventDefault();
        void autosave.flush();
      }}
    >
      <MobileTopBar
        hideTitle
        back={{ href: viewHref, label: "가이드로 돌아가기" }}
        actions={
          <>
            {statusBar}
            <Link href={viewHref} aria-label="읽기 화면으로" className={NOTE_TOPBAR_BUTTON}>
              <Eye className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
            </Link>
          </>
        }
      />
      <NoteDocumentStrip start={<NoteBreadcrumb parent={{ href: viewHref, label: "가이드" }} current={currentTitle} />}>
        {statusBar}
        <Link href={viewHref} className={buttonClassName({ variant: "ghost" })}>
          <Eye className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
          읽기 화면
        </Link>
      </NoteDocumentStrip>
      <NoteDocumentBody>
        <h1 className="sr-only">가이드 편집</h1>
        <textarea
          ref={titleRef}
          name="title"
          aria-label="제목"
          value={title}
          rows={1}
          onChange={(event) => setTitle(event.target.value.replace(/\n/gu, " "))}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            formRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
          }}
          required
          maxLength={GUIDE_TITLE_MAX_LENGTH}
          placeholder="제목 없음"
          disabled={!writable}
          className={NOTE_TITLE_FIELD_CLASS}
        />
        <p className="text-ui text-muted-foreground">
          모든 학생이 같은 내용을 봅니다. 문단을 지워도 그 문단에 남은 질문은 &lsquo;위치가 바뀐 질문&rsquo;으로 남습니다.
        </p>
        {statusView.kind === "error" ? (
          <AutosaveStatus status="error" message={statusView.message} onRetry={autosave.retry} />
        ) : null}
        {collab.ready && collaboration ? (
          <FullEditor
            collaboration={collaboration}
            disabled={collab.mode !== "write" || collab.status === "denied"}
            onUploadingChange={setIsEditorUploading}
            imageUploader={GUIDE_IMAGE_UPLOADER}
            preserveBlockIds
            placeholder="가이드 내용을 작성하세요... (/ 로 블록 삽입)"
            minHeight="50dvh"
            ariaLabel="가이드 내용"
            variant="page"
            saveShortcutLabel={writable ? "바로 저장" : undefined}
          />
        ) : (
          <p className="py-6 text-ui text-muted-foreground" role="status">
            {collab.status === "denied" ? statusView.message : "가이드를 불러오는 중…"}
          </p>
        )}
      </NoteDocumentBody>
    </form>
  );
}
