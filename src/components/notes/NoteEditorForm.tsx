"use client";

import { useCallback, useEffect, useId, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { CalendarDays, Clock3, UserRound } from "lucide-react";
import { AutosaveStatus } from "@/components/editor/AutosaveStatus";
import { CollabPresence } from "@/components/editor/CollabPresence";
import { CollabNotices } from "@/components/editor/CollabNotices";
import { createFullEditorExtensions } from "@/components/editor/FullEditor";
import { cn } from "@/lib/utils";
import {
  NOTE_TITLE_FIELD_CLASS,
  NoteDocumentBody,
  NoteProperties,
  NoteProperty,
} from "./NoteDocumentChrome";
import { isRichTextEmpty } from "@/lib/rich-text";
import { getPrivateNoteCollabSeed, getPrivateNoteHead, type CreateNoteState, type UpdateNoteState } from "@/lib/actions/privateNotes";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import { CREATION_OPERATION_FIELD, createCreationOperationId, deriveCreationResourceId, parseCreationOperationId } from "@/lib/creation-operation";
import { COLLAB_EPOCH_FIELD } from "@/lib/collab/protocol";
import { PRIVATE_NOTE_BASE_REVISION_FIELD } from "@/lib/private-note-continuity";
import { resolveNoteCreateDefaultDate } from "@/lib/note-create-route";
import { formatCollabDocKey } from "@/lib/collab/doc-key";
import { collabDocHtml } from "@/lib/collab/client/doc-html";
import { describeCollabStatus, isCollabEditorPending } from "@/lib/collab/client/collab-status";
import { COLLAB_META } from "@/lib/collab/client/seed";
import { useCollabAutosave, type CollabSaveResult } from "@/lib/collab/client/useCollabAutosave";
import { useCollabDocument } from "@/lib/collab/client/useCollabDocument";
import { useCollabLeaveGuard } from "@/lib/collab/client/useCollabLeaveGuard";
import { useCollabMetaField } from "@/lib/collab/client/useCollabMetaField";
import type { CollabTokenRequest } from "@/lib/collab/client/provider";
import { NoteDateField } from "./NoteDateField";
import { CollabEditorPending } from "@/components/editor/CollabEditorPending";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false, loading: () => <CollabEditorPending variant="page" /> },
);

/**
 * 새 노트를 제자리에서 만드는 설정. 첫 자동 저장이 노트를 만들면 같은 편집기가 그대로 수정 모드로 바뀌고,
 * 주소만 `history.replaceState`로 문서 주소가 된다(페이지 이동·편집기 remount 없음).
 * 공동 편집 room은 처음부터 생성 id(`deriveCreationResourceId`)로 정해 생성 전후 같은 room을 쓴다.
 */
export type NoteCreateConfig = {
  studentId: string;
  /** createPrivateNote.bind(null, studentId) */
  action: (previous: CreateNoteState, formData: FormData) => Promise<CreateNoteState>;
  /** 생성 뒤 같은 편집기가 이어서 쓰는 수정 action. */
  updateAction: (noteId: string, previous: UpdateNoteState, formData: FormData) => Promise<UpdateNoteState>;
  /** 캘린더 빠른 입력에서 넘어온 제목. */
  defaultTitle?: string;
  /** 캘린더에서 선택한 날짜. */
  defaultDate?: string;
  /** 생성 뒤 문서 주소에 붙일 돌아갈 화면. */
  returnTo: string;
};

