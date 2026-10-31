"use client";

import { useActionState, useCallback, useEffect, useId, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { CalendarDays, Clock3, UserRound } from "lucide-react";
import { AutosaveStatus } from "@/components/editor/AutosaveStatus";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { DraftConflictRecovery } from "@/components/editor/DraftConflictRecovery";
import { CreationConflictActions } from "@/components/editor/CreationConflictActions";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { cn } from "@/lib/utils";
import {
  NOTE_TITLE_FIELD_CLASS,
  NoteDocumentBody,
  NoteProperties,
  NoteProperty,
} from "./NoteDocumentChrome";
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import type { CreateNoteState, UpdateNoteState } from "@/lib/actions/privateNotes";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { useDocumentAutosave } from "@/lib/hooks/useDocumentAutosave";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import {
  CREATION_OPERATION_FIELD,
  createCreationOperationId,
  parseCreationOperationId,
} from "@/lib/creation-operation";
import {
  PRIVATE_NOTE_BASE_REVISION_FIELD,
  parsePrivateNoteRevision,
} from "@/lib/private-note-continuity";
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
import {
  isCreateNoteDraftEmpty,
  resolveRestoredCreateNoteDate,
} from "@/lib/note-draft";
import { resolveNoteCreateDefaultDate } from "@/lib/note-create-route";
import { NoteDateField } from "./NoteDateField";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

/**
 * 새 노트를 제자리에서 만드는 설정. 첫 자동 저장이 노트를 만들면 같은 편집기가 그대로 수정 모드로 바뀌고,
 * 주소만 `history.replaceState`로 문서 주소가 된다(페이지 이동·편집기 remount 없음).
 */
export type NoteCreateConfig = {
  studentId: string;
  /** createPrivateNote.bind(null, studentId) */
  action: (previous: CreateNoteState, formData: FormData) => Promise<CreateNoteState>;
  /** 생성 뒤 같은 편집기가 이어서 쓰는 수정 action. */
  updateAction: (noteId: string, previous: UpdateNoteState, formData: FormData) => Promise<UpdateNoteState>;
  /** 캘린더 빠른 입력에서 넘어온 제목. 복구된 초안에 제목이 있으면 그 제목이 우선한다. */
  defaultTitle?: string;
  /** 캘린더에서 선택한 날짜. 복구된 초안이 있으면 그 날짜가 우선한다. */
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
 * 구분선을 그린다. 작성자·수정 값이 없으면 그 줄을 생략한다. 저장 동작·초안·충돌 처리는 다른 배치와 같다.
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
 * 작성자·수정 값이 없으면 그 속성 줄을 생략한다.
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

type NoteEditSnapshot = {
  title: string;
  noteDate: string;
  contentHtml: string;
};

/** 마지막으로 확인한 서버 head(서버가 정리한 HTML·version). fingerprint·충돌 비교의 기준이다. */
type NoteHead = NoteEditSnapshot & { version: number };

type NoteOperationDraftFields = {
  operationId?: string;
  baseRevision?: number;
};

type NoteEditDraft = NoteEditSnapshot &
  DocumentEditDraftBaseFields &
  NoteOperationDraftFields;
type CompactNoteEditDraft = NoteEditSnapshot &
  CompactDocumentEditDraftMetadata &
  NoteOperationDraftFields;
/** 생성 전 `new:` 초안은 기준 revision·fingerprint 없이 저장한다. */
type NoteCreateDraft = NoteEditSnapshot & { operationId?: string };

/** 생성·수정 응답을 한 form state로 다룬다. 생성 전용 필드(OPERATION_PAYLOAD_CONFLICT)는 생성 모드에서만 온다. */
type NoteFormState = UpdateNoteState & {
  operationConflict?: boolean;
  conflictedOperationId?: string;
  existingId?: string;
  note?: NonNullable<UpdateNoteState["note"]> & { createdAt?: Date | null };
};

type ConflictServerState = {
  snapshot: NoteEditSnapshot;
  version: number;
};

function toDateInputValue(value: Date | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

function pickSnapshot(snapshot: NoteEditSnapshot): NoteEditSnapshot {
  return { title: snapshot.title, noteDate: snapshot.noteDate, contentHtml: snapshot.contentHtml };
}

/** 서버는 제목 앞뒤 공백을 지운다. 입력 중인 띄어쓰기를 저장 차이로 보지 않는다. */
function sameSnapshot(a: NoteEditSnapshot, b: NoteEditSnapshot): boolean {
  return a.title.trim() === b.title.trim() && a.noteDate === b.noteDate && a.contentHtml === b.contentHtml;
}

function toRemoteSnapshot(remote: NoteEditDraft): NoteEditSnapshot {
  return {
    title: typeof remote.title === "string" ? remote.title : "",
    noteDate: typeof remote.noteDate === "string" ? remote.noteDate : "",
    contentHtml: typeof remote.contentHtml === "string" ? remote.contentHtml : "",
  };
}

export function NoteEditorForm(props: NoteEditorFormProps) {
  // 생성→수정 전환은 내부 state로만 일어나므로 이 key는 그동안 바뀌지 않는다(편집기 remount 없음).
  return <NoteEditorFormContent key={`${props.actorId}:${props.note?.id ?? `new:${props.create?.studentId ?? ""}`}`} {...props} />;
}

function NoteEditorFormContent({ note, create, actorId, action, focusBodyEnd = false, onSaved, onBusyChange, document: documentLayout, panel: panelLayout }: NoteEditorFormProps) {
  const dateInputId = useId();
  const initialDefaultDate = create ? resolveNoteCreateDefaultDate(create.defaultDate, new Date()) : "";
  const initialHead: NoteHead | null = note
    ? { title: note.title, noteDate: toDateInputValue(note.noteDate), contentHtml: note.contentHtml, version: note.version ?? 1 }
    : null;
  // 생성 모드는 첫 저장 성공 뒤 채워진다. effect·callback은 같은 값을 ref로 즉시 읽는다.
  const [noteId, setNoteId] = useState<string | null>(note?.id ?? null);
  const noteIdRef = useRef(noteId);
  const [title, setTitle] = useState(note?.title ?? create?.defaultTitle ?? "");
  const [noteDate, setNoteDate] = useState(note ? toDateInputValue(note.noteDate) : initialDefaultDate);
  const {
    contentHtml,
    contentVersion,
    setContentHtml,
    handleEditorChange,
    handleEditorDirty,
    readLatestContentHtml,
    commitLatestContentHtml,
  } = useDeferredEditorContent(note?.contentHtml ?? "");
  const [hasStaleDraftBase, setHasStaleDraftBase] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [baseRevision, setBaseRevision] = useState(initialHead?.version ?? 1);
  const defaultNoteDateRef = useRef(initialDefaultDate);
  // 주소에서 받은 기본 제목이 지금 화면의 출발점인지. 복원한 초안의 제목은 기본값으로 보지 않는다.
  const defaultTitleRef = useRef("");
  const [state, formAction, isPending] = useActionState<NoteFormState, FormData>(async (previous, data) => {
    try {
      const currentNoteId = noteIdRef.current;
      if (currentNoteId && create) return await create.updateAction(currentNoteId, previous, data);
      if (currentNoteId && action) return await action(previous, data);
      // 서버 action은 이전 state를 읽지 않는다. 생성 응답 note 형식(createdAt·version 필수)에 맞춰 수정 응답 note는 뺀다.
      if (create) return await create.action({ ...previous, note: undefined }, data);
      return { error: "저장할 노트를 찾지 못했습니다. 페이지를 새로고침해 주세요." };
    } catch {
      return { error: "저장 결과를 확인하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요." };
    }
  }, {});
  useBusyNavigationGuard(isPending);
  const onSavedRef = useRef(onSaved);
  const onBusyChangeRef = useRef(onBusyChange);
  useInsertionEffect(() => {
    onSavedRef.current = onSaved;
    onBusyChangeRef.current = onBusyChange;
  });
  // 본문 이미지가 올라가는 동안에는 이미지 없는 본문을 저장하지 않는다.
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  // 패널처럼 바깥에서 닫힐 수 있는 곳은 저장·업로드가 끝날 때까지 닫지 않게 알린다.
  const busy = isPending || isEditorUploading;
  useEffect(() => {
    onBusyChangeRef.current?.(busy);
  }, [busy]);
  useEffect(() => () => onBusyChangeRef.current?.(false), []);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const contentHtmlInputRef = useRef<HTMLInputElement>(null);
  const handledSavedNoteRef = useRef<NoteFormState["note"]>(undefined);
  const handledConflictNoteRef = useRef<NoteFormState["conflictNote"]>(undefined);
  const [conflictServer, setConflictServer] = useState<ConflictServerState | null>(null);
  const submittedDraftRef = useRef<CompactNoteEditDraft | NoteCreateDraft | null>(null);
  const submittedDraftAliasesRef = useRef<readonly NoteEditDraft[] | null>(null);
  const restoredDraftRef = useRef<NoteEditDraft | null>(null);
  // 생성 성공으로 초안 key가 `new:`에서 노트 id로 바뀌는 동안 true. 그동안 초안 hook의 복원·초기화는 화면 값을 건드리지 않는다.
  const keyTransitionRef = useRef(false);
  // 마지막 저장의 편집기 측 snapshot. dirty 판정 기준이라 서버가 HTML을 정리해도 입력이 없으면 저장을 반복하지 않는다.
  const [savedSnapshot, setSavedSnapshot] = useState<NoteEditSnapshot | null>(initialHead ? pickSnapshot(initialHead) : null);
  const savedSnapshotRef = useRef(savedSnapshot);
  // 마지막으로 확인한 서버 head. 서버가 정리한 HTML·version이라 fingerprint와 충돌 비교는 이 값을 쓴다.
  const [head, setHead] = useState<NoteHead | null>(initialHead);
  const headRef = useRef(head);
  const [baseFingerprint, setBaseFingerprint] = useState(() =>
    note && initialHead
      ? createDocumentSnapshotFingerprint({
          kind: "private-note",
          id: note.id,
          title: initialHead.title,
          contentHtml: initialHead.contentHtml,
          noteDate: initialHead.noteDate,
        })
      : "",
  );
  const baseFingerprintRef = useRef(baseFingerprint);
  const draftBaseFingerprintRef = useRef(baseFingerprint);
  /** 저장 기준을 둘로 나눠 맞춘다: dirty 비교는 편집기 측 snapshot, fingerprint는 서버가 돌려준 head. */
  const adoptSavedSnapshot = useCallback(
    (snapshot: NoteEditSnapshot, serverHead: NoteHead) => {
      const nextSavedSnapshot = pickSnapshot(snapshot);
      savedSnapshotRef.current = nextSavedSnapshot;
      setSavedSnapshot(nextSavedSnapshot);
      headRef.current = serverHead;
      setHead(serverHead);
      const id = noteIdRef.current;
      if (!id) return;
      const fingerprint = createDocumentSnapshotFingerprint({
        kind: "private-note",
        id,
        title: serverHead.title,
        contentHtml: serverHead.contentHtml,
        noteDate: serverHead.noteDate,
      });
      baseFingerprintRef.current = fingerprint;
      setBaseFingerprint(fingerprint);
    },
    [],
  );
  const serverVersion = note?.version ?? 1;
  // 바깥에서 들어오는 서버 prop(수정 모드). 생성 모드는 prop이 없어 head만 쓴다.
  const serverSnapshot = useMemo<NoteHead | null>(
    () => note
      ? {
          title: note.title,
          noteDate: toDateInputValue(note.noteDate),
          contentHtml: note.contentHtml,
          version: serverVersion,
        }
      : null,
    [note, serverVersion],
  );
  const previousServerSnapshotRef = useRef(serverSnapshot);
  const createSubmittedDraftAliases = useCallback(
    (snapshot: NoteEditSnapshot): readonly NoteEditDraft[] => {
      const aliases: NoteEditDraft[] = [
        { ...snapshot },
        { ...snapshot, base: { ...(savedSnapshotRef.current ?? snapshot) } },
      ];
      const restoredDraft = restoredDraftRef.current;
      if (
        restoredDraft &&
        restoredDraft.title === snapshot.title &&
        restoredDraft.noteDate === snapshot.noteDate &&
        restoredDraft.contentHtml === snapshot.contentHtml
      ) {
        aliases.push(restoredDraft);
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
  } = useSyncedFormDraft<NoteEditDraft>(
    createDocumentDraftKey("note", actorId, noteId ?? `new:${create?.studentId ?? ""}`),
    (draft) => {
      if (keyTransitionRef.current) {
        // 생성→수정 key 전환: 쓰던 화면 값은 그대로 두고 요청 메타만 새로 만든다.
        restoredDraftRef.current = null;
        setOperationId(createCreationOperationId());
        return;
      }
      const currentHead = headRef.current;
      if (!currentHead) {
        // 생성 전 `new:` 초안 복원.
        restoredDraftRef.current = null;
        setOperationId(parseCreationOperationId(draft.operationId) ?? createCreationOperationId());
        defaultTitleRef.current = "";
        setTitle(draft.title ?? "");
        setNoteDate(resolveRestoredCreateNoteDate(draft.noteDate, defaultNoteDateRef.current));
        setContentHtml(draft.contentHtml ?? "");
        return;
      }
      restoredDraftRef.current = draft;
      setOperationId(
        parseCreationOperationId(draft.operationId) ??
          createCreationOperationId(),
      );
      setBaseRevision(
        parsePrivateNoteRevision(draft.baseRevision) ?? currentHead.version,
      );
      const restoredSnapshot = {
        title: draft.title ?? currentHead.title,
        noteDate: draft.noteDate ?? currentHead.noteDate,
        contentHtml: draft.contentHtml ?? currentHead.contentHtml,
      };
      // 서버 HTML과 같거나, 마지막 저장의 편집기 HTML과 같으면 현재 서버본과 같은 내용이다.
      const lastSaved = savedSnapshotRef.current;
      const draftMatchesCurrentServer =
        (restoredSnapshot.title === currentHead.title &&
          restoredSnapshot.noteDate === currentHead.noteDate &&
          restoredSnapshot.contentHtml === currentHead.contentHtml) ||
        (lastSaved !== null &&
          restoredSnapshot.title === lastSaved.title &&
          restoredSnapshot.noteDate === lastSaved.noteDate &&
          restoredSnapshot.contentHtml === lastSaved.contentHtml);
      const resolvedBase = resolveDocumentEditDraftBase(
        draft,
        {
          kind: "private-note",
          id: noteIdRef.current ?? "",
          title: currentHead.title,
          noteDate: currentHead.noteDate,
          contentHtml: currentHead.contentHtml,
        },
        draftMatchesCurrentServer,
      );
      draftBaseFingerprintRef.current = resolvedBase.draftBaseFingerprint;
      setHasStaleDraftBase(resolvedBase.hasStaleDraftBase);
      if (!resolvedBase.hasStaleDraftBase) {
        adoptSavedSnapshot(currentHead, currentHead);
      }
      setTitle(restoredSnapshot.title);
      setNoteDate(restoredSnapshot.noteDate);
      setContentHtml(restoredSnapshot.contentHtml);
    },
    {
      onReset: () => {
        restoredDraftRef.current = null;
        setOperationId(createCreationOperationId());
        // 생성→수정 key 전환: 기준 revision·fingerprint는 생성 성공 처리가 이미 맞췄다.
        if (keyTransitionRef.current) return;
        const currentHead = headRef.current;
        if (!currentHead) {
          // 저장된 초안이 없을 때도 이 경로로 시작하므로 주소의 제목·날짜를 기본값으로 둔다.
          defaultNoteDateRef.current = initialDefaultDate;
          defaultTitleRef.current = create?.defaultTitle ?? "";
          setTitle(create?.defaultTitle ?? "");
          setNoteDate(initialDefaultDate);
          setContentHtml("");
          return;
        }
        setBaseRevision(currentHead.version);
        adoptSavedSnapshot(currentHead, currentHead);
        draftBaseFingerprintRef.current = baseFingerprintRef.current;
        setHasStaleDraftBase(false);
        setTitle(currentHead.title);
        setNoteDate(currentHead.noteDate);
        setContentHtml(currentHead.contentHtml);
      },
      server: {
        // 입력마다 바뀌는 operationId는 기기 간 같은 내용을 다르게 보이게 하므로 비교에서 뺀다.
        volatileKeys: ["operationId"],
        // head가 있는 수정 모드에서만: 마지막 저장과 같거나 head보다 오래된 기준의 서버본은 조용히 폐기한다.
        classifyRemoteDraft: noteId
          ? (remote) => {
              const remoteSnapshot = toRemoteSnapshot(remote);
              const lastSaved = savedSnapshotRef.current;
              const currentHead = headRef.current;
              if (lastSaved && sameSnapshot(remoteSnapshot, lastSaved)) return "discard";
              if (currentHead && sameSnapshot(remoteSnapshot, currentHead)) return "discard";
              if (
                currentHead &&
                typeof remote.baseRevision === "number" &&
                remote.baseRevision < currentHead.version
              ) {
                return "discard";
              }
              return "keep";
            }
          : undefined,
      },
    },
  );

  // key 전환이 끝나(새 key가 복원됨) 다시 loaded가 되면 전환 guard를 푼다.
  useEffect(() => {
    if (loaded) keyTransitionRef.current = false;
  }, [loaded]);

  const handleSaveShortcut = useDocumentSaveShortcut({
    disabled:
      !loaded || !canSubmit || isPending || hasStaleDraftBase || !operationId,
    onSave: () => formRef.current?.requestSubmit(),
  });

  const buildEditDraft = useCallback(
    (nextOperationId: string, reader: () => string): NoteEditDraft => ({
      title,
      noteDate,
      operationId: nextOperationId,
      baseRevision,
      ...createDocumentEditDraftMetadata(
        hasStaleDraftBase
          ? draftBaseFingerprintRef.current
          : baseFingerprintRef.current,
      ),
      get contentHtml() {
        return reader();
      },
    }),
    [baseRevision, hasStaleDraftBase, noteDate, title],
  );

  useEffect(() => {
    if (!loaded) return;
    const latestContentHtml = readLatestContentHtml();
    if (!noteId) {
      // 생성 전: 기본값뿐인 화면은 초안으로 남기지 않는다.
      if (
        isCreateNoteDraftEmpty(
          { title, noteDate, contentHtml: latestContentHtml },
          defaultNoteDateRef.current,
          defaultTitleRef.current,
        )
      ) {
        clear();
        return;
      }
      if (!operationId) return;
      save({
        operationId,
        title,
        noteDate,
        get contentHtml() {
          return readLatestContentHtml();
        },
      });
      return;
    }
    const lastSaved = savedSnapshotRef.current;
    const matchesSaved =
      lastSaved !== null &&
      title === lastSaved.title &&
      noteDate === lastSaved.noteDate &&
      latestContentHtml === lastSaved.contentHtml;
    if (!hasStaleDraftBase && matchesSaved) {
      restoredDraftRef.current = null;
      clear();
      return;
    }
    save(buildEditDraft(operationId, readLatestContentHtml));
  }, [
    buildEditDraft,
    clear,
    contentHtml,
    hasStaleDraftBase,
    loaded,
    noteDate,
    noteId,
    operationId,
    readLatestContentHtml,
    save,
    title,
  ]);

  useEffect(() => {
    if (!loaded || !serverSnapshot) return;
    const previousServer = previousServerSnapshotRef.current;
    const serverChanged =
      !previousServer ||
      previousServer.title !== serverSnapshot.title ||
      previousServer.noteDate !== serverSnapshot.noteDate ||
      previousServer.contentHtml !== serverSnapshot.contentHtml ||
      previousServer.version !== serverSnapshot.version;
    if (!serverChanged) return;

    previousServerSnapshotRef.current = serverSnapshot;
    if (serverSnapshot.version < Math.max(baseRevision, conflictServer?.version ?? 0)) return;
    // 방금 자동 저장한 내용이 화면 갱신으로 돌아온 것이면 이어서 쓴 내용과의 충돌이 아니다.
    // 편집기 HTML과 서버가 정리한 HTML이 달라도 마지막 head(서버 HTML)와 같으면 자기 저장이다.
    const submitted = submittedDraftRef.current;
    const currentHead = headRef.current;
    const ownSave =
      (submitted && sameSnapshot(submitted, serverSnapshot)) ||
      (currentHead && sameSnapshot(currentHead, serverSnapshot) && currentHead.version === serverSnapshot.version) ||
      (state.success && state.note && sameSnapshot({
        title: state.note.title,
        noteDate: toDateInputValue(state.note.noteDate),
        contentHtml: state.note.contentHtml,
      }, serverSnapshot)) ||
      // 저장 응답을 기다리는 동안 들어온 서버 값은 응답(성공·version 충돌)이 판정한다.
      isPending;
    if (ownSave) return;
    setConflictServer(null);
    // React 표시값은 editor보다 최대 200ms 늦을 수 있으므로 충돌 판정은 최신 reader를 사용한다.
    const latestContentHtml = readLatestContentHtml();
    const localMatchesPrevious =
      previousServer !== null &&
      title === previousServer.title &&
      noteDate === previousServer.noteDate &&
      latestContentHtml === previousServer.contentHtml;
    const localMatchesCurrent =
      title === serverSnapshot.title &&
      noteDate === serverSnapshot.noteDate &&
      latestContentHtml === serverSnapshot.contentHtml;
    // 자기 저장 뒤에는 prop이 head보다 뒤처지므로 "마지막 저장 이후 입력 없음"은 마지막 저장(편집기 HTML)·head(서버 HTML)로도 본다.
    const lastSaved = savedSnapshotRef.current;
    const localMatchesLastSaved =
      (lastSaved !== null &&
        title === lastSaved.title &&
        noteDate === lastSaved.noteDate &&
        latestContentHtml === lastSaved.contentHtml) ||
      (currentHead !== null &&
        title === currentHead.title &&
        noteDate === currentHead.noteDate &&
        latestContentHtml === currentHead.contentHtml);

    if (localMatchesCurrent || (!hasStaleDraftBase && (localMatchesPrevious || localMatchesLastSaved))) {
      restoredDraftRef.current = null;
      clear();
      adoptSavedSnapshot(serverSnapshot, serverSnapshot);
      setBaseRevision(serverSnapshot.version);
      draftBaseFingerprintRef.current = baseFingerprintRef.current;
      setTitle(serverSnapshot.title);
      setNoteDate(serverSnapshot.noteDate);
      setContentHtml(serverSnapshot.contentHtml);
      setHasStaleDraftBase(false);
      return;
    }

    if (!hasStaleDraftBase) {
      draftBaseFingerprintRef.current = baseFingerprintRef.current;
    }
    setHasStaleDraftBase(true);
  }, [
    adoptSavedSnapshot,
    baseRevision,
    clear,
    conflictServer,
    hasStaleDraftBase,
    isPending,
    loaded,
    noteDate,
    readLatestContentHtml,
    serverSnapshot,
    setContentHtml,
    state.note,
    state.success,
    title,
  ]);

  useEffect(() => {
    if (
      !state.conflictNote ||
      handledConflictNoteRef.current === state.conflictNote
    ) {
      return;
    }
    handledConflictNoteRef.current = state.conflictNote;
    setConflictServer({
      snapshot: {
        title: state.conflictNote.title,
        noteDate: toDateInputValue(state.conflictNote.noteDate),
        contentHtml: state.conflictNote.contentHtml,
      },
      version: state.conflictNote.version,
    });
    if (!hasStaleDraftBase) {
      draftBaseFingerprintRef.current = baseFingerprintRef.current;
    }
    setHasStaleDraftBase(true);
  }, [hasStaleDraftBase, state.conflictNote]);

  useEffect(() => {
    if (
      !state.success ||
      !state.note?.id ||
      handledSavedNoteRef.current === state.note
    ) {
      return;
    }
    handledSavedNoteRef.current = state.note;
    const savedNote = state.note;
    const wasCreate = noteIdRef.current === null;
    const submitted = submittedDraftRef.current;
    // 저장 기준은 제출한 편집기 측 snapshot이다. 서버가 돌려준 HTML로 편집기를 다시 채우지 않아 커서·undo가 남는다.
    const submittedSnapshot: NoteEditSnapshot = submitted
      ? pickSnapshot(submitted)
      : { title, noteDate, contentHtml: readLatestContentHtml() };
    const serverHead: NoteHead = {
      title: savedNote.title,
      noteDate: toDateInputValue(savedNote.noteDate),
      contentHtml: savedNote.contentHtml,
      version: savedNote.version ?? state.currentRevision ?? baseRevision,
    };
    onSavedRef.current?.({
      id: savedNote.id,
      title: savedNote.title,
      contentHtml: savedNote.contentHtml,
      noteDate: savedNote.noteDate,
      updatedAt: state.updatedAt ?? savedNote.createdAt ?? null,
    });
    if (wasCreate) {
      // 생성 대기 중 이어 쓴 내용은 만들어진 노트가 이어받으므로, 그 내용의 `new:` 초안도 함께 정리한다.
      clear({
        reason: "submitted",
        submittedData: submitted ?? { operationId, ...submittedSnapshot },
        submittedAliases: [{ operationId, title, noteDate, contentHtml: readLatestContentHtml() }],
      });
    } else {
      clear({
        reason: "submitted",
        submittedData: submitted ?? {
          ...submittedSnapshot,
          ...createDocumentEditDraftMetadata(baseFingerprintRef.current),
        },
        submittedAliases:
          submittedDraftAliasesRef.current ??
          createSubmittedDraftAliases(submittedSnapshot),
      });
    }
    submittedDraftRef.current = null;
    submittedDraftAliasesRef.current = null;
    restoredDraftRef.current = null;
    setConflictServer(null);
    if (wasCreate) {
      // 같은 편집기를 수정 모드로 바꾼다. 초안 key가 바뀌는 동안 화면 값은 건드리지 않는다.
      noteIdRef.current = savedNote.id;
      keyTransitionRef.current = true;
      setNoteId(savedNote.id);
      if (create) {
        // state를 null로 넘겨야 Next가 내부 상태를 복사하고 router의 현재 주소(usePathname)도 함께 맞춘다.
        // Next 내부 state(__NA)를 그대로 넘기면 router 주소가 작성 화면에 남아 다음 상태 변경 때 주소가 되돌아간다.
        const url = `/dashboard/notes/${savedNote.id}?returnTo=${encodeURIComponent(create.returnTo)}`;
        window.history.replaceState(null, "", url);
      }
    }
    adoptSavedSnapshot(submittedSnapshot, serverHead);
    setBaseRevision(serverHead.version);
    setOperationId(createCreationOperationId());
    draftBaseFingerprintRef.current = baseFingerprintRef.current;
    setHasStaleDraftBase(false);
  }, [
    adoptSavedSnapshot,
    baseRevision,
    clear,
    create,
    createSubmittedDraftAliases,
    noteDate,
    operationId,
    readLatestContentHtml,
    state.currentRevision,
    state.note,
    state.success,
    state.updatedAt,
    title,
  ]);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const focusedBodyRef = useRef(false);
  useEffect(() => {
    if (!focusBodyEnd || !loaded || focusedBodyRef.current) return;
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
  }, [focusBodyEnd, loaded]);
  // 긴 제목도 잘리지 않게 내용 높이에 맞춘다(field-sizing을 지원하지 않는 브라우저 포함).
  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [title]);
  const created = noteId !== null;
  const dirty = loaded && (
    !created || savedSnapshot === null || !sameSnapshot(savedSnapshot, { title, noteDate, contentHtml })
  );
  const changeKey = `${title}\u0000${noteDate}\u0000${contentHtml}`;
  const submittedKeyRef = useRef("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(() => {
    if (state.error) setFailedKey(submittedKeyRef.current);
    else if (state.success) setFailedKey(null);
  }, [state]);
  const hasOperationConflict = Boolean(
    !created &&
    state.operationConflict &&
    state.conflictedOperationId === operationId &&
    state.existingId,
  );
  const missingRequired = !title.trim() || isRichTextEmpty(contentHtml);
  const autosaveReady =
    loaded && canSubmit && !isPending && !hasStaleDraftBase && Boolean(operationId) && !missingRequired && !hasOperationConflict;
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
        : "제목과 내용을 입력하면 자동으로 저장됩니다.";
  const retrySave = () => formRef.current?.requestSubmit();

  // 새 노트 화면은 실패 안내가 나타나면 긴 노트에서도 바로 보이게 초점을 옮긴다. 사용자가 폼 밖으로 옮긴 초점은 두고 간다.
  useEffect(() => {
    if (!create || autosaveStatus !== "error") return;
    const activeElement = document.activeElement;
    if (activeElement === document.body || formRef.current?.contains(activeElement)) {
      errorRef.current?.focus();
    }
  }, [autosaveStatus, create, state]);

  // 충돌 복구의 서버 기준: 충돌 응답이 있으면 그 값, 없으면 마지막으로 확인한 head.
  const latestServer: ConflictServerState | null = conflictServer ?? (head ? { snapshot: pickSnapshot(head), version: head.version } : null);
  const conflictRecovery = hasStaleDraftBase && latestServer ? (
    <div className="flex flex-col gap-3">
      <DraftConflictRecovery
        documentLabel="노트"
        onUseServer={() => {
          const nextHead: NoteHead = { ...latestServer.snapshot, version: latestServer.version };
          restoredDraftRef.current = null;
          clear();
          adoptSavedSnapshot(nextHead, nextHead);
          setBaseRevision(nextHead.version);
          setOperationId(createCreationOperationId());
          draftBaseFingerprintRef.current = baseFingerprintRef.current;
          setTitle(nextHead.title);
          setNoteDate(nextHead.noteDate);
          setContentHtml(nextHead.contentHtml);
          setConflictServer(null);
          setHasStaleDraftBase(false);
          formRef.current?.querySelector<HTMLTextAreaElement>('textarea[name="title"]')?.focus();
        }}
        onKeepDraft={() => {
          const nextHead: NoteHead = { ...latestServer.snapshot, version: latestServer.version };
          adoptSavedSnapshot(nextHead, nextHead);
          setBaseRevision(nextHead.version);
          setOperationId(createCreationOperationId());
          draftBaseFingerprintRef.current = baseFingerprintRef.current;
          setConflictServer(null);
          setHasStaleDraftBase(false);
          formRef.current?.querySelector<HTMLTextAreaElement>('textarea[name="title"]')?.focus();
        }}
      />
      <details className="group rounded-lg border border-border">
        <summary className="cursor-pointer rounded-lg px-4 py-3 text-ui font-medium text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          서버 최신본 {latestServer.version}번 확인·복사
        </summary>
        <div className="flex flex-col gap-2 border-t border-muted px-4 py-3.5">
          <p className="font-medium">
            {latestServer.snapshot.title}
          </p>
          <RichTextContent
            html={latestServer.snapshot.contentHtml}
            className="text-body"
          />
        </div>
      </details>
    </div>
  ) : null;

  const creationConflict = hasOperationConflict && create && state.existingId ? (
    <CreationConflictActions
      existingHref={`/dashboard/notes/${state.existingId}?returnTo=${encodeURIComponent(create.returnTo)}`}
      existingLabel="기존 노트 열기"
      separateLabel="별도 노트로 저장"
      onSeparate={() => setOperationId(createCreationOperationId())}
      disabled={isPending}
    />
  ) : null;

  // 새 노트는 한 번 열린 편집기를 생성→수정 전환 중(loaded가 잠시 false)에도 그대로 둔다.
  const fieldsReady = loaded || (Boolean(create) && created);

  const titleField = (
    <textarea
      ref={titleRef}
      name="title"
      aria-label="제목"
      value={title}
      rows={1}
      onChange={(event) => {
        // 생성 전에는 같은 요청 ID를 유지해 응답 유실 재시도·중복 생성 판정이 서버에서 이어진다.
        if (created) setOperationId(createCreationOperationId());
        setTitle(event.target.value.replace(/\n/gu, " "));
      }}
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
      onChange={(nextDate) => {
        if (created) setOperationId(createCreationOperationId());
        setNoteDate(nextDate);
      }}
      disabled={!fieldsReady}
    />
  );

  const editor = fieldsReady ? (
    <FullEditor
      initialContent={contentHtml}
      contentVersion={contentVersion}
      onUploadingChange={setIsEditorUploading}
      onChange={handleEditorChange}
      onDirty={(reader) => {
        handleEditorDirty(reader);
        if (!created) {
          if (!operationId) return;
          save({
            operationId,
            title,
            noteDate,
            get contentHtml() {
              return reader();
            },
          });
          return;
        }
        const nextOperationId = createCreationOperationId();
        setOperationId(nextOperationId);
        save(buildEditDraft(nextOperationId, reader));
      }}
      placeholder={create
        ? "수업 내용, 연습 기록, 메모 등을 자유롭게 작성하세요..."
        : "수업 내용, 연습 기록, 메모를 이어서 작성하세요..."}
      minHeight={create ? "320px" : "50dvh"}
      ariaLabel="노트 내용"
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
          quiet={!create}
          disabled={create ? isPending : undefined}
        />
      }
      saveShortcutLabel={canSubmit ? "바로 저장" : undefined}
    />
  ) : null;

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={!loaded || isPending}
      className={cn(!documentLayout && "flex flex-col gap-5")}
      onKeyDownCapture={handleSaveShortcut}
      onSubmit={(event) => {
        if (
          !loaded ||
          !canSubmit ||
          isPending ||
          isEditorUploading ||
          hasStaleDraftBase ||
          !operationId
        ) {
          event.preventDefault();
          return;
        }
        const latestContentHtml = commitLatestContentHtml();
        if (!title.trim() || isRichTextEmpty(latestContentHtml)) {
          event.preventDefault();
          return;
        }
        submittedKeyRef.current = `${title}\u0000${noteDate}\u0000${latestContentHtml}`;
        if (contentHtmlInputRef.current) {
          contentHtmlInputRef.current.value = latestContentHtml;
        }
        if (!created) {
          const submittedDraft: NoteCreateDraft = {
            operationId,
            title,
            noteDate,
            contentHtml: latestContentHtml,
          };
          save(submittedDraft);
          flush();
          submittedDraftRef.current = submittedDraft;
          submittedDraftAliasesRef.current = null;
          return;
        }
        const submittedDraft: CompactNoteEditDraft = {
          title,
          noteDate,
          contentHtml: latestContentHtml,
          operationId,
          baseRevision,
          ...createDocumentEditDraftMetadata(baseFingerprintRef.current),
        };
        save(submittedDraft);
        flush();
        submittedDraftRef.current = submittedDraft;
        submittedDraftAliasesRef.current = createSubmittedDraftAliases({
          title,
          noteDate,
          contentHtml: latestContentHtml,
        });
      }}
    >
      <input ref={contentHtmlInputRef} type="hidden" name="contentHtml" value={contentHtml} />
      <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
      {created ? (
        <>
          <input
            type="hidden"
            name={PRIVATE_NOTE_BASE_REVISION_FIELD}
            value={baseRevision}
          />
          <input
            type="hidden"
            name={DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD}
            value={baseFingerprint}
          />
        </>
      ) : null}

      {documentLayout ? (
        <>
          {documentLayout.renderBars({
            // 위쪽 막대는 짧은 상태만 보이고, 실패 이유와 다시 시도는 본문의 alert가 맡는다.
            status: (
              <AutosaveStatus
                variant="bar"
                status={autosaveStatus}
                message={autosaveMessage}
                shortMessage={hasStaleDraftBase ? "저장 멈춤" : "저장 대기"}
                className="mr-1"
              />
            ),
            title: title.trim() || "제목 없음",
            noteId,
            version: baseRevision,
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
            {autosaveStatus === "error" ? (
              <AutosaveStatus alertRef={errorRef} status="error" message={autosaveMessage} onRetry={retrySave} />
            ) : null}
            {creationConflict}
            {conflictRecovery}
            {editor}
          </NoteDocumentBody>
        </>
      ) : panelLayout ? (
        <>
          {/* 머리는 짧은 상태만 보이고, 실패 이유와 다시 시도는 본문의 alert가 맡는다(문서 배치와 같다). */}
          {panelLayout.statusSlot ? createPortal(
            <AutosaveStatus
              variant="bar"
              status={autosaveStatus}
              message={autosaveMessage}
              shortMessage={hasStaleDraftBase ? "저장 멈춤" : "저장 대기"}
            />,
            panelLayout.statusSlot,
          ) : (
            <div className="flex justify-end">
              <AutosaveStatus status={autosaveStatus} message={autosaveMessage} onRetry={retrySave} />
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
          {panelLayout.statusSlot && autosaveStatus === "error" ? (
            <AutosaveStatus status="error" message={autosaveMessage} onRetry={retrySave} />
          ) : null}
          {creationConflict}
          {conflictRecovery}
          {editor}
        </>
      ) : (
        <>
          <div className="flex justify-end">
            <AutosaveStatus
              alertRef={errorRef}
              status={autosaveStatus}
              message={autosaveMessage}
              onRetry={retrySave}
            />
          </div>

          {creationConflict}
          {conflictRecovery}

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

          {editor}
        </>
      )}
    </form>
  );
}
