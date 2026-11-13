"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { getSchema, type AnyExtension } from "@tiptap/core";
import { updateYFragment, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { CollabProvider, type CollabConnectionStatus, type CollabTokenRequest } from "./provider";
import { COLLAB_FRAGMENT, COLLAB_META, COLLAB_META_SEEDED, isCollabDocSeeded, seedCollabDoc, buildCollabSeedUpdate, type CollabSeedInput } from "./seed";
import { collabDocHtml } from "./doc-html";
import { hasLocalChanges, mergeCollabDocuments, type MergeFields, type PmDoc } from "./merge";
import {
  collabConfirmedDbName,
  collabDocDbName,
  collabGenerationStorageKey,
  collabRecoveryStorageKey,
  deleteIndexedDb,
  isCollabOwnerLocked,
  rememberCollabDbName,
  subscribeCollabOwnerClear,
  subscribeCollabOwnerLock,
} from "./local-store";
import type { CollabMode } from "../protocol";
import { COLLAB_REBASE_EVENT } from "../collab-events";

/**
 * 문서 하나의 공동 편집 상태: Y.Doc + 서버 확인분(confirmed) + 기기 보관(IndexedDB) + room 연결 + 시드 + 저장 담당 선출.
 *
 * 한 편집 세션 동안 Y.Doc과 편집기는 바뀌지 않는다(remount 없음).
 * - 복원은 room이 같은 문서에 적용하는 한 편집으로 들어온다. 이 기기의 겹친 입력(복원 기준에 들어가지 못한 입력)은
 *   CRDT가 지운 부분까지 3-way로 되살리고, "내 입력 유지/제거"를 고르게 한다(제거는 되돌릴 수 있다).
 * - 오프라인에서 처음 연 문서(서버와 맞춘 적 없음)나 room 계보가 바뀐 경우는 room 상태를 staging으로 받아
 *   같은 doc에 제자리로 합친다(room 노드는 지우지 않고 이 기기 전용 블록만 정리).
 * - 다시 연결·동기화·권한 확인 중에도 입력은 이 doc에 쌓였다가 연결되면 전송된다.
 * - 기기 보관은 계정(owner)별 이름을 쓴다. owner를 모르거나 로그아웃 정리로 잠긴 계정이면 열지 않는다.
 * - 저장 담당: `canSave`(쓰기 + 동기화 끝, 혼자 모드 포함)를 알린 사용자 중 clientID가 가장 작은 한 명.
 */
export type CollabUser = { name: string; colorIndex: number };

/** 시드 실패를 멈춰야 할 때(휴지통·삭제·권한 없음). */
export type CollabSeedStop = { stop: string };

/** 저장 요청·Y meta에 싣는 lifecycle 표지(마지막 복원 revision). */
export const COLLAB_META_LIFECYCLE = "lifecycle";

export type CollabDocumentOptions = {
  /** null이면 연결하지 않는다(예: 아직 키를 정하지 못함). */
  request: CollabTokenRequest | null;
  /** room key. 기기 보관 이름에 쓴다. */
  storageKey: string | null;
  /** 기기 보관 계정(서버 렌더의 세션 사용자). 없으면 기기 보관 없이 연결만 한다(읽기 전용 보기 등). */
  ownerId?: string | null;
  user: CollabUser;
  extensions: () => AnyExtension[];
  /**
   * 시드에 쓸 head. 연결된 상태(online)면 서버의 최신 head를 읽어 `lifecycle`과 함께 돌려준다(room 세대와 같을 때만 시드).
   * 오프라인 첫 열기는 화면이 받은 head를 쓴다.
   * null이면 잠시 뒤 다시 시도하고, `{ stop }`이면 멈추고 그 안내를 보여 준다.
   */
  getSeed: (reason: "initial", context: { online: boolean }) => CollabSeedResult | Promise<CollabSeedResult>;
  /**
   * 쓰기 화면(편집 form)이다. 서버에 한 번도 닿지 못해 토큰의 mode를 모르는 오프라인 첫 열기에서도 기기 안 시드·입력을 허용한다.
   * 다시 연결하면 실제 권한(토큰)을 따르고, 쓰기 권한이 없으면 기기 입력은 room에 들어가지 않는다.
   */
  offlineWritable?: boolean;
};

export type CollabSeedResult = (CollabSeedInput & { lifecycle?: number }) | null | CollabSeedStop;

/** 다시 적용 결과 안내: applied(자동 반영)·overlapped(겹친 부분을 둘 다 남김)·kept(반영 못 해 보관함에 남김)·restored(다른 기기의 복원이 들어옴). */
export type CollabRebaseNotice = "applied" | "overlapped" | "kept" | "restored" | null;

/**
 * 복원과 겹친 이 기기 입력의 선택 안내. offer: 유지/제거를 고를 수 있음(고르지 않아도 편집 계속).
 * removed: 제거했음(partial이면 그 뒤 고친 부분은 남김), 되돌릴 수 있음.
 */
export type CollabRestoreChoice = { state: "offer" } | { state: "removed"; partial: boolean } | null;

export type CollabDocumentState = {
  doc: Y.Doc | null;
  provider: CollabProvider | null;
  status: CollabConnectionStatus;
  mode: CollabMode | null;
  /** room 내용(시드 포함)이 준비됐다. 편집기를 그려도 된다. 한 번 true가 되면 이 문서 동안 false로 돌아가지 않는다. */
  ready: boolean;
  needsStaticFallback: boolean;
  isSaver: boolean;
  /** 커서·참여자 표시에 쓸 본인 정보(토큰 응답 기준). 편집기 CollaborationCaret에 그대로 넘긴다. */
  user: CollabUser & { userId?: string };
  /** room 세대(hello). 가이드처럼 lifecycle 칸이 없는 문서의 저장 요청에 싣는다. */
  epoch: number | null;
  /** 복원·제자리 합치기 작업이 남았다. 자동 저장은 이 동안 미룬다(입력은 계속 받는다). */
  rebasing: boolean;
  /** 최신 head 시드: loading(시도 중)·failed(재시도 대기)·stopped(멈춤). */
  seedState: "idle" | "loading" | "failed" | "stopped";
  seedMessage: string | null;
  retrySeed: () => void;
  rebaseNotice: CollabRebaseNotice;
  dismissRebaseNotice: () => void;
  restoreChoice: CollabRestoreChoice;
  keepRestoreInput: () => void;
  removeRestoreInput: () => void;
  undoRestoreChoice: () => void;
  hasUnsentChanges: () => boolean;
  /** 저장 스냅샷에 실을 lifecycle(Y meta, 없으면 room 세대). 본문·칸과 같은 동기 구간에서 읽는다. */
  readLifecycle: () => number | null;
};

const OFFLINE_SEED_WAIT_MS = 4000;
const SEED_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
/** 재적용·saved 비교에서 내용이 아닌 표시용 칸. */
const INTERNAL_META_FIELDS = new Set([COLLAB_META_SEEDED, "savedHash", "headVersion", "operationId", COLLAB_META_LIFECYCLE]);
/** 복원과 겹친 내 입력 선택(제거·되돌리기) transaction. 전용 UndoManager만 이 origin을 기록한다. */
const COLLAB_CHOICE_ORIGIN = "collab-restore-choice";
/** 기기 보관 이름의 세대 칸. 복원은 같은 문서의 편집이라 이름을 바꾸지 않는다(이름이 바뀌면 오프라인 입력을 못 읽는다). */
const STORAGE_GENERATION = 0;

type StoredGeneration = { gen: number; synced: boolean };

function readStoredGeneration(owner: string | null, key: string): StoredGeneration | null {
  if (!owner) return null;
  try {
    const raw = window.localStorage.getItem(collabGenerationStorageKey(owner, key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredGeneration>;
    return Number.isSafeInteger(parsed.gen) && (parsed.gen as number) >= 0
      ? { gen: parsed.gen as number, synced: parsed.synced === true }
      : null;
  } catch {
    return null;
  }
}

function writeStoredGeneration(owner: string | null, key: string, value: StoredGeneration): void {
  if (!owner || isCollabOwnerLocked(owner)) return;
  try {
    window.localStorage.setItem(collabGenerationStorageKey(owner, key), JSON.stringify(value));
  } catch {
    // 저장소를 못 쓰면 다음 연결에서 다시 맞춘다.
  }
}

function readContentFields(doc: Y.Doc): MergeFields {
  const fields: MergeFields = {};
  for (const [name, value] of doc.getMap(COLLAB_META).entries()) {
    if (INTERNAL_META_FIELDS.has(name) || name.endsWith("@v")) continue;
    if (typeof value === "string" || typeof value === "number" || value === null) fields[name] = value as string | number | null;
  }
  return fields;
}

function readPmDoc(doc: Y.Doc): PmDoc {
  return yDocToProsemirrorJSON(doc, COLLAB_FRAGMENT) as PmDoc;
}

type RebaseJob = {
  /** 이 작업을 만든 문서(다른 문서에 적용하지 않는다). */
  storageKey: string;
  /** restore: 복원과 겹친 이 기기 입력을 되살린다(끝나면 선택 안내). */
  kind: "restore" | "rebase";
  /** restore 작업: 이 기기 입력 없이 복원이 들어간 문서(제거 선택의 목표). */
  restored?: { doc: PmDoc; fields: MergeFields };
  /** restore 작업: 처음 되살린 직후 문서(제거 선택의 기준). 재시도에서 바꾸지 않는다. */
  kept?: { doc: PmDoc; fields: MergeFields };
  base: PmDoc;
  mine: PmDoc;
  baseFields: MergeFields;
  mineFields: MergeFields;
  /** 재적용 전에 남긴 복구본 key. 반영되면 지운다. */
  recoveryKey: string | null;
  /**
   * 이 작업의 병합을 이미 넣은 문서와 그때의 결과. ack를 받지 못해 다시 시도할 때 같은 문서에는 다시 합치지 않는다:
   * 그 사이 사용자가 고친 문서가 theirs가 되면 3-way 병합은 "내가 바꾼 블록을 상대가 바꿈"과 구분하지 못해
   * 이미 넣은 블록을 한 번 더 붙이거나 지운 블록을 되살린다. 넣은 내용은 문서에 있으므로 재시도는 ack만 기다린다.
   * 문서 객체가 바뀌면(편집 세션이 다시 시작됨) 다시 합친다.
   */
  applied?: { target: Y.Doc; changed: boolean; conflicts: number; fields: MergeFields };
};

/** 다시 적용하지 못할 때를 대비한 복구 사본. 이전 초안 보관함이 본인 계정 것만 읽는다. */
function saveCollabRecoveryCopy(owner: string | null, key: string, doc: Y.Doc, extensions: () => AnyExtension[], userId: string | null): string | null {
  const account = owner ?? userId;
  if (!account || isCollabOwnerLocked(account)) return null;
  try {
    const fields: Record<string, string> = {};
    for (const [name, value] of Object.entries(readContentFields(doc))) if (typeof value === "string") fields[name] = value;
    const copy = { key, userId: account, savedAt: new Date().toISOString(), fields, html: collabDocHtml(doc, extensions()) };
    const storageKey = collabRecoveryStorageKey(account, key, Date.now());
    window.localStorage.setItem(storageKey, JSON.stringify(copy));
    return storageKey;
  } catch {
    return null;
  }
}

function removeStorageItem(key: string | null): void {
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 남은 복구본은 보관함에서 지울 수 있다.
  }
}

type Persistence = { whenSynced: Promise<unknown>; destroy(): Promise<void> };

async function openPersistence(name: string, doc: Y.Doc): Promise<Persistence | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const { IndexeddbPersistence } = await import("y-indexeddb");
    return new IndexeddbPersistence(name, doc) as unknown as Persistence;
  } catch {
    return null;
  }
}