type NoteEditorFormProps = {
  /** 기존 노트. 없으면 `create`로 새 노트를 만든다. */
  note?: {
    id: string;
    title: string;
    contentHtml: string;
    noteDate: Date | null;
    version?: number;
  };
  create?: NoteCreateConfig;
  actorId: string;
  /** 기존 노트의 수정 action(updatePrivateNote.bind). `note`가 있을 때 필요하다. */
  action?: (previous: UpdateNoteState, formData: FormData) => Promise<UpdateNoteState>;
  /** 새 노트를 만든 직후처럼 본문 끝에서 바로 이어 쓰게 한다. */
  focusBodyEnd?: boolean;
  /** 저장이 끝난 서버 값. 캘린더 패널처럼 바깥 목록이 제목·날짜를 맞출 때 쓴다. */
  onSaved?: (note: SavedNote) => void;
  /** 저장·이미지 업로드 중인지. 패널이 그동안 닫히지 않게 한다. */
  onBusyChange?: (busy: boolean) => void;
  /** 노트 문서 페이지 배치(NoteDoc·MobileNoteDoc·NoteNew 보드). 없으면 캘린더 패널 배치로 그린다. */
  document?: NoteDocumentLayout;
  /** 캘린더 상세 패널 배치(Calendar 보드 노트 패널). `document`가 없을 때만 쓴다. 없으면 지금 배치 그대로다. */
  panel?: NotePanelLayout;
};

/**
 * 캘린더 상세 패널 배치: 저장 상태를 패널 머리 왼쪽에 두고, 제목(24/32) 아래 날짜·작성자·수정 줄(88px 이름 칸)과
 * 구분선을 그린다. 작성자·수정 값이 없으면 그 줄을 생략한다. 저장 동작은 다른 배치와 같다.
 */
export type NotePanelLayout = {
  /** 저장 상태를 그릴 패널 머리 자리. null이면 본문 위에 그린다. */
  statusSlot: HTMLElement | null;
  authorName?: string | null;
  updatedLabel?: string | null;
};

/** 위쪽 막대가 받는 현재 문서 상태. `noteId`가 null이면 아직 만들지 않은 새 노트다. */
export type NoteDocumentBars = {
  status: ReactNode;
  title: string;
  noteId: string | null;
  version: number;
  /** 저장·업로드 중. 막대의 이동 링크를 잠글 때 쓴다. */
  busy: boolean;
};

/**
 * 문서 페이지는 위쪽 막대(넓은 화면 52px 줄·좁은 화면 셸 위쪽 막대)에 저장 상태를 두고, 제목 아래 속성 줄을 그린다.
 * 위쪽 막대 조작(변경 이력·더 보기)은 페이지가 `renderBars`로 정하고, 저장 상태와 현재 제목은 이 form이 넘긴다.
 */
export type NoteDocumentLayout = {
  authorName?: string | null;
  updatedLabel?: string | null;
  renderBars: (bars: NoteDocumentBars) => ReactNode;
};

export type SavedNote = {
  id: string;
  title: string;
  contentHtml: string;
  noteDate: Date | null;
  /** 서버가 기록한 수정 시각. revalidate 없이 "수정" 줄을 맞출 때 쓴다. */
  updatedAt?: Date | null;
};

/** 저장 스냅샷: 본문·칸·lifecycle을 같은 동기 구간에서 읽은 묶음(재시도에서도 바꾸지 않는다). */
type NoteSnapshot = { title: string; noteDate: string; contentHtml: string; lifecycle: number | null };

/** 저장 담당이 바뀌어도 이어지도록 room에 남기는 마지막 서버 version. */
const META_HEAD_VERSION = "headVersion";

function buildFormData(snapshot: NoteSnapshot, operationId: string, baseRevision?: number): FormData {
  const formData = new FormData();
  if (typeof snapshot.lifecycle === "number") formData.set(COLLAB_EPOCH_FIELD, String(snapshot.lifecycle));
  formData.set("title", snapshot.title);
  formData.set("noteDate", snapshot.noteDate);
  formData.set("contentHtml", snapshot.contentHtml);
  formData.set(CREATION_OPERATION_FIELD, operationId);
  if (baseRevision !== undefined) formData.set(PRIVATE_NOTE_BASE_REVISION_FIELD, String(baseRevision));
  return formData;
}

const NEW_NOTE_OPERATION_PREFIX = "portal-new-note-operation:";

function newNoteOperationKey(actorId: string, studentId: string): string {
  return `${NEW_NOTE_OPERATION_PREFIX}${actorId}:${studentId}`;
}

