"use client";

/**
 * 공용 가이드 페이지 편집 form. 노트 편집(NoteEditorForm)과 같은 보호를 둔다:
 * 이 기기·서버 초안(useSyncedFormDraft, "guide-page" 종류는 관리자만), 기준 버전 충돌 시 저장을 멈추고
 * 서버 최신본/내 초안 중 고르기, 자동 저장, 저장·업로드 중 이탈 막기.
 * 본문 이미지는 가이드 이미지 저장소로 올리고, 블록 data-block-id(질문 위치)를 편집 중에도 보존한다.
 */
import { useActionState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Eye } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { AutosaveStatus } from "@/components/editor/AutosaveStatus";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { DraftConflictRecovery } from "@/components/editor/DraftConflictRecovery";
import { RichTextContent } from "@/components/editor/RichTextContent";
import {
  NOTE_TITLE_FIELD_CLASS,
  NOTE_TOPBAR_BUTTON,
  NoteBreadcrumb,
  NoteDocumentBody,
  NoteDocumentStrip,
} from "@/components/notes/NoteDocumentChrome";
import { buttonClassName } from "@/components/ui/button";
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { createDocumentDraftKey } from "@/lib/form-draft";
import type { UpdateGuidePageState } from "@/lib/actions/guide";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { useDocumentAutosave } from "@/lib/hooks/useDocumentAutosave";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import {
  createDocumentSnapshotFingerprint,
  DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD,
} from "@/lib/document-snapshot-fingerprint";
import {
  createDocumentEditDraftMetadata,
  resolveDocumentEditDraftBase,
  type CompactDocumentEditDraftMetadata,
  type DocumentEditDraftBaseFields,
} from "@/lib/document-edit-draft";
import { GUIDE_BASE_REVISION_FIELD, GUIDE_TITLE_MAX_LENGTH, guidePagePath } from "@/lib/guide-content";
import { GUIDE_IMAGE_UPLOADER } from "./guide-image-uploader";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

type GuideEditSnapshot = { title: string; contentHtml: string };
type GuideRevisionDraftFields = { baseRevision?: number };
type GuideEditDraft = GuideEditSnapshot & DocumentEditDraftBaseFields & GuideRevisionDraftFields;
type CompactGuideEditDraft = GuideEditSnapshot & CompactDocumentEditDraftMetadata & GuideRevisionDraftFields;
type ConflictServerState = { snapshot: GuideEditSnapshot; version: number };

type GuideEditorFormProps = {
  page: { id: string; title: string; contentHtml: string; version: number };
  actorId: string;
  action: (previous: UpdateGuidePageState, formData: FormData) => Promise<UpdateGuidePageState>;
};