/** 같은 기기 여러 탭의 재적용을 한 번에 하나씩(뒤 탭은 같은 변경이 이미 있어 no-op이 된다). */
async function withRebaseLock<T>(name: string, task: () => Promise<T> | T): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) return task();
  return locks.request(name, async () => task()) as Promise<T>;
}

/** 같은 사용자는 어느 기기에서나 같은 색을 쓴다. */
export function collabColorIndex(userId: string): number {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) hash = (Math.imul(hash, 31) + userId.charCodeAt(index)) | 0;
  return Math.abs(hash) % 6;
}

function collabUserFor(provider: CollabProvider, fallback: CollabUser): CollabUser & { userId?: string } {
  const identity = provider.identity;
  if (!identity) return fallback;
  return { name: identity.displayName, colorIndex: collabColorIndex(identity.userId), userId: identity.userId };
}

function computeIsSaver(provider: CollabProvider): boolean {
  const states = provider.awareness.getStates();
  const self = provider.doc.clientID;
  if (!(states.get(self) as { canSave?: boolean } | undefined)?.canSave) return false;
  for (const [clientId, state] of states) {
    if (clientId < self && (state as { canSave?: boolean } | undefined)?.canSave) return false;
  }
  return true;
}

type InternalState = Omit<
  CollabDocumentState,
  "hasUnsentChanges" | "retrySeed" | "dismissRebaseNotice" | "keepRestoreInput" | "removeRestoreInput" | "undoRestoreChoice" | "readLifecycle"
