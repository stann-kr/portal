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
import type { CollabMode, CollabPrepareMode } from "../protocol";

/**
 * 문서 하나의 공동 편집 상태: Y.Doc + 서버 확인분(confirmed) + 기기 보관(IndexedDB) + room 연결 + 시드 + 저장 담당 선출.
 *
 * - 기기 보관은 계정(owner)별 이름을 쓴다. owner를 모르거나 로그아웃 정리로 잠긴 계정이면 열지 않는다.
 * - 쓰기 사용자는 서버와 동기화가 끝난 뒤(혼자 모드면 기기 보관을 읽은 뒤, 처음 연 문서가 오프라인이면 잠시 기다린 뒤)
 *   room이 비어 있으면 head로 결정적 시드를 넣는다.
 * - room 세대가 바뀌거나(복원) 오프라인에서 처음 연 문서를 다시 연결하면, 이 기기 상태를 room에 그대로 합치지 않는다.
 *   새 room과 동기화한 뒤 "서버 확인분 → 이 기기" 변경분만 3-way로 다시 적용한다(재적용은 그 변경을 만든 기기만 한다).
 * - 저장 담당: `canSave`(쓰기 + 동기화 끝, 혼자 모드 포함)를 알린 사용자 중 clientID가 가장 작은 한 명.
 */
export type CollabUser = { name: string; colorIndex: number };

/** 시드 실패를 멈춰야 할 때(휴지통·삭제·권한 없음). */
export type CollabSeedStop = { stop: string };

export type CollabFlushResult = { ok: boolean; revision?: number; dirty?: boolean };

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
  getSeed: (reason: "initial" | "reset", context: { online: boolean }) => CollabSeedResult | Promise<CollabSeedResult>;
  /** 복원 준비 중 저장 담당에게 오는 checkpoint 요청. 노트는 지금 내용을 저장하고, 게시물은 작업본이 게시본과 같은지 답한다. */
  onFlush?: (mode: CollabPrepareMode) => Promise<CollabFlushResult>;
  /**
   * 쓰기 화면(편집 form)이다. 서버에 한 번도 닿지 못해 토큰의 mode를 모르는 오프라인 첫 열기에서도 기기 안 시드·입력을 허용한다.
   * 다시 연결하면 실제 권한(토큰)을 따르고, 쓰기 권한이 없으면 기기 입력은 room에 들어가지 않는다.
   */
  offlineWritable?: boolean;
};

export type CollabSeedResult = (CollabSeedInput & { lifecycle?: number }) | null | CollabSeedStop;

export type CollabRebaseNotice = "applied" | "overlapped" | "kept" | null;

export type CollabDocumentState = {
  doc: Y.Doc | null;
  provider: CollabProvider | null;
  status: CollabConnectionStatus;
  mode: CollabMode | null;
  /** room 내용(시드 포함)과 재적용이 준비됐다. 편집기를 그려도 된다. */
  ready: boolean;
  needsStaticFallback: boolean;
  isSaver: boolean;
  /** 커서·참여자 표시에 쓸 본인 정보(토큰 응답 기준). 편집기 CollaborationCaret에 그대로 넘긴다. */
  user: CollabUser & { userId?: string };
  /** reset·epoch 변경으로 문서를 새로 만들 때마다 오른다(편집기 key). */
  generation: number;
  /** 이 문서가 속한 room epoch. 저장 요청에 실어 복원 뒤의 옛 저장을 서버가 거부하게 한다. */
  epoch: number | null;
  /** 복원 준비로 편집이 잠시 멈췄다. */
  frozen: boolean;
  /** 최신 head 시드: loading(시도 중)·failed(재시도 대기)·stopped(멈춤). */
  seedState: "idle" | "loading" | "failed" | "stopped";
  seedMessage: string | null;
  retrySeed: () => void;
  /** 다시 적용 결과 안내: applied(자동 반영)·overlapped(겹친 부분을 둘 다 남김)·kept(반영 못 해 보관함에 남김). */
  rebaseNotice: CollabRebaseNotice;
  dismissRebaseNotice: () => void;
  hasUnsentChanges: () => boolean;
  /** 저장이 room 세대 불일치로 거부됐을 때: 새 토큰으로 다시 연결한다. */
  reconnect: () => void;
};

