"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import type { AnyExtension } from "@tiptap/core";
import { CollabProvider, type CollabConnectionStatus, type CollabTokenRequest } from "./provider";
import { COLLAB_META, isCollabDocSeeded, seedCollabDoc, type CollabSeedInput } from "./seed";
import type { CollabMode } from "../protocol";

/**
 * 문서 하나의 공동 편집 상태: Y.Doc + 기기 보관(IndexedDB) + room 연결 + 시드 + 저장 담당 선출.
 *
 * - 쓰기 사용자는 서버와 동기화가 끝난 뒤(혼자 모드면 기기 보관을 읽은 뒤, 연결이 안 되면 잠시 기다린 뒤)
 *   room이 비어 있으면 head로 결정적 시드를 넣는다.
 * - 읽기 사용자는 시드를 넣지 않는다. room이 비어 있으면 `needsStaticFallback`으로 head HTML을 보여 준다.
 * - room이 비워지거나(reset) 기기 보관본의 epoch가 다르면 그 epoch의 보관본을 지우고 새로 시작한다.
 * - 저장 담당: `canSave`(쓰기 + 동기화 끝, 혼자 모드 포함)를 알린 사용자 중 clientID가 가장 작은 한 명.
 */
export type CollabUser = { name: string; colorIndex: number };

export type CollabDocumentOptions = {
  /** null이면 연결하지 않는다(예: 아직 키를 정하지 못함). */
  request: CollabTokenRequest | null;
  /** 기기 보관 이름에 쓰는 room key. */
  storageKey: string | null;
  user: CollabUser;
  extensions: () => AnyExtension[];
  /** 시드에 쓸 head. reset 뒤에는 최신 head를 다시 읽어 돌려준다. */
  getSeed: (reason: "initial" | "reset") => CollabSeedInput | null | Promise<CollabSeedInput | null>;
};

export type CollabDocumentState = {
  doc: Y.Doc | null;
  provider: CollabProvider | null;
  status: CollabConnectionStatus;
  mode: CollabMode | null;
  /** room 내용(시드 포함)이 준비됐다. 편집기를 그려도 된다. */
  ready: boolean;
  needsStaticFallback: boolean;
  isSaver: boolean;
  /** 커서·참여자 표시에 쓸 본인 정보(토큰 응답 기준). 편집기 CollaborationCaret에 그대로 넘긴다. */
  user: CollabUser & { userId?: string };
  /** reset·epoch 변경으로 문서를 새로 만들 때마다 오른다(편집기 key). */
  generation: number;
  hasUnsentChanges: () => boolean;
};

const OFFLINE_SEED_WAIT_MS = 4000;
const EPOCH_STORAGE_PREFIX = "portal-collab-epoch:";
const DB_PREFIX = "portal-collab:";