>;

type ChoiceContext = {
  /** 되살림 직후 문서(내 입력 포함)와 내 입력 없는 복원 결과. */
  kept: { doc: PmDoc; fields: MergeFields };
  restored: { doc: PmDoc; fields: MergeFields };
  undo: Y.UndoManager | null;
};

function readLifecycleFrom(doc: Y.Doc | null, provider: CollabProvider | null): number | null {
  if (doc && !doc.isDestroyed) {
    const value = doc.getMap(COLLAB_META).get(COLLAB_META_LIFECYCLE);
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  }
  return provider?.roomLifecycle ?? provider?.epoch ?? null;
}


function emitCollabRebase(doc: Y.Doc, phase: "before" | "after"): void {
  (doc as unknown as { emit(name: string, args: unknown[]): void }).emit(COLLAB_REBASE_EVENT, [phase]);
}

/** room 상태(state vector)에 없는 최상위 블록 = 이 기기에서만 만든 블록(서버와 맞추기 전 시드·계보가 다른 옛 블록). */
function deleteLocalOnlyBlocks(fragment: Y.XmlFragment, roomSv: Map<number, number>): void {
  const children = fragment.toArray();
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const item = (children[index] as unknown as { _item?: { id: { client: number; clock: number } } | null })._item;
    if (!item) continue;
    if ((roomSv.get(item.id.client) ?? 0) > item.id.clock) continue;
    fragment.delete(index, 1);
  }
}