function parseRevision(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

/** 서버는 제목 공백을 한 칸으로 줄인다. 입력 중인 띄어쓰기를 저장 차이로 보지 않는다. */
function normalizeTitle(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function sameSnapshot(a: GuideEditSnapshot, b: GuideEditSnapshot): boolean {
  return normalizeTitle(a.title) === normalizeTitle(b.title) && a.contentHtml === b.contentHtml;
}

function fingerprint(pageId: string, snapshot: GuideEditSnapshot): string {
  return createDocumentSnapshotFingerprint({
    kind: "guide-page",
    id: pageId,
    title: snapshot.title,
    contentHtml: snapshot.contentHtml,
    noteDate: null,
  });
}

export function GuideEditorForm(props: GuideEditorFormProps) {
  return <GuideEditorFormContent key={`${props.actorId}:${props.page.id}`} {...props} />;
}

function GuideEditorFormContent({ page, actorId, action }: GuideEditorFormProps) {
  const serverVersion = page.version;
  const [title, setTitle] = useState(page.title);
  const {
    contentHtml,
    contentVersion,
    setContentHtml,
    handleEditorChange,
    handleEditorDirty,
    readLatestContentHtml,
    commitLatestContentHtml,
  } = useDeferredEditorContent(page.contentHtml);
  const [hasStaleDraftBase, setHasStaleDraftBase] = useState(false);
  const [baseRevision, setBaseRevision] = useState(serverVersion);
  const [state, formAction, isPending] = useActionState<UpdateGuidePageState, FormData>(async (previous, data) => {
    try {
      return await action(previous, data);
    } catch {
      return { error: "저장 결과를 확인하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요." };
    }
  }, {});
  useBusyNavigationGuard(isPending);
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const contentHtmlInputRef = useRef<HTMLInputElement>(null);
  const handledSavedPageRef = useRef<UpdateGuidePageState["page"]>(undefined);
  const handledConflictPageRef = useRef<UpdateGuidePageState["conflictPage"]>(undefined);
  const [conflictServer, setConflictServer] = useState<ConflictServerState | null>(null);
  const submittedDraftRef = useRef<CompactGuideEditDraft | null>(null);
  const submittedDraftAliasesRef = useRef<readonly GuideEditDraft[] | null>(null);
  const restoredDraftRef = useRef<GuideEditDraft | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<GuideEditSnapshot>(() => ({
    title: page.title,
    contentHtml: page.contentHtml,
  }));
  const savedSnapshotRef = useRef(savedSnapshot);
  const [baseFingerprint, setBaseFingerprint] = useState(() => fingerprint(page.id, page));
  const baseFingerprintRef = useRef(baseFingerprint);
  const draftBaseFingerprintRef = useRef(baseFingerprint);
  const adoptSavedSnapshot = useCallback(
    (snapshot: GuideEditSnapshot) => {
      const next = { title: snapshot.title, contentHtml: snapshot.contentHtml };
      savedSnapshotRef.current = next;
      setSavedSnapshot(next);
      const nextFingerprint = fingerprint(page.id, next);
      baseFingerprintRef.current = nextFingerprint;
      setBaseFingerprint(nextFingerprint);
    },
    [page.id],
  );
  const serverSnapshot = useMemo(
    () => ({ title: page.title, contentHtml: page.contentHtml, version: serverVersion }),
    [page.contentHtml, page.title, serverVersion],
  );
  const previousServerSnapshotRef = useRef(serverSnapshot);
  const createSubmittedDraftAliases = useCallback(
    (snapshot: GuideEditSnapshot): readonly GuideEditDraft[] => {
      const aliases: GuideEditDraft[] = [{ ...snapshot }, { ...snapshot, base: { ...savedSnapshotRef.current } }];
      const restored = restoredDraftRef.current;
      if (restored && restored.title === snapshot.title && restored.contentHtml === snapshot.contentHtml) {
        aliases.push(restored);
      }
      return aliases;
    },
    [],
  );

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
  } = useSyncedFormDraft<GuideEditDraft>(
    createDocumentDraftKey("guide-page", actorId, page.id),
    (draft) => {
      restoredDraftRef.current = draft;
      setBaseRevision(parseRevision(draft.baseRevision) ?? serverVersion);
      const restoredSnapshot = {
        title: draft.title ?? page.title,
        contentHtml: draft.contentHtml ?? page.contentHtml,
      };
      const draftMatchesCurrentServer =
        restoredSnapshot.title === serverSnapshot.title && restoredSnapshot.contentHtml === serverSnapshot.contentHtml;
      const resolvedBase = resolveDocumentEditDraftBase(
        draft,
        { kind: "guide-page", id: page.id, title: serverSnapshot.title, contentHtml: serverSnapshot.contentHtml, noteDate: null },
        draftMatchesCurrentServer,
      );
      draftBaseFingerprintRef.current = resolvedBase.draftBaseFingerprint;
      setHasStaleDraftBase(resolvedBase.hasStaleDraftBase);
      if (!resolvedBase.hasStaleDraftBase) adoptSavedSnapshot(serverSnapshot);
      setTitle(restoredSnapshot.title);
      setContentHtml(restoredSnapshot.contentHtml);
    },
    {
      onReset: () => {
        restoredDraftRef.current = null;
        setBaseRevision(serverVersion);
        adoptSavedSnapshot(serverSnapshot);
        draftBaseFingerprintRef.current = baseFingerprintRef.current;
        setHasStaleDraftBase(false);
        setTitle(serverSnapshot.title);
        setContentHtml(serverSnapshot.contentHtml);
      },
    },
  );

  const handleSaveShortcut = useDocumentSaveShortcut({
    disabled: !loaded || !canSubmit || isPending || hasStaleDraftBase,
    onSave: () => formRef.current?.requestSubmit(),
  });

  const draftMetadata = useCallback(
    () => createDocumentEditDraftMetadata(hasStaleDraftBase ? draftBaseFingerprintRef.current : baseFingerprintRef.current),
    [hasStaleDraftBase],
  );

  useEffect(() => {
    if (!loaded) return;
    const latestContentHtml = readLatestContentHtml();
    const matchesServer =
      title === savedSnapshotRef.current.title && latestContentHtml === savedSnapshotRef.current.contentHtml;
    if (!hasStaleDraftBase && matchesServer) {
      restoredDraftRef.current = null;
      clear();
      return;
    }
    save({
      title,
      baseRevision,
      ...draftMetadata(),
      get contentHtml() {
        return readLatestContentHtml();
      },
    });
  }, [baseRevision, clear, contentHtml, draftMetadata, hasStaleDraftBase, loaded, readLatestContentHtml, save, title]);

  // 다른 화면의 저장으로 서버 값이 바뀌었을 때: 손대지 않은 편집이면 따라가고, 이어 쓴 내용이 있으면 저장을 멈춘다.
  useEffect(() => {
    if (!loaded) return;
    const previousServer = previousServerSnapshotRef.current;
    const serverChanged =
      previousServer.title !== serverSnapshot.title ||
      previousServer.contentHtml !== serverSnapshot.contentHtml ||
      previousServer.version !== serverSnapshot.version;
    if (!serverChanged) return;
    previousServerSnapshotRef.current = serverSnapshot;
    if (serverVersion < Math.max(baseRevision, conflictServer?.version ?? 0)) return;
    const submitted = submittedDraftRef.current;
    const ownSave =
      (submitted && sameSnapshot(submitted, serverSnapshot)) ||
      (state.success && state.page && sameSnapshot(state.page, serverSnapshot));
    if (ownSave) return;
    setConflictServer(null);
    const latestContentHtml = readLatestContentHtml();
    const localMatchesPrevious = title === previousServer.title && latestContentHtml === previousServer.contentHtml;
    const localMatchesCurrent = title === serverSnapshot.title && latestContentHtml === serverSnapshot.contentHtml;
    if (localMatchesCurrent || (!hasStaleDraftBase && localMatchesPrevious)) {
      restoredDraftRef.current = null;
      clear();
      adoptSavedSnapshot(serverSnapshot);
      setBaseRevision(serverVersion);
      draftBaseFingerprintRef.current = baseFingerprintRef.current;
      setTitle(serverSnapshot.title);
      setContentHtml(serverSnapshot.contentHtml);
      setHasStaleDraftBase(false);
      return;
    }
    if (!hasStaleDraftBase) draftBaseFingerprintRef.current = baseFingerprintRef.current;
    setHasStaleDraftBase(true);
  }, [
    adoptSavedSnapshot,
    baseRevision,
    clear,
    conflictServer,
    hasStaleDraftBase,
    loaded,
    readLatestContentHtml,
    serverSnapshot,
    serverVersion,
    setContentHtml,
    state.page,
    state.success,
    title,
  ]);

  useEffect(() => {
    if (!state.conflictPage || handledConflictPageRef.current === state.conflictPage) return;
    handledConflictPageRef.current = state.conflictPage;
    setConflictServer({
      snapshot: { title: state.conflictPage.title, contentHtml: state.conflictPage.contentHtml },
      version: state.conflictPage.version,
    });
    if (!hasStaleDraftBase) draftBaseFingerprintRef.current = baseFingerprintRef.current;
    setHasStaleDraftBase(true);
  }, [hasStaleDraftBase, state.conflictPage]);

  useEffect(() => {
    if (!state.success || !state.page || handledSavedPageRef.current === state.page) return;
    handledSavedPageRef.current = state.page;
    const savedPage = state.page;
    const submittedSnapshot = submittedDraftRef.current;
    const latestContentHtml = readLatestContentHtml();
    // 저장 요청 뒤에도 계속 썼다면 그 내용을 지키고 다음 자동 저장에 맡긴다.
    const typedSinceSubmit = Boolean(
      submittedSnapshot && !sameSnapshot(submittedSnapshot, { title, contentHtml: latestContentHtml }),
    );
    clear({
      reason: "submitted",
      submittedData: submittedDraftRef.current ?? {
        title,
        contentHtml,
        ...createDocumentEditDraftMetadata(baseFingerprintRef.current),
      },
      submittedAliases: submittedDraftAliasesRef.current ?? createSubmittedDraftAliases({ title, contentHtml }),
    });
    submittedDraftRef.current = null;
    submittedDraftAliasesRef.current = null;
    restoredDraftRef.current = null;
    setConflictServer(null);
    adoptSavedSnapshot({ title: savedPage.title, contentHtml: savedPage.contentHtml });
    setBaseRevision(savedPage.version);
    draftBaseFingerprintRef.current = baseFingerprintRef.current;
    setHasStaleDraftBase(false);
    if (!typedSinceSubmit) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 저장 결과(블록 식별자가 붙은 HTML)를 편집기·초안 저장소와 한 번에 맞춘다.
      if (normalizeTitle(title) !== savedPage.title) setTitle(savedPage.title);
      // 서버가 블록 식별자를 붙이거나 정리했을 때만 편집기를 다시 채운다. 같으면 커서를 건드리지 않는다.
      if (latestContentHtml !== savedPage.contentHtml) setContentHtml(savedPage.contentHtml);
    }
  }, [
    adoptSavedSnapshot,
    clear,
    contentHtml,
    createSubmittedDraftAliases,
    readLatestContentHtml,
    setContentHtml,
    state.page,
    state.success,
    title,
  ]);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [title]);

  const dirty = loaded && !sameSnapshot(savedSnapshot, { title, contentHtml });
  const changeKey = `${title}\u0000${contentHtml}`;
  const submittedKeyRef = useRef("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(() => {
    if (state.error) setFailedKey(submittedKeyRef.current);
    else if (state.success) setFailedKey(null);
  }, [state]);
  const missingRequired = !normalizeTitle(title);
  const autosaveReady = loaded && canSubmit && !isPending && !hasStaleDraftBase && !missingRequired;
  useDocumentAutosave({
    enabled: autosaveReady && failedKey !== changeKey && !isEditorUploading,
    dirty,
    changeKey,
    onSave: () => formRef.current?.requestSubmit(),
  });
  const autosaveStatus = isPending
    ? "saving"
    : hasStaleDraftBase
      ? "blocked"
      : state.error && failedKey === changeKey
        ? "error"
        : dirty
          ? missingRequired ? "blocked" : "pending"
          : "saved";
  const autosaveMessage =
    autosaveStatus === "error"
      ? state.error
      : hasStaleDraftBase
        ? "다른 곳의 변경을 확인할 때까지 저장을 멈췄습니다."
        : "제목을 입력하면 자동으로 저장됩니다.";
  const retrySave = () => formRef.current?.requestSubmit();

  const latestServerState = () => conflictServer ?? { snapshot: serverSnapshot, version: serverVersion };
  const conflictRecovery = hasStaleDraftBase ? (
    <div className="flex flex-col gap-3">
      <DraftConflictRecovery
        documentLabel="가이드"
        onUseServer={() => {
          const latestServer = latestServerState();
          restoredDraftRef.current = null;
          clear();
          adoptSavedSnapshot(latestServer.snapshot);
          setBaseRevision(latestServer.version);
          draftBaseFingerprintRef.current = baseFingerprintRef.current;
          setTitle(latestServer.snapshot.title);
          setContentHtml(latestServer.snapshot.contentHtml);
          setConflictServer(null);
          setHasStaleDraftBase(false);
          titleRef.current?.focus();
        }}
        onKeepDraft={() => {
          const latestServer = latestServerState();
          adoptSavedSnapshot(latestServer.snapshot);
          setBaseRevision(latestServer.version);
          draftBaseFingerprintRef.current = baseFingerprintRef.current;
          setConflictServer(null);
          setHasStaleDraftBase(false);
          titleRef.current?.focus();
        }}
      />
      <details className="group rounded-lg border border-border">
        <summary className="cursor-pointer rounded-lg px-4 py-3 text-ui font-medium text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          서버 최신본 {conflictServer?.version ?? serverVersion}번 확인·복사
        </summary>
        <div className="flex flex-col gap-2 border-t border-muted px-4 py-3.5">
          <p className="font-medium">{conflictServer?.snapshot.title ?? serverSnapshot.title}</p>
          <RichTextContent html={conflictServer?.snapshot.contentHtml ?? serverSnapshot.contentHtml} className="text-body" />
        </div>
      </details>
    </div>
  ) : null;

  const statusBar = (
    <AutosaveStatus
      variant="bar"
      status={autosaveStatus}
      message={autosaveMessage}
      shortMessage={hasStaleDraftBase ? "저장 멈춤" : "저장 대기"}
      className="mr-1"
    />
  );
  const viewHref = guidePagePath(page.id);
  const currentTitle = normalizeTitle(title) || "제목 없음";

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={!loaded || isPending}
      onKeyDownCapture={handleSaveShortcut}
      onSubmit={(event) => {
        if (!loaded || !canSubmit || isPending || isEditorUploading || hasStaleDraftBase) {
          event.preventDefault();
          return;
        }
        const latestContentHtml = commitLatestContentHtml();
        if (!normalizeTitle(title)) {
          event.preventDefault();
          return;
        }
        submittedKeyRef.current = `${title}\u0000${latestContentHtml}`;
        if (contentHtmlInputRef.current) contentHtmlInputRef.current.value = latestContentHtml;
        const submittedDraft: CompactGuideEditDraft = {
          title,
          contentHtml: latestContentHtml,
          baseRevision,
          ...createDocumentEditDraftMetadata(baseFingerprintRef.current),
        };
        save(submittedDraft);
        flush();
        submittedDraftRef.current = submittedDraft;
        submittedDraftAliasesRef.current = createSubmittedDraftAliases({ title, contentHtml: latestContentHtml });
      }}
    >
      <input ref={contentHtmlInputRef} type="hidden" name="contentHtml" value={contentHtml} />
      <input type="hidden" name={GUIDE_BASE_REVISION_FIELD} value={baseRevision} />
      <input type="hidden" name={DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD} value={baseFingerprint} />

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
          disabled={!loaded}
          className={NOTE_TITLE_FIELD_CLASS}
        />
        <p className="text-ui text-muted-foreground">
          모든 학생이 같은 내용을 봅니다. 문단을 지워도 그 문단에 남은 질문은 &lsquo;위치가 바뀐 질문&rsquo;으로 남습니다.
        </p>
        {autosaveStatus === "error" ? (
          <AutosaveStatus status="error" message={autosaveMessage} onRetry={retrySave} />
        ) : null}
        {conflictRecovery}
        {loaded ? (
          <FullEditor
            initialContent={contentHtml}
            contentVersion={contentVersion}
            onUploadingChange={setIsEditorUploading}
            onChange={handleEditorChange}
            imageUploader={GUIDE_IMAGE_UPLOADER}
            preserveBlockIds
            onDirty={(reader) => {
              handleEditorDirty(reader);
              save({
                title,
                baseRevision,
                ...draftMetadata(),
                get contentHtml() {
                  return reader();
                },
              });
            }}
            placeholder="가이드 내용을 작성하세요... (/ 로 블록 삽입)"
            minHeight="50dvh"
            ariaLabel="가이드 내용"
            variant="page"
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
                quiet
              />
            }
            saveShortcutLabel={canSubmit ? "바로 저장" : undefined}
          />
        ) : null}
      </NoteDocumentBody>
    </form>
  );
}