function readStoredEpoch(key: string): number {
  try {
    const value = Number(window.localStorage.getItem(`${EPOCH_STORAGE_PREFIX}${key}`));
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeStoredEpoch(key: string, epoch: number): void {
  try {
    window.localStorage.setItem(`${EPOCH_STORAGE_PREFIX}${key}`, String(epoch));
  } catch {
    // 저장소를 못 쓰면 다음 연결에서 다시 맞춘다.
  }
}

type Persistence = { whenSynced: Promise<unknown>; clearData(): Promise<void>; destroy(): Promise<void> };

async function openPersistence(name: string, doc: Y.Doc): Promise<Persistence | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const { IndexeddbPersistence } = await import("y-indexeddb");
    return new IndexeddbPersistence(name, doc) as unknown as Persistence;
  } catch {
    return null;
  }
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

export function useCollabDocument(options: CollabDocumentOptions): CollabDocumentState {
  const { request, storageKey } = options;
  const requestKey = request ? JSON.stringify(request) : null;
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<Omit<CollabDocumentState, "generation" | "hasUnsentChanges">>({
    doc: null,
    provider: null,
    status: "connecting",
    mode: null,
    ready: false,
    needsStaticFallback: false,
    isSaver: false,
    user: options.user,
  });
  const providerRef = useRef<CollabProvider | null>(null);
  const userRef = useRef<CollabUser & { userId?: string }>(options.user);
  const resetReasonRef = useRef<"initial" | "reset">("initial");

  useEffect(() => {
    if (!requestKey || !storageKey) return;
    const parsedRequest = JSON.parse(requestKey) as CollabTokenRequest;
    let disposed = false;
    const epoch = readStoredEpoch(storageKey);
    const doc = new Y.Doc();
    let persistence: Persistence | null = null;
    let provider: CollabProvider | null = null;
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    let persistenceLoaded = false;
    let seeding = false;
    const unsubscribers: Array<() => void> = [];

    const update = (patch: Partial<Omit<CollabDocumentState, "generation" | "hasUnsentChanges">>) => {
      if (!disposed) setState((previous) => ({ ...previous, ...patch }));
    };

    const restart = async (nextEpoch: number, reason: "reset" | "epoch") => {
      if (disposed) return;
      disposed = true;
      writeStoredEpoch(storageKey, nextEpoch);
      provider?.destroy();
      providerRef.current = null;
      try {
        await persistence?.clearData();
      } catch {
        // 지우지 못한 옛 보관본은 이름(epoch)이 달라 다시 합쳐지지 않는다.
      }
      doc.destroy();
      resetReasonRef.current = reason === "reset" ? "reset" : resetReasonRef.current;
      setState((previous) => ({ ...previous, doc: null, provider: null, ready: false, needsStaticFallback: false, isSaver: false }));
      setGeneration((value) => value + 1);
    };

    const publishAwareness = () => {
      if (!provider) return;
      const canSave = provider.mode === "write" && (provider.status === "solo" || (provider.status === "connected" && provider.synced));
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
        ready: seeded,
        needsStaticFallback: !seeded && provider?.mode === "read" && (provider.synced || provider.status === "solo" || provider.status === "offline"),
      });
    };

    const trySeed = async (force: boolean) => {
      if (disposed || seeding || !provider || provider.mode !== "write" || isCollabDocSeeded(doc)) {
        refreshReady();
        return;
      }
      const canSeedNow =
        (provider.status === "connected" && provider.synced) ||
        (provider.status === "solo" && persistenceLoaded) ||
        (force && persistenceLoaded);
      if (!canSeedNow) return;
      seeding = true;
      try {
        const seed = await optionsRef.current.getSeed(resetReasonRef.current);
        if (disposed) return;
        if (seed && !isCollabDocSeeded(doc)) seedCollabDoc(doc, seed, optionsRef.current.extensions());
      } finally {
        seeding = false;
        refreshReady();
      }
    };

    const meta = doc.getMap(COLLAB_META);
    const handleMeta = () => refreshReady();
    meta.observe(handleMeta);
    unsubscribers.push(() => meta.unobserve(handleMeta));

    void (async () => {
      persistence = await openPersistence(`${DB_PREFIX}${storageKey}:${epoch}`, doc);
      if (disposed) {
        await persistence?.destroy();
        return;
      }
      provider = new CollabProvider(doc, { request: parsedRequest, localEpoch: epoch });
      providerRef.current = provider;
      update({ doc, provider, status: provider.status, mode: provider.mode });
      unsubscribers.push(
        provider.on("status", (status) => {
          update({ status, mode: provider?.mode ?? null });
          publishAwareness();
          void trySeed(false);
        }),
        provider.on("mode", (mode) => {
          update({ mode });
          publishAwareness();
          void trySeed(false);
        }),
        provider.on("reset", (nextEpoch) => void restart(nextEpoch, "reset")),
        provider.on("epoch", (nextEpoch) => void restart(nextEpoch, "epoch")),
      );
      const handleAwareness = () => update({ isSaver: provider ? computeIsSaver(provider) : false });
      provider.awareness.on("change", handleAwareness);
      unsubscribers.push(() => provider?.awareness.off("change", handleAwareness));
      publishAwareness();
      if (persistence) {
        try {
          await persistence.whenSynced;
        } catch {
          // 보관본을 못 읽어도 서버 상태로 이어간다.
        }
      }
      if (disposed) return;
      persistenceLoaded = true;
      refreshReady();
      void trySeed(false);
      // 연결이 안 되는 채로 처음 연 문서는 잠시 기다린 뒤 기기 안에서 같은 결정적 시드로 시작한다.
      offlineTimer = setTimeout(() => void trySeed(true), OFFLINE_SEED_WAIT_MS);
    })();

    return () => {
      const wasDisposed = disposed;
      disposed = true;
      if (offlineTimer) clearTimeout(offlineTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
      if (wasDisposed) return;
      provider?.destroy();
      providerRef.current = null;
      void persistence?.destroy();
      doc.destroy();
    };
  }, [requestKey, storageKey, generation]);

  const hasUnsentChanges = useCallback(() => providerRef.current?.hasUnsentChanges() ?? false, []);
  return { ...state, generation, hasUnsentChanges };
}