export function useCollabDocument(options: CollabDocumentOptions): CollabDocumentState {
  const { request, storageKey } = options;
  const ownerId = options.ownerId ?? null;
  const requestKey = request ? JSON.stringify(request) : null;
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const [state, setState] = useState<InternalState>({
    doc: null,
    provider: null,
    status: "connecting",
    mode: null,
    ready: false,
    needsStaticFallback: false,
    isSaver: false,
    user: options.user,
    epoch: null,
    rebasing: false,
    seedState: "idle",
    seedMessage: null,
    rebaseNotice: null,
    restoreChoice: null,
  });
  const providerRef = useRef<CollabProvider | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const userRef = useRef<CollabUser & { userId?: string }>(options.user);
  /** 다시 적용할 작업들. 순서대로 적용한다. */
  const jobRef = useRef<RebaseJob[]>([]);
  const retrySeedRef = useRef<() => void>(() => undefined);
  const choiceRef = useRef<ChoiceContext | null>(null);
  const choiceActionsRef = useRef<{ remove: () => void; undo: () => void; keep: () => void }>({
    remove: () => undefined,
    undo: () => undefined,
    keep: () => undefined,
  });
  // 로그아웃 정리로 잠겼다가 같은 계정이 다시 로그인하면 기기 보관을 다시 연다(계정 경계: 편집 세션 종료로 본다).
  const [lockEpoch, setLockEpoch] = useState(0);
  useEffect(() => {
    if (!ownerId) return;
    return subscribeCollabOwnerLock(ownerId, (locked) => {
      if (!locked) setLockEpoch((value) => value + 1);
    });
  }, [ownerId]);

  useEffect(() => {
    if (!requestKey || !storageKey) return;
    const parsedRequest = JSON.parse(requestKey) as CollabTokenRequest;
    const owner = ownerId && !isCollabOwnerLocked(ownerId) ? ownerId : null;
    let disposed = false;
    const stored = readStoredGeneration(owner, storageKey);
    const doc = new Y.Doc();
    const confirmed = new Y.Doc();
    docRef.current = doc;
    let persistence: Persistence | null = null;
    let confirmedPersistence: Persistence | null = null;
    let persistenceClosed = false;
    /** 로그아웃·계정 전환 정리가 이 문서를 지나갔다(화면만 닫힌 것과 구분한다). */
    let ownerCleared = false;
    let provider: CollabProvider | null = null;
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    let seedRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let rebaseRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let seedAttempts = 0;
    let persistenceLoaded = false;
    let seeding = false;
    let applyingJob = false;
    let everReady = false;
    let syncedRecorded = Boolean(stored?.synced);
    /** 복원 알림을 받은 순간의 기준(confirmed = 복원 기준 C)과 이 기기 상태. 복원이 들어오면 작업으로 만든다. */
    let restoreCapture: { base: PmDoc; mine: PmDoc; baseFields: MergeFields; mineFields: MergeFields } | null = null;
    const unsubscribers: Array<() => void> = [];
    const docName = owner ? collabDocDbName(owner, storageKey, STORAGE_GENERATION) : null;
    const confirmedName = owner ? collabConfirmedDbName(owner, storageKey, STORAGE_GENERATION) : null;
    const lockName = `portal-collab-rebase:${owner ?? "anon"}:${storageKey}`;

    const update = (patch: Partial<InternalState>) => {
      if (!disposed) setState((previous) => ({ ...previous, ...patch }));
    };

    const closePersistence = async () => {
      if (persistenceClosed) return;
      persistenceClosed = true;
      await Promise.all([persistence?.destroy(), confirmedPersistence?.destroy()].map((value) => value?.catch(() => undefined)));
    };

    const pendingJobs = () => jobRef.current.filter((job) => job.storageKey === storageKey);

    const publishAwareness = () => {
      if (!provider) return;
      const canSave =
        provider.mode === "write" && (provider.status === "solo" || (provider.status === "connected" && provider.synced));
      const next = collabUserFor(provider, optionsRef.current.user);
      // 같은 값이면 같은 객체를 써서 편집기 확장(커서)이 다시 만들어지지 않게 한다.
      const previous = userRef.current;
      const user =
        previous.name === next.name && previous.colorIndex === next.colorIndex && previous.userId === next.userId
          ? previous
          : next;
      userRef.current = user;
      provider.awareness.setLocalStateField("user", user);
      provider.awareness.setLocalStateField("canSave", canSave);
      update({ isSaver: computeIsSaver(provider), user });
    };

    const refreshReady = () => {
      const seeded = isCollabDocSeeded(doc);
      // 한 번 그린 편집기는 이 문서 동안 내리지 않는다(복원·재연결·rebase도 같은 편집기에서).
      if (seeded) everReady = true;
      update({
        ready: everReady,
        rebasing: pendingJobs().length > 0 || Boolean(provider?.isStaging),
        needsStaticFallback: !everReady && provider?.mode === "read" && (provider.synced || provider.status === "solo" || provider.status === "offline"),
      });
    };

    const canWriteNow = () =>
      Boolean(provider) && provider!.mode === "write" && ((provider!.status === "connected" && provider!.synced) || provider!.status === "solo");

    /** 쓸 수 없게 됐으면(읽기 강등·권한 없음) 재적용을 포기하고 보관함 사본을 남긴 채 알린다. */
    const abandonJobs = () => {
      const pending = pendingJobs();
      if (pending.length === 0) return;
      jobRef.current = jobRef.current.filter((job) => job.storageKey !== storageKey);
      update({ rebaseNotice: pending.some((job) => job.recoveryKey) ? "kept" : null });
      refreshReady();
    };

    /** 넘겨받은 재적용 작업을 room 상태(시드 뒤) 위에 적용한다. */
    const applyJob = async () => {
      if (applyingJob || disposed || !isCollabDocSeeded(doc) || !canWriteNow()) return;
      if (pendingJobs().length === 0) return;
      applyingJob = true;
      let notice: CollabRebaseNotice = null;
      let offerChoice: ChoiceContext | null = null;
      try {
        let retryLater = false;
        await withRebaseLock(lockName, async () => {
          // 잠금을 얻은 뒤 room 상태를 한 번 더 받아, 다른 탭이 방금 다시 적용한 내용까지 theirs에 넣는다.
          if (provider && provider.status !== "solo" && !(await provider.resync().catch(() => false))) {
            retryLater = true;
            return;
          }
          while (!disposed && !doc.isDestroyed) {
            const job = jobRef.current.find((pending) => pending.storageKey === storageKey);
            if (!job) break;
            // 이 문서에 이미 넣은 작업은 다시 합치지 않는다(재시도는 ack만 기다린다).
            let outcome = job.applied?.target === doc ? job.applied : null;
            if (!outcome) {
              // theirs는 적용 직전 같은 tick에 live doc에서 읽는다.
              const merged = mergeCollabDocuments({
                base: job.base,
                mine: job.mine,
                theirs: readPmDoc(doc),
                baseFields: job.baseFields,
                mineFields: job.mineFields,
                theirsFields: readContentFields(doc),
                // 복원과 겹친 내 칸 입력은 남긴다(제거는 선택으로).
                fieldConflict: job.kind === "restore" ? "mine" : "theirs",
              });
              if (merged.changed) {
                const schema = getSchema(optionsRef.current.extensions());
                const node = schema.nodeFromJSON(merged.doc);
                doc.transact(() => {
                  updateYFragment(doc, doc.getXmlFragment(COLLAB_FRAGMENT), node, { mapping: new Map(), isOMark: new Map() });
                  const meta = doc.getMap(COLLAB_META);
                  for (const [name, value] of Object.entries(merged.fields)) {
                    if (INTERNAL_META_FIELDS.has(name)) continue;
                    if (meta.get(name) !== value) meta.set(name, value);
                  }
                }, "collab-rebase");
              }
              outcome = { target: doc, changed: merged.changed, conflicts: merged.conflicts, fields: merged.fields };
              job.applied = outcome;
            }
            const applied = outcome;
            // 제거 선택의 기준은 되살린 바로 그 순간의 문서다(ack를 기다리는 동안 들어온 다른 입력은 제거 대상이 아니다).
            // ack 실패 뒤 재시도에서는 다시 계산하지 않는다(그사이 입력이 제거 대상에 들어가지 않게 처음 값을 job에 고정).
            // 문서가 바뀌어 다시 합친 경우에도 처음 값을 그대로 둔다.
            if (job.kind === "restore" && !job.kept) job.kept = { doc: readPmDoc(doc), fields: readContentFields(doc) };
            const keptNow = job.kept ?? null;
            // room에 저장(ack)된 뒤에야 작업을 끝내고 잠금을 푼다(다음 탭이 이 결과를 보고 같은 변경을 다시 넣지 않게).
            if (!(await (provider?.awaitAcked() ?? Promise.resolve(false)))) {
              retryLater = true;
              return;
            }
            const lostField =
              job.kind === "rebase" &&
              Object.keys(job.mineFields).some(
                (name) => !INTERNAL_META_FIELDS.has(name) && job.mineFields[name] !== job.baseFields[name] && applied.fields[name] !== job.mineFields[name],
              );
            jobRef.current = jobRef.current.filter((pending) => pending !== job);
            if (!lostField) removeStorageItem(job.recoveryKey);
            if (job.kind === "restore" && job.restored && keptNow) {
              offerChoice = { kept: keptNow, restored: job.restored, undo: null };
              continue;
            }
            const next: CollabRebaseNotice = lostField ? "kept" : applied.changed ? (applied.conflicts > 0 ? "overlapped" : "applied") : null;
            if (next === "kept" || (next === "overlapped" && notice !== "kept") || (next === "applied" && notice === null)) notice = next;
          }
        });
        if (retryLater && !disposed) {
          if (rebaseRetryTimer) clearTimeout(rebaseRetryTimer);
          rebaseRetryTimer = setTimeout(() => {
            rebaseRetryTimer = null;
            void applyJob();
          }, 2000);
        }
        if (!disposed && notice) update({ rebaseNotice: notice });
        if (!disposed && offerChoice) {
          choiceRef.current?.undo?.destroy();
          choiceRef.current = offerChoice;
          update({ restoreChoice: { state: "offer" } });
        }
      } catch {
        // 적용하지 못하면 복구본이 남아 있다(보관함).
        const pending = pendingJobs();
        jobRef.current = jobRef.current.filter((job) => job.storageKey !== storageKey);
        if (!disposed) update({ rebaseNotice: pending.some((job) => job.recoveryKey) ? "kept" : null });
      } finally {
        applyingJob = false;
        refreshReady();
      }
    };

    /** 복원과 겹친 내 입력 제거: 되살린 직후(kept) → 복원 결과(restored) 변화만 지금 문서에 적용. 그 뒤 고친 블록은 남긴다. */
    choiceActionsRef.current = {
      keep: () => {
        choiceRef.current?.undo?.destroy();
        choiceRef.current = null;
        update({ restoreChoice: null });
      },
      remove: () => {
        const context = choiceRef.current;
        if (!context || disposed || doc.isDestroyed || provider?.mode === "read") return;
        const merged = mergeCollabDocuments({
          base: context.kept.doc,
          mine: context.restored.doc,
          theirs: readPmDoc(doc),
          baseFields: context.kept.fields,
          mineFields: context.restored.fields,
          theirsFields: readContentFields(doc),
          blockConflict: "theirs",
          fieldConflict: "theirs",
        });
        context.undo?.destroy();
        const undo = new Y.UndoManager([doc.getXmlFragment(COLLAB_FRAGMENT), doc.getMap(COLLAB_META)], {
          trackedOrigins: new Set([COLLAB_CHOICE_ORIGIN]),
          captureTimeout: 0,
        });
        context.undo = undo;
        if (merged.changed) {
          const schema = getSchema(optionsRef.current.extensions());
          const node = schema.nodeFromJSON(merged.doc);
          undo.stopCapturing();
          doc.transact(() => {
            updateYFragment(doc, doc.getXmlFragment(COLLAB_FRAGMENT), node, { mapping: new Map(), isOMark: new Map() });
            const meta = doc.getMap(COLLAB_META);
            for (const [name, value] of Object.entries(merged.fields)) {
              if (INTERNAL_META_FIELDS.has(name)) continue;
              if (meta.get(name) !== value) meta.set(name, value);
            }
          }, COLLAB_CHOICE_ORIGIN);
          undo.stopCapturing();
        }
        update({ restoreChoice: { state: "removed", partial: merged.conflicts > 0 } });
      },
      undo: () => {
        const context = choiceRef.current;
        if (!context?.undo || disposed || doc.isDestroyed) return;
        context.undo.undo();
        context.undo.destroy();
        context.undo = null;
        update({ restoreChoice: { state: "offer" } });
      },
    };

    /**
     * 제자리 rebase: room 상태(roomState)를 같은 doc에 합친다. room 노드는 지우지 않고(다른 기기 커서 유지)
     * room에 없는 이 기기 전용 최상위 블록만 정리한 뒤, 서버 확인분 → 이 기기 변경을 3-way로 다시 맞춘다.
     */
    const rebaseInPlace = (roomState: Uint8Array) => {
      const roomDoc = new Y.Doc();
      try {
        Y.applyUpdate(roomDoc, roomState);
        const roomSv = Y.decodeStateVector(Y.encodeStateVector(roomDoc));
        if (provider?.mode !== "write") {
          // 읽기: 이 기기 입력이 없다. 옛 계보 블록을 지우고 room 상태를 그대로 받는다(confirmed도 같게).
          for (const target of [doc, confirmed]) {
            target.transact(() => {
              deleteLocalOnlyBlocks(target.getXmlFragment(COLLAB_FRAGMENT), roomSv);
              Y.applyUpdate(target, roomState);
            }, "collab-rebase");
          }
          return;
        }
        if (!roomDoc.getMap(COLLAB_META).has(COLLAB_META_SEEDED)) return; // 빈 room: 이 doc이 그대로 시드가 된다.
        const base = readPmDoc(confirmed);
        const baseFields = readContentFields(confirmed);
        const mine = readPmDoc(doc);
        const mineFields = readContentFields(doc);
        const theirs = readPmDoc(roomDoc);
        const theirsFields = readContentFields(roomDoc);
        const recoveryKey = hasLocalChanges(base, mine, baseFields, mineFields)
          ? saveCollabRecoveryCopy(owner, storageKey, doc, optionsRef.current.extensions, provider?.identity?.userId ?? null)
          : null;
        const merged = mergeCollabDocuments({ base, mine, theirs, baseFields, mineFields, theirsFields });
        const schema = getSchema(optionsRef.current.extensions());
        const node = schema.nodeFromJSON(merged.doc);
        // 이 기기 전용 블록을 지우면 그 안의 커서 상대 위치가 사라진다. 편집기가 (블록 순번·offset)과 스크롤을 기억했다가 되살린다.
        emitCollabRebase(doc, "before");
        doc.transact(() => {
          deleteLocalOnlyBlocks(doc.getXmlFragment(COLLAB_FRAGMENT), roomSv);
          Y.applyUpdate(doc, roomState);
          updateYFragment(doc, doc.getXmlFragment(COLLAB_FRAGMENT), node, { mapping: new Map(), isOMark: new Map() });
          const meta = doc.getMap(COLLAB_META);
          for (const [name, value] of Object.entries(merged.fields)) {
            if (INTERNAL_META_FIELDS.has(name)) continue;
            if (meta.get(name) !== value) meta.set(name, value);
          }
          const roomLifecycle = roomDoc.getMap(COLLAB_META).get(COLLAB_META_LIFECYCLE);
          if (typeof roomLifecycle === "number") meta.set(COLLAB_META_LIFECYCLE, roomLifecycle);
        }, "collab-rebase");
        emitCollabRebase(doc, "after");
        confirmed.transact(() => {
          deleteLocalOnlyBlocks(confirmed.getXmlFragment(COLLAB_FRAGMENT), roomSv);
          Y.applyUpdate(confirmed, roomState);
        }, "collab-rebase");
        const lostField = Object.keys(mineFields).some(
          (name) => !INTERNAL_META_FIELDS.has(name) && mineFields[name] !== baseFields[name] && merged.fields[name] !== mineFields[name],
        );
        if (!lostField) removeStorageItem(recoveryKey);
        const notice: CollabRebaseNotice = lostField ? "kept" : merged.changed && hasLocalChanges(base, mine, baseFields, mineFields) ? (merged.conflicts > 0 ? "overlapped" : "applied") : null;
        if (notice) update({ rebaseNotice: notice });
      } finally {
        roomDoc.destroy();
      }
    };

    const handleHold = (roomState: Uint8Array) => {
      const current = provider;
      if (!current) return;
      refreshReady();
      void withRebaseLock(lockName, async () => {
        // 잠금을 얻은 뒤 room 상태를 다시 받는다(다른 탭이 방금 합친 내용까지).
        const fresh = (await current.fetchStagingState().catch(() => null)) ?? roomState;
        if (disposed || doc.isDestroyed || current !== provider) return;
        rebaseInPlace(fresh);
        current.completeStaging();
        // ack 뒤에야 "서버와 맞췄음"을 기록한다(중간에 끝나도 다음 열기가 같은 경로를 안전하게 반복한다).
        await current.awaitAcked(5000).catch(() => false);
      })
        .catch(() => {
          // 합치지 못하면 이 연결을 다시 시작한다(다음 hello가 다시 staging한다).
          current.reconnect();
        })
        .finally(() => refreshReady());
    };

    const scheduleSeedRetry = () => {
      if (disposed || seedRetryTimer) return;
      const delay = SEED_RETRY_DELAYS_MS[Math.min(seedAttempts, SEED_RETRY_DELAYS_MS.length - 1)];
      seedAttempts += 1;
      seedRetryTimer = setTimeout(() => {
        seedRetryTimer = null;
        void trySeed(false);
      }, delay);
    };

    const trySeed = async (force: boolean) => {
      const assumedWrite =
        provider?.mode === null && optionsRef.current.offlineWritable === true && provider.status === "offline" && !provider.everConnected;
      if (disposed || seeding || !provider || (provider.mode !== "write" && !assumedWrite)) {
        refreshReady();
        return;
      }
      if (isCollabDocSeeded(doc)) {
        refreshReady();
        void applyJob();
        return;
      }
      // 서버와 연결된 적이 없이 오프라인인 경우에만 기기 안에서 먼저 시드한다(느린 연결에서 다른 head로 시드해 본문이 겹치지 않게).
      const offlineFirst = force && persistenceLoaded && provider.status === "offline" && !provider.everConnected && !syncedRecorded;
      const canSeedNow = (provider.status === "connected" && provider.synced) || (provider.status === "solo" && persistenceLoaded) || offlineFirst;
      if (!canSeedNow) return;
      seeding = true;
      update({ seedState: "loading", seedMessage: null });
      try {
        const online = provider.status === "connected";
        const seed = await Promise.resolve(optionsRef.current.getSeed("initial", { online })).catch(() => null);
        if (disposed) return;
        if (seed && "stop" in seed) {
          update({ seedState: "stopped", seedMessage: seed.stop });
          return;
        }
        // 다른 세대의 head(복원 전후가 엇갈림)로 시드하지 않는다.
        const roomEpoch = provider.roomLifecycle ?? provider.epoch;
        if (!seed || (typeof seed.lifecycle === "number" && roomEpoch !== null && seed.lifecycle !== roomEpoch)) {
          update({ seedState: "failed", seedMessage: "최신 내용을 불러오지 못했습니다. 잠시 뒤 다시 시도합니다." });
          scheduleSeedRetry();
          return;
        }
        if (!isCollabDocSeeded(doc)) {
          // lifecycle은 시드 칸에 함께 넣는다(저장 스냅샷이 같은 동기 구간에서 읽는다).
          const input: CollabSeedInput =
            typeof seed.lifecycle === "number" ? { ...seed, fields: { ...seed.fields, [COLLAB_META_LIFECYCLE]: seed.lifecycle } } : seed;
          seedCollabDoc(doc, input, optionsRef.current.extensions());
          // 오프라인 첫 열기의 시드는 서버 head에서 만든 것이므로 서버 확인분의 기준(base)으로도 둔다.
          // 다시 연결하면 이 base 위의 입력만 서버 상태에 다시 맞춘다(본문 이중 시드 방지).
          if (offlineFirst) Y.applyUpdate(confirmed, buildCollabSeedUpdate(input, optionsRef.current.extensions()), "seed");
        }
        seedAttempts = 0;
        update({ seedState: "idle", seedMessage: null });
      } finally {
        seeding = false;
        refreshReady();
        void applyJob();
      }
    };
    retrySeedRef.current = () => {
      if (seedRetryTimer) clearTimeout(seedRetryTimer);
      seedRetryTimer = null;
      seedAttempts = 0;
      void trySeed(false);
    };

    const meta = doc.getMap(COLLAB_META);
    const handleMeta = () => refreshReady();
    meta.observe(handleMeta);
    unsubscribers.push(() => meta.unobserve(handleMeta));

    // 로그아웃·계정 전환 정리: 이 계정의 기기 보관을 닫고 다시 열지 않는다(열린 연결이 DB를 다시 만들지 않게).
    if (owner) {
      unsubscribers.push(
        subscribeCollabOwnerClear((signal) => {
          const mine = signal.mode === "owner" ? signal.ownerId === owner : signal.ownerId !== owner;
          if (!mine) return;
          ownerCleared = true;
          void closePersistence();
        }),
      );
    }

    void (async () => {
      if (docName && confirmedName && owner && rememberCollabDbName(owner, docName) && rememberCollabDbName(owner, confirmedName)) {
        [persistence, confirmedPersistence] = await Promise.all([openPersistence(docName, doc), openPersistence(confirmedName, confirmed)]);
        if (ownerCleared || isCollabOwnerLocked(owner)) {
          // 여는 사이 로그아웃·계정 정리가 지나갔으면 방금 만든 DB를 닫고 지운다(정리 뒤 다시 생기지 않게).
          persistenceClosed = false;
          await closePersistence();
          await Promise.all([deleteIndexedDb(docName), deleteIndexedDb(confirmedName)]).catch(() => undefined);
        } else if (persistenceClosed) {
          // 여는 사이 화면만 닫혔으면(빠른 재마운트) 방금 연 연결만 닫는다. 같은 문서를 다시 연 화면이 같은 DB를 쓰고 있으므로
          // 지우지 않는다(지우면 그 화면의 기기 보관이 닫혀 입력 저장이 오류로 멈춘다).
          persistenceClosed = false;
          await closePersistence();
        }
      }
      if (disposed) {
        await closePersistence();
        return;
      }
      try {
        await Promise.all([persistence?.whenSynced, confirmedPersistence?.whenSynced]);
      } catch {
        // 보관본을 못 읽어도 서버 상태로 이어간다.
      }
      if (disposed) return;
      persistenceLoaded = true;
      provider = new CollabProvider(doc, {
        request: parsedRequest,
        localEpoch: stored ? stored.gen : null,
        confirmed,
        // 서버와 한 번도 맞춘 적 없는 기기 상태(오프라인 첫 열기 선시드)는 room에 바로 합치지 않는다.
        shouldHold: () => !syncedRecorded && isCollabDocSeeded(doc),
      });
      providerRef.current = provider;
      update({ doc, provider, status: provider.status, mode: provider.mode });
      unsubscribers.push(
        provider.on("status", (status) => {
          if (status === "connected" && provider?.synced && provider.epoch !== null && !provider.isStaging) {
            if (!syncedRecorded || stored?.gen !== provider.epoch) {
              syncedRecorded = true;
              writeStoredGeneration(owner, storageKey, { gen: provider.epoch, synced: true });
            }
          }
          if (status === "denied" || status === "too-large") abandonJobs();
          update({ status, mode: provider?.mode ?? null, epoch: provider?.epoch ?? null });
          publishAwareness();
          void trySeed(false);
          void applyJob();
        }),
        provider.on("mode", (mode) => {
          if (mode === "read") {
            // 읽기로 바뀐 순간 보내지 못한 입력은 room에 들어갈 수 없다. 보관함 사본으로 남긴다.
            if (provider?.hasUnsentChanges() && saveCollabRecoveryCopy(owner, storageKey, doc, optionsRef.current.extensions, provider.identity?.userId ?? null)) {
              // 이 기기에 보이는 보내지 못한 입력은 문서에 들어가지 않는다. 보관함에 남겼음을 알린다.
              update({ rebaseNotice: "kept" });
            }
            abandonJobs();
            choiceRef.current?.undo?.destroy();
            choiceRef.current = null;
            update({ restoreChoice: null });
          }
          update({ mode });
          publishAwareness();
          void trySeed(false);
        }),
        provider.on("hold", (roomState) => handleHold(roomState)),
        provider.on("restoring", () => {
          // 이 순간 confirmed는 복원 기준 C와 같다. C 밖의 이 기기 입력만 다시 맞출 대상이다.
          const base = readPmDoc(confirmed);
          const baseFields = readContentFields(confirmed);
          const mine = readPmDoc(doc);
          const mineFields = readContentFields(doc);
          restoreCapture = hasLocalChanges(base, mine, baseFields, mineFields) ? { base, mine, baseFields, mineFields } : null;
          update({ rebasing: true });
        }),
        provider.on("restoreApplied", (lifecycle) => {
          writeStoredGeneration(owner, storageKey, { gen: lifecycle, synced: true });
          update({ epoch: lifecycle });
          const capture = restoreCapture;
          restoreCapture = null;
          if (!capture || provider?.mode !== "write") {
            // 겹친 입력이 없으면 고를 것이 없다. 문서가 바뀐 이유만 알린다(편집은 그대로 이어진다).
            update({ rebaseNotice: "restored" });
            refreshReady();
            return;
          }
          // 이 기기 입력 없이 복원이 들어간 문서 T(제거 선택의 목표). 이 기기 입력은 아직 confirmed 밖이다.
          const restored = { doc: readPmDoc(confirmed), fields: readContentFields(confirmed) };
          // 복원 시점에 있어야 할 문서 R = 복원 기준 C → 이 기기 입력을 T 위에 다시 맞춘 것(겹치면 둘 다 남긴다).
          // CRDT 병합은 지워진 부모 안 입력이나 통째로 바꾼 문단을 가릴 수 있어, 지금 문서 X에서 R로 맞추는 작업으로 넘긴다.
          const intended = mergeCollabDocuments({
            base: capture.base,
            mine: capture.mine,
            theirs: restored.doc,
            baseFields: capture.baseFields,
            mineFields: capture.mineFields,
            theirsFields: restored.fields,
            fieldConflict: "mine",
          });
          const recoveryKey = saveCollabRecoveryCopy(owner, storageKey, doc, optionsRef.current.extensions, provider.identity?.userId ?? null);
          jobRef.current = [
            ...jobRef.current,
            {
              storageKey,
              kind: "restore",
              restored,
              recoveryKey,
              base: readPmDoc(doc),
              baseFields: readContentFields(doc),
              mine: intended.doc,
              mineFields: intended.fields,
            },
          ];
          refreshReady();
          void applyJob();
        }),
      );
      const handleAwareness = () => update({ isSaver: provider ? computeIsSaver(provider) : false });
      provider.awareness.on("change", handleAwareness);
      unsubscribers.push(() => provider?.awareness.off("change", handleAwareness));
      publishAwareness();
      refreshReady();
      void trySeed(false);
      // 연결이 안 되는 채로 처음 연 문서는 잠시 기다린 뒤 기기 안에서 같은 결정적 시드로 시작한다.
      offlineTimer = setTimeout(() => void trySeed(true), OFFLINE_SEED_WAIT_MS);
    })();

    return () => {
      disposed = true;
      if (offlineTimer) clearTimeout(offlineTimer);
      if (seedRetryTimer) clearTimeout(seedRetryTimer);
      if (rebaseRetryTimer) clearTimeout(rebaseRetryTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
      choiceRef.current?.undo?.destroy();
      choiceRef.current = null;
      provider?.destroy();
      providerRef.current = null;
      if (docRef.current === doc) docRef.current = null;
      void closePersistence();
      doc.destroy();
      confirmed.destroy();
    };
  }, [requestKey, storageKey, ownerId, lockEpoch]);

  const hasUnsentChanges = useCallback(() => providerRef.current?.hasUnsentChanges() ?? false, []);
  const retrySeed = useCallback(() => retrySeedRef.current(), []);
  const dismissRebaseNotice = useCallback(() => setState((previous) => ({ ...previous, rebaseNotice: null })), []);
  const keepRestoreInput = useCallback(() => choiceActionsRef.current.keep(), []);
  const removeRestoreInput = useCallback(() => choiceActionsRef.current.remove(), []);
  const undoRestoreChoice = useCallback(() => choiceActionsRef.current.undo(), []);
  const readLifecycle = useCallback(() => readLifecycleFrom(docRef.current, providerRef.current), []);
  return {
    ...state,
    hasUnsentChanges,
    retrySeed,
    dismissRebaseNotice,
    keepRestoreInput,
    removeRestoreInput,
    undoRestoreChoice,
    readLifecycle,
  };
}