function readOrCreateNewNoteOperationId(actorId: string, studentId: string): string {
  if (typeof window === "undefined") return createCreationOperationId();
  try {
    const key = newNoteOperationKey(actorId, studentId);
    const stored = parseCreationOperationId(window.sessionStorage.getItem(key));
    if (stored) return stored;
    const created = createCreationOperationId();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return createCreationOperationId();
  }
}

function forgetNewNoteOperationId(actorId: string, studentId: string): void {
  try {
    window.sessionStorage.removeItem(newNoteOperationKey(actorId, studentId));
  } catch {
    // 저장소를 못 쓰면 다음 새 노트가 새 id를 만든다.
  }
}

function toDateInputValue(value: Date | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export function NoteEditorForm(props: NoteEditorFormProps) {
  // 생성→수정 전환은 내부 state로만 일어나므로 이 key는 그동안 바뀌지 않는다(편집기 remount 없음).
  return <NoteEditorFormContent key={`${props.actorId}:${props.note?.id ?? `new:${props.create?.studentId ?? ""}`}`} {...props} />;
}

function NoteEditorFormContent({ note, create, actorId, action, focusBodyEnd = false, onSaved, onBusyChange, document: documentLayout, panel: panelLayout }: NoteEditorFormProps) {
  const dateInputId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const onSavedRef = useRef(onSaved);
  const onBusyChangeRef = useRef(onBusyChange);
  useInsertionEffect(() => {
    onSavedRef.current = onSaved;
    onBusyChangeRef.current = onBusyChange;
  });

  // 새 노트의 생성 요청 id는 화면이 열려 있는 동안 하나다. room도 이 id에서 나온 노트 id로 정한다.
  // 첫 저장 전 새로고침해도 같은 작성본(room·기기 보관)으로 돌아오도록 이 탭의 sessionStorage에 둔다.
  const [createOperationId] = useState(() => (create ? readOrCreateNewNoteOperationId(actorId, create.studentId) : ""));
  const roomNoteId = useMemo(
    () =>
      note?.id ??
      (create ? deriveCreationResourceId(createOperationId, JSON.stringify(["private-note", actorId, create.studentId])) : ""),
    [actorId, create, createOperationId, note?.id],
  );
  const roomKey = roomNoteId ? formatCollabDocKey({ kind: "note", id: roomNoteId }) : null;
  const collabRequest = useMemo<CollabTokenRequest | null>(() => {
    if (!roomKey) return null;
    if (note) return { key: roomKey };
    return create ? { createNote: { operationId: createOperationId, studentId: create.studentId } } : null;
  }, [create, createOperationId, note, roomKey]);

  const initialDefaultDate = create ? resolveNoteCreateDefaultDate(create.defaultDate, new Date()) : "";
  const initialTitle = note?.title ?? create?.defaultTitle ?? "";
  const initialDate = note ? toDateInputValue(note.noteDate) : initialDefaultDate;
  const extensionsRef = useRef<ReturnType<typeof createFullEditorExtensions> | null>(null);
  const getExtensions = useCallback(() => {
    extensionsRef.current ??= createFullEditorExtensions();
    return extensionsRef.current;
  }, []);

  // 생성 모드는 첫 저장 성공 뒤 채워진다. 저장 callback은 같은 값을 ref로 즉시 읽는다.
  const [noteId, setNoteId] = useState<string | null>(note?.id ?? null);
  const noteIdRef = useRef(noteId);
  const [headVersion, setHeadVersion] = useState(note?.version ?? 1);
  const headVersionRef = useRef(headVersion);
  // 마지막으로 서버와 맞춘 칸 값. version 충돌 재시도에서 room 밖(캘린더 날짜 이동 등)에서 바뀐 칸을 덮지 않는 기준이다.
  const lastSavedRef = useRef<{ title: string; noteDate: string } | null>(
    note ? { title: note.title, noteDate: toDateInputValue(note.noteDate) } : null,
  );

  const collab = useCollabDocument({
    offlineWritable: true,
    request: collabRequest,
    storageKey: roomKey,
    ownerId: actorId,
    user: { name: "", colorIndex: 0 },
    extensions: getExtensions,
    getSeed: async (_reason, { online }) => {
      if (!roomKey) return null;
      const existingId = noteIdRef.current;
      if (existingId && online) {
        // 연결돼 있으면 서버의 최신 head를 lifecycle 표지와 함께 읽는다(복원 전 옛 head로 새 세대를 채우지 않게).
        const latest = await getPrivateNoteCollabSeed(existingId).catch(() => null);
        if (!latest) return null;
        if (latest.status !== "ok") {
          return { stop: latest.status === "trashed" ? "이 노트는 휴지통으로 이동했습니다." : "노트를 찾을 수 없거나 볼 권한이 없습니다." };
        }
        headVersionRef.current = latest.version;
        setHeadVersion(latest.version);
        lastSavedRef.current = { title: latest.title, noteDate: toDateInputValue(latest.noteDate) };
        return {
          key: roomKey,
          version: latest.version,
          lifecycle: latest.lifecycle,
          html: latest.contentHtml,
          fields: { title: latest.title, noteDate: toDateInputValue(latest.noteDate) },
        };
      }
      return {
        key: roomKey,
        version: note?.version ?? 0,
        html: note?.contentHtml ?? "",
        fields: { title: initialTitle, noteDate: initialDate },
      };
    },
  });
  const { doc, provider } = collab;
  const readLifecycle = collab.readLifecycle;
  const [title, setTitle] = useCollabMetaField(doc, "title", initialTitle);
  const [noteDate, setNoteDate] = useCollabMetaField(doc, "noteDate", initialDate);
  const readOnly = collab.mode === "read";

  // 다른 기기가 저장한 version을 따라간다(저장 담당이 바뀌어도 기준 version이 이어지게).
  useEffect(() => {
    if (!doc) return;
    const meta = doc.getMap(COLLAB_META);
    const sync = () => {
      const value = meta.get(META_HEAD_VERSION);
      if (typeof value === "number" && value > headVersionRef.current) {
        headVersionRef.current = value;
        setHeadVersion(value);
      }
    };
    sync();
    meta.observe(sync);
    return () => meta.unobserve(sync);
  }, [doc]);

  const [isEditorUploading, setIsEditorUploading] = useState(false);

  const readSnapshot = useCallback((): NoteSnapshot | null => {
    if (!doc || doc.isDestroyed) return null;
    const meta = doc.getMap(COLLAB_META);
    const currentTitle = typeof meta.get("title") === "string" ? (meta.get("title") as string) : "";
    const currentDate = typeof meta.get("noteDate") === "string" ? (meta.get("noteDate") as string) : "";
    const contentHtml = collabDocHtml(doc, getExtensions());
    if (!currentTitle.trim() || isRichTextEmpty(contentHtml)) return null;
    return { title: currentTitle.trim(), noteDate: currentDate, contentHtml, lifecycle: readLifecycle() };
  }, [doc, getExtensions, readLifecycle]);

  const publishHeadVersion = useCallback(
    (version: number) => {
      headVersionRef.current = version;
      setHeadVersion(version);
      if (doc && !doc.isDestroyed) {
        doc.transact(() => doc.getMap(COLLAB_META).set(META_HEAD_VERSION, version), "collab-autosave-meta");
      }
    },
    [doc],
  );

  const runUpdate = useCallback(
    async (targetId: string, snapshot: NoteSnapshot): Promise<CollabSaveResult> => {
      const submit = (formData: FormData) =>
        create ? create.updateAction(targetId, {}, formData) : action ? action({}, formData) : Promise.resolve<UpdateNoteState>({ error: "저장할 노트를 찾지 못했습니다." });
      // 스냅샷의 lifecycle은 재시도에서도 바꾸지 않는다(복원 전 내용이 새 세대로 저장되지 않게).
      let current = snapshot;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const state = await submit(buildFormData(current, createCreationOperationId(), headVersionRef.current));
        if (state.success) {
          lastSavedRef.current = { title: current.title, noteDate: current.noteDate };
          const version = state.note?.version ?? state.currentRevision ?? state.operationResultRevision ?? headVersionRef.current;
          publishHeadVersion(version);
          onSavedRef.current?.({
            id: targetId,
            title: state.note?.title ?? snapshot.title,
            contentHtml: state.note?.contentHtml ?? snapshot.contentHtml,
            noteDate: state.note?.noteDate ?? null,
            updatedAt: state.updatedAt ?? null,
          });
          return { ok: true };
        }
        // 복원 전 세대의 스냅샷이다. 다시 보내지 않고, 복원이 이 문서에 들어오면 새 스냅샷으로 저장한다(입력은 계속).
        if (state.collabStale) return { ok: false, deferred: true };
        if (state.conflictKind !== "VERSION_CONFLICT" || attempt > 0) {
          return { ok: false, error: state.error ?? "저장하지 못했습니다. 입력 내용은 이 기기와 실시간 문서에 남아 있습니다." };
        }
        // room 밖에서 바뀐 칸(캘린더 날짜 이동 등)은 덮지 않는다: 서버 값이 마지막 저장값과 다르고 내 값은 그대로면 서버 값을 따른다.
        const server = state.conflictNote;
        const base = lastSavedRef.current;
        if (server && base) {
          const serverDate = toDateInputValue(server.noteDate);
          const adopted = {
            title: server.title !== base.title && current.title === base.title ? server.title : current.title,
            noteDate: serverDate !== base.noteDate && current.noteDate === base.noteDate ? serverDate : current.noteDate,
          };
          if (adopted.title !== current.title || adopted.noteDate !== current.noteDate) {
            current = { ...current, ...adopted };
            if (doc && !doc.isDestroyed) {
              doc.transact(() => {
                const meta = doc.getMap(COLLAB_META);
                if (meta.get("title") === snapshot.title) meta.set("title", adopted.title);
                if (meta.get("noteDate") === snapshot.noteDate) meta.set("noteDate", adopted.noteDate);
              });
            }
          }
          lastSavedRef.current = { title: server.title, noteDate: serverDate };
        }
        // room 내용이 이미 합쳐진 결과다. 선택창 없이 서버 최신 version을 기준으로 한 번 더 저장한다.
        const latest =
          state.conflictNote?.version ?? state.currentRevision ?? (await getPrivateNoteHead(targetId).catch(() => null))?.version;
        if (typeof latest !== "number") {
          return { ok: false, error: state.error ?? "저장 기준을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
        }
        headVersionRef.current = latest;
      }
      return { ok: false, error: "저장하지 못했습니다." };
    },
    [action, create, doc, publishHeadVersion],
  );

  const saveSnapshot = useCallback(
    async (snapshot: NoteSnapshot): Promise<CollabSaveResult> => {
      const currentId = noteIdRef.current;
      if (currentId) return runUpdate(currentId, snapshot);
      if (!create) return { ok: false, error: "저장할 노트를 찾지 못했습니다. 페이지를 새로고침해 주세요." };
      const state = await create.action({}, buildFormData(snapshot, createOperationId, undefined));
      const createdId = state.note?.id ?? (state.operationConflict ? state.existingId : undefined);
      if (!createdId) {
        return { ok: false, error: state.error ?? "노트를 만들지 못했습니다. 입력 내용은 이 기기에 남아 있습니다." };
      }
      noteIdRef.current = createdId;
      setNoteId(createdId);
      forgetNewNoteOperationId(actorId, create.studentId);
      // state를 null로 넘겨야 Next가 내부 상태를 복사하고 router의 현재 주소(usePathname)도 함께 맞춘다.
      window.history.replaceState(null, "", `/dashboard/notes/${createdId}?returnTo=${encodeURIComponent(create.returnTo)}`);
      if (state.note) {
        publishHeadVersion(state.note.version);
        onSavedRef.current?.({
          id: createdId,
          title: state.note.title,
          contentHtml: state.note.contentHtml,
          noteDate: state.note.noteDate,
          updatedAt: state.note.createdAt,
        });
        // 생성 응답을 기다리는 동안 이어 쓴 내용은 다음 저장이 이어받는다.
        return { ok: true };
      }
      // 같은 생성 요청이 이미 다른 내용으로 처리됐다(응답 유실 뒤 이어 쓴 경우). 만들어진 노트에 지금 내용을 저장한다.
      const head = await getPrivateNoteHead(createdId).catch(() => null);
      if (head) headVersionRef.current = head.version;
      return runUpdate(createdId, snapshot);
    },
    [actorId, create, createOperationId, publishHeadVersion, runUpdate],
  );

  const writable = !readOnly && collab.ready && (collab.status === "connected" || collab.status === "solo");
  const autosave = useCollabAutosave({
    doc,
    // 복원·제자리 합치기가 끝날 때까지 자동 저장만 미룬다(입력은 계속 받는다).
    enabled: writable && !isEditorUploading && !collab.rebasing,
    isSaver: collab.isSaver,
    // room이 내용을 보관하면 D1 저장(이력)은 드물게 한다. 혼자 모드(room 없음)는 지금처럼 자주 저장한다.
    // 새 노트를 만드는 첫 저장은 미루지 않는다(주소·수업 메모가 노트 id에 달려 있다).
    roomBacked: collab.status !== "solo" && noteId !== null,
    readSnapshot,
    save: saveSnapshot,
    onSaved: (stateVector) => provider?.reportSaved(stateVector),
  });
  const hasUnsavedInput = (): boolean => {
    if (!doc || doc.isDestroyed) return false;
    const rawTitle = doc.getMap(COLLAB_META).get("title");
    return (typeof rawTitle === "string" && rawTitle.trim() !== "") || !isRichTextEmpty(collabDocHtml(doc, getExtensions()));
  };
  useCollabLeaveGuard(
    () =>
      autosave.hasPendingSave() ||
      collab.hasUnsentChanges() ||
      isEditorUploading ||
      // 제목이나 본문이 비어 저장을 기다리는 내용도 서버에는 아직 없다.
      (autosave.status === "blocked" && hasUnsavedInput()),
  );

  const busy = autosave.status === "saving" || isEditorUploading;
  useEffect(() => {
    onBusyChangeRef.current?.(busy);
  }, [busy]);
  useEffect(() => () => onBusyChangeRef.current?.(false), []);

  const statusView = describeCollabStatus({
    connection: collab.status,
    mode: collab.mode,
    isSaver: collab.isSaver,
    autosave: autosave.status,
    autosaveError: autosave.error,
    blockedMessage: "제목과 내용을 입력하면 자동으로 저장됩니다.",
  });
  const retrySave = autosave.retry;
  const handleSaveShortcut = useDocumentSaveShortcut({
    disabled: !writable,
    onSave: () => void autosave.flush(),
  });

  // 새 노트 화면은 실패 안내가 나타나면 긴 노트에서도 바로 보이게 초점을 옮긴다.
  useEffect(() => {
    if (!create || statusView.kind !== "error") return;
    const activeElement = document.activeElement;
    if (activeElement === document.body || formRef.current?.contains(activeElement)) {
      errorRef.current?.focus();
    }
  }, [create, statusView.kind]);

  const focusedBodyRef = useRef(false);
  useEffect(() => {
    if (!focusBodyEnd || !collab.ready || focusedBodyRef.current) return;
    // 편집기는 지연 로드되므로 나타날 때까지 짧게 기다린다.
    let attempts = 0;
    const timer = window.setInterval(() => {
      const body = formRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
      attempts += 1;
      if (!body && attempts < 40) return;
      window.clearInterval(timer);
      if (!body) return;
      focusedBodyRef.current = true;
      body.focus();
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const url = new URL(window.location.href);
      url.searchParams.delete("focus");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }, 50);
    return () => window.clearInterval(timer);
  }, [collab.ready, focusBodyEnd]);
  // 긴 제목도 잘리지 않게 내용 높이에 맞춘다(field-sizing을 지원하지 않는 브라우저 포함).
  // 폭이 바뀔 때(회전·창 크기)와 글꼴이 늦게 도착했을 때도 다시 잰다. 폭만 볼 때 다시 재므로 높이 변경으로 반복되지 않는다.
  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    const fit = () => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    };
    fit();
    let width = element.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fit();
    });
    observer?.observe(element);
    let cancelled = false;
    void document.fonts?.ready.then(() => { if (!cancelled) fit(); });
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [title]);

  const created = noteId !== null;
  // 권한이 없어졌으면(로그아웃·권한 회수)·휴지통이면 입력을 받지 않는다(보낼 곳이 없어 사라진다). 같은 편집기를 그 자리에서 잠근다.
  // 연결 중·오프라인·동기화 중에는 잠그지 않는다(이 기기에 쌓였다가 연결되면 전송된다).
  const denied = collab.status === "denied";
  const locked = readOnly || denied || collab.status === "trashed";
  const fieldsReady = collab.ready && !locked;
  const solo = collab.status === "solo";
  const collaboration = useMemo(
    () =>
      doc
        ? {
            doc,
            awareness: solo ? null : provider?.awareness ?? null,
            user: collab.user,
          }
        : undefined,
    // 커서 이름·색은 토큰 응답의 본인 정보다. 편집기 확장은 doc·awareness·본인 정보가 바뀔 때만 다시 만든다.
    [doc, provider, solo, collab.user],
  );

  const statusNode = (variant: "bar" | "inline") => (
    <AutosaveStatus
      variant={variant}
      status={statusView.kind}
      message={statusView.message}
      label={statusView.message}
      shortMessage={statusView.shortMessage}
      onRetry={variant === "inline" && autosave.status === "error" ? retrySave : undefined}
      alertRef={variant === "inline" ? errorRef : undefined}
      className={variant === "bar" ? "mr-1" : undefined}
    />
  );
  const presence = <CollabPresence awareness={solo ? null : provider?.awareness} />;

  const titleField = (
    <textarea
      ref={titleRef}
      name="title"
      aria-label="제목"
      value={title}
      rows={1}
      onChange={(event) => setTitle(event.target.value.replace(/\n/gu, " "))}
      onKeyDown={(event) => {
        // 제목에서 Enter는 줄바꿈 대신 본문으로 이동한다.
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        formRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
      }}
      required
      maxLength={200}
      placeholder="제목 없음"
      disabled={!fieldsReady}
      className={documentLayout
        ? NOTE_TITLE_FIELD_CLASS
        : cn(
          "w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-semibold text-foreground placeholder:text-faint focus:outline-none",
          panelLayout ? "text-2xl tracking-display" : "text-xl tracking-title",
        )}
    />
  );

  const dateField = (
    <NoteDateField
      id={dateInputId}
      name="noteDate"
      value={noteDate}
      onChange={setNoteDate}
      disabled={!fieldsReady}
    />
  );

  const editor = !isCollabEditorPending(collab) && collaboration ? (
    // 수업 도구(관리자)가 시점·트랙 줄을 넣을 곳으로 찾는다.
    <div data-lesson-target="note">
      <FullEditor
        collaboration={collaboration}
        disabled={locked}
        onUploadingChange={setIsEditorUploading}
        placeholder={create && !created
          ? "수업 내용, 연습 기록, 메모 등을 자유롭게 작성하세요..."
          : "수업 내용, 연습 기록, 메모를 이어서 작성하세요..."}
        minHeight={create ? "320px" : "50dvh"}
        ariaLabel="노트 내용"
        variant="page"
        saveShortcutLabel={writable ? "바로 저장" : undefined}
      />
    </div>
  ) : (
    <CollabEditorPending collab={collab} variant="page" minHeight={create ? "320px" : "50dvh"} label="노트를 불러오는 중…" />
  );

  const notices = <CollabNotices collab={collab} />;
  const errorAlert = (
    <>
      {statusView.kind === "error" ? statusNode("inline") : null}
      {notices}
    </>
  );

  return (
    <form
      ref={formRef}
      aria-busy={!collab.ready || busy}
      data-collab-status={collab.status}
      data-collab-saver={collab.isSaver ? "true" : "false"}
      data-autosave={autosave.status}
      className={cn(!documentLayout && "flex flex-col gap-5")}
      onKeyDownCapture={handleSaveShortcut}
      onBlurCapture={(event) => {
        // 편집기 밖(다른 메뉴·링크)으로 나가면 기다리던 저장을 바로 보낸다. 이동하기 전에 저장이 출발한다.
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        autosave.flushPending();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void autosave.flush();
      }}
    >
      {documentLayout ? (
        <>
          {documentLayout.renderBars({
            // 위쪽 막대는 짧은 상태만 보이고, 실패 이유와 다시 시도는 본문의 alert가 맡는다.
            status: (
              <span className="inline-flex min-w-0 items-center gap-3">
                {presence}
                {statusNode("bar")}
              </span>
            ),
            title: title.trim() || "제목 없음",
            noteId,
            version: headVersion,
            busy,
          })}
          <NoteDocumentBody>
            <h1 className="sr-only">{created ? "노트 편집" : "새 노트"}</h1>
            {titleField}
            <NoteProperties>
              <NoteProperty icon={CalendarDays} label="날짜" htmlFor={dateInputId} tall>{dateField}</NoteProperty>
              {documentLayout.authorName ? (
                <NoteProperty icon={UserRound} label="작성자">{documentLayout.authorName}</NoteProperty>
              ) : null}
              {documentLayout.updatedLabel ? (
                <NoteProperty icon={Clock3} label="수정">{documentLayout.updatedLabel}</NoteProperty>
              ) : null}
            </NoteProperties>
            {errorAlert}
            {editor}
          </NoteDocumentBody>
        </>
      ) : panelLayout ? (
        <>
          {/* 머리는 짧은 상태만 보이고, 실패 이유와 다시 시도는 본문의 alert가 맡는다(문서 배치와 같다). */}
          {panelLayout.statusSlot ? createPortal(
            <span className="inline-flex min-w-0 items-center gap-3">
              {statusNode("bar")}
              {presence}
            </span>,
            panelLayout.statusSlot,
          ) : (
            <div className="flex items-center justify-end gap-3">
              {presence}
              {statusNode("inline")}
            </div>
          )}
          <h1 className="sr-only">노트 편집</h1>
          {titleField}
          <div className="flex flex-col">
            <div className="flex min-h-11 items-center text-ui md:min-h-8">
              <label htmlFor={dateInputId} className="w-[88px] shrink-0 text-muted-foreground">날짜</label>
              <div className="min-w-0">{dateField}</div>
            </div>
            {panelLayout.authorName ? (
              <div className="flex min-h-8 items-center text-ui">
                <span className="w-[88px] shrink-0 text-muted-foreground">작성자</span>
                <span className="min-w-0 truncate">{panelLayout.authorName}</span>
              </div>
            ) : null}
            {panelLayout.updatedLabel ? (
              <div className="flex min-h-8 items-center text-ui">
                <span className="w-[88px] shrink-0 text-muted-foreground">수정</span>
                <span className="min-w-0 truncate">{panelLayout.updatedLabel}</span>
              </div>
            ) : null}
          </div>
          <div aria-hidden="true" className="h-px bg-muted" />
          {panelLayout.statusSlot ? errorAlert : notices}
          {editor}
        </>
      ) : (
        <>
          <div className="flex items-center justify-end gap-3">
            {presence}
            {statusNode("inline")}
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="sr-only">{created ? "노트 편집" : "새 노트"}</h1>
            {titleField}
            <div className="flex items-center gap-3">
              <label htmlFor={dateInputId} className="inline-flex items-center gap-2 text-ui text-muted-foreground">
                <CalendarDays className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                날짜
              </label>
              {dateField}
            </div>
          </div>

          {notices}
          {editor}
        </>
      )}
    </form>
  );
}