const OFFLINE_SEED_WAIT_MS = 4000;
const SEED_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
/** 재적용·saved 비교에서 내용이 아닌 표시용 칸. */
const INTERNAL_META_FIELDS = new Set([COLLAB_META_SEEDED, "savedHash", "headVersion", "operationId"]);

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
    if (INTERNAL_META_FIELDS.has(name)) continue;
    if (typeof value === "string" || typeof value === "number" || value === null) fields[name] = value as string | number | null;
  }
  return fields;
}

function readPmDoc(doc: Y.Doc): PmDoc {
  return yDocToProsemirrorJSON(doc, COLLAB_FRAGMENT) as PmDoc;
}

type RebaseJob = {
  base: PmDoc;
  mine: PmDoc;
  baseFields: MergeFields;
  mineFields: MergeFields;
  /** 재적용 전에 남긴 복구본 key. 반영되면 지운다. */
  recoveryKey: string | null;
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

type InternalState = Omit<CollabDocumentState, "generation" | "hasUnsentChanges" | "reconnect" | "retrySeed" | "dismissRebaseNotice">;

export function useCollabDocument(options: CollabDocumentOptions): CollabDocumentState {
  const { request, storageKey } = options;
  const ownerId = options.ownerId ?? null;
  const requestKey = request ? JSON.stringify(request) : null;
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const [generation, setGeneration] = useState(0);
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
    frozen: false,
    seedState: "idle",
    seedMessage: null,
    rebaseNotice: null,
  });
  const providerRef = useRef<CollabProvider | null>(null);
  const userRef = useRef<CollabUser & { userId?: string }>(options.user);
  const resetReasonRef = useRef<"initial" | "reset">("initial");
  const jobRef = useRef<RebaseJob | null>(null);
  const retrySeedRef = useRef<() => void>(() => undefined);
  // 로그아웃 정리로 잠겼다가 같은 계정이 다시 로그인하면 기기 보관을 다시 연다.
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
    const gen = stored?.gen ?? 0;
    const doc = new Y.Doc();
    const confirmed = new Y.Doc();
    let persistence: Persistence | null = null;
    let confirmedPersistence: Persistence | null = null;
    let persistenceClosed = false;
    let provider: CollabProvider | null = null;
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    let seedRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let seedAttempts = 0;
    let persistenceLoaded = false;
    let seeding = false;
    let applyingJob = false;
    let syncedRecorded = Boolean(stored?.synced);
    const unsubscribers: Array<() => void> = [];
    const docName = owner ? collabDocDbName(owner, storageKey, gen) : null;
    const confirmedName = owner ? collabConfirmedDbName(owner, storageKey, gen) : null;

    const update = (patch: Partial<InternalState>) => {
      if (!disposed) setState((previous) => ({ ...previous, ...patch }));
    };

    const closePersistence = async () => {
      if (persistenceClosed) return;
      persistenceClosed = true;
      await Promise.all([persistence?.destroy(), confirmedPersistence?.destroy()].map((value) => value?.catch(() => undefined)));
    };

    const restart = async (nextEpoch: number) => {
      if (disposed) return;
      disposed = true;
      // 이 기기의 미확인 변경(서버 확인분 → 지금)을 새 room 위에 다시 적용할 작업으로 넘긴다.
      const base = readPmDoc(confirmed);
      const mine = readPmDoc(doc);
      const baseFields = readContentFields(confirmed);
      const mineFields = readContentFields(doc);
      let job: RebaseJob | null = null;
      let keepOldStore = false;
      if (provider?.mode !== "read" && hasLocalChanges(base, mine, baseFields, mineFields)) {
        // 재적용 전 안전 사본. 반영되면 지운다(L8: 변경이 없으면 만들지 않는다).
        const recoveryKey = saveCollabRecoveryCopy(owner, storageKey, doc, optionsRef.current.extensions, provider?.identity?.userId ?? null);
        job = { base, mine, baseFields, mineFields, recoveryKey };
        keepOldStore = recoveryKey === null;
      }
      writeStoredGeneration(owner, storageKey, { gen: nextEpoch, synced: false });
      provider?.destroy();
      providerRef.current = null;
      await closePersistence();
      // 복구본을 남기지 못했으면 옛 보관본을 지우지 않는다(같은 세대 이름이면 새 room과 섞이지 않게 아래에서 새 이름을 쓴다).
      // 같은 세대로 다시 시작하면(오프라인 첫 열기) 같은 이름을 다시 열게 되므로 반드시 지운다(내용은 job이 들고 있다).
      if (!keepOldStore || nextEpoch === gen) {
        if (docName) await deleteIndexedDb(docName).catch(() => undefined);
        if (confirmedName) await deleteIndexedDb(confirmedName).catch(() => undefined);
      }
      doc.destroy();
      confirmed.destroy();
      jobRef.current = job;
      resetReasonRef.current = "reset";
      setState((previous) => ({
        ...previous,
        doc: null,
        provider: null,
        ready: false,
        needsStaticFallback: false,
        isSaver: false,
        epoch: null,
        frozen: false,
        seedState: "idle",
        seedMessage: null,
      }));
      setGeneration((value) => value + 1);
    };

    const publishAwareness = () => {
      if (!provider) return;
      // freeze 동안에도 저장 담당 자격은 유지한다(room이 그 담당에게 checkpoint를 맡긴다). 일반 자동 저장은 form이 멈춘다.
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
      update({
        ready: seeded && !jobRef.current,
        needsStaticFallback: !seeded && provider?.mode === "read" && (provider.synced || provider.status === "solo" || provider.status === "offline"),
      });
    };

    const canWriteNow = () =>
      Boolean(provider) && provider!.mode === "write" && ((provider!.status === "connected" && provider!.synced) || provider!.status === "solo");

    /** 넘겨받은 재적용 작업을 새 room(시드 뒤)에 적용한다. */
    const applyJob = async () => {
      const job = jobRef.current;
      if (!job || applyingJob || disposed || !isCollabDocSeeded(doc) || !canWriteNow()) return;
      applyingJob = true;
      try {
        const lockName = `portal-collab-rebase:${owner ?? "anon"}:${storageKey}`;
        const result = await withRebaseLock(lockName, () => {
          if (disposed || doc.isDestroyed) return null;
          // theirs는 적용 직전 같은 tick에 live doc에서 읽는다.
          const merged = mergeCollabDocuments({
            base: job.base,
            mine: job.mine,
            theirs: readPmDoc(doc),
            baseFields: job.baseFields,
            mineFields: job.mineFields,
            theirsFields: readContentFields(doc),
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
          return merged;
        });
        if (disposed || !result) return;
        jobRef.current = null;
        removeStorageItem(job.recoveryKey);
        update({ rebaseNotice: result.changed ? (result.conflicts > 0 ? "overlapped" : "applied") : null });
      } catch {
        // 적용하지 못하면 복구본이 남아 있다(보관함).
        jobRef.current = null;
        update({ rebaseNotice: job.recoveryKey ? "kept" : null });
      } finally {
        applyingJob = false;
        refreshReady();
      }
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
        const seed = await Promise.resolve(optionsRef.current.getSeed(resetReasonRef.current, { online })).catch(() => null);
        if (disposed) return;
        if (seed && "stop" in seed) {
          update({ seedState: "stopped", seedMessage: seed.stop });
          return;
        }
        // 옛 head(복원 전)를 새 세대 room에 시드하지 않는다.
        const roomEpoch = provider.epoch;
        if (!seed || (typeof seed.lifecycle === "number" && roomEpoch !== null && seed.lifecycle !== roomEpoch)) {
          update({ seedState: "failed", seedMessage: "최신 내용을 불러오지 못했습니다. 잠시 뒤 다시 시도합니다." });
          scheduleSeedRetry();
          return;
        }
        if (!isCollabDocSeeded(doc)) {
          seedCollabDoc(doc, seed, optionsRef.current.extensions());
          // 오프라인 첫 열기의 시드는 서버 head에서 만든 것이므로 서버 확인분의 기준(base)으로도 둔다.
          // 다시 연결하면 이 base 위의 입력만 서버 상태에 다시 적용한다(본문 이중 시드 방지).
          if (offlineFirst) Y.applyUpdate(confirmed, buildCollabSeedUpdate(seed, optionsRef.current.extensions()), "seed");
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
          if (mine) void closePersistence();
        }),
      );
    }

    void (async () => {
      if (docName && confirmedName && owner && rememberCollabDbName(owner, docName) && rememberCollabDbName(owner, confirmedName)) {
        [persistence, confirmedPersistence] = await Promise.all([openPersistence(docName, doc), openPersistence(confirmedName, confirmed)]);
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
        localEpoch: stored ? gen : null,
        confirmed,
        // 서버와 한 번도 맞춘 적 없는 기기 상태(오프라인 첫 열기 선시드)는 room에 바로 합치지 않는다.
        shouldHold: () => !syncedRecorded && isCollabDocSeeded(doc),
      });
      providerRef.current = provider;
      update({ doc, provider, status: provider.status, mode: provider.mode });
      unsubscribers.push(
        provider.on("status", (status) => {
          if (status === "connected" && provider?.synced && provider.epoch !== null && !syncedRecorded) {
            syncedRecorded = true;
            writeStoredGeneration(owner, storageKey, { gen: provider.epoch, synced: true });
          }
          // epoch는 room hello로 확인한 값만 쓴다(저장 요청에 실어 복원 뒤의 옛 저장을 막는다).
          update({ status, mode: provider?.mode ?? null, epoch: provider?.epoch ?? null });
          publishAwareness();
          void trySeed(false);
        }),
        provider.on("mode", (mode) => {
          update({ mode });
          publishAwareness();
          void trySeed(false);
        }),
        provider.on("reset", (nextEpoch) => void restart(nextEpoch)),
        provider.on("epoch", (nextEpoch) => void restart(nextEpoch)),
        provider.on("hold", (roomEpoch) => void restart(roomEpoch)),
        provider.on("freeze", () => {
          update({ frozen: true });
          publishAwareness();
        }),
        provider.on("thaw", () => {
          update({ frozen: false });
          publishAwareness();
        }),
        provider.on("flush", (id, mode) => {
          const handler = optionsRef.current.onFlush;
          const current = provider;
          if (!current) return;
          if (!handler) {
            current.sendFlushed({ id, ok: false });
            return;
          }
          void handler(mode)
            .catch((): CollabFlushResult => ({ ok: false }))
            .then((result) => {
              if (disposed || doc.isDestroyed) return;
              current.sendFlushed({ id, ok: result.ok, revision: result.revision, dirty: result.dirty, stateVector: Y.encodeStateVector(doc) });
            });
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
      const wasDisposed = disposed;
      disposed = true;
      if (offlineTimer) clearTimeout(offlineTimer);
      if (seedRetryTimer) clearTimeout(seedRetryTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
      if (wasDisposed) return;
      provider?.destroy();
      providerRef.current = null;
      void closePersistence();
      doc.destroy();
      confirmed.destroy();
    };
  }, [requestKey, storageKey, ownerId, generation, lockEpoch]);

  const hasUnsentChanges = useCallback(() => providerRef.current?.hasUnsentChanges() ?? false, []);
  const reconnect = useCallback(() => providerRef.current?.reconnect(), []);
  const retrySeed = useCallback(() => retrySeedRef.current(), []);
  const dismissRebaseNotice = useCallback(() => setState((previous) => ({ ...previous, rebaseNotice: null })), []);
  return { ...state, generation, hasUnsentChanges, reconnect, retrySeed, dismissRebaseNotice };
}
