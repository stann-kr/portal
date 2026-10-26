/**
 * @file src/lib/hooks/useDocumentServerDraftSync.ts
 * @description 계정 귀속 서버 초안의 CAS 저장, 오프라인 재시도, 명시적 충돌 선택을 관리한다.
 */
"use client";

import { useCallback, useEffect, useInsertionEffect, useRef, useState } from "react";
import {
  discardDocumentServerDraft,
  readDocumentServerDraft,
  saveDocumentServerDraft,
} from "@/lib/actions/documentDrafts";
import type { DocumentServerDraftSnapshot } from "@/lib/document-server-draft-contract";
import {
  canonicalizeDocumentServerDraftPayload,
  serializeDocumentServerDraftPayload,
} from "@/lib/document-server-draft-contract";
import {
  DOCUMENT_SERVER_DRAFT_QUEUE_CHANGE_EVENT,
  enqueueDocumentServerDraftDiscard,
  enqueueDocumentServerDraftUpsert,
  getOrCreateDocumentServerDraftDeviceId,
  readQueuedDocumentServerDraft,
  removeQueuedDocumentServerDraftIfUnchanged,
  type QueuedDocumentServerDraft,
} from "@/lib/document-server-draft-queue";
import {
  createDocumentServerDraftQueueKey,
  createFormDraftRecoveryPreview,
  parseDocumentDraftKey,
  type FormDraftRecoveryPreview,
} from "@/lib/form-draft";
import {
  ACCOUNT_TERMINAL_LOCK_EVENT,
  createAccountTerminalLockStorageKey,
  isAccountOwnerTerminallyLocked,
  isAccountTerminalLockEventForOwner,
} from "@/lib/account-terminal-lock";
import { getDocumentServerDraftPollDelay } from "@/lib/document-server-draft-polling";

const SERVER_DRAFT_DEBOUNCE_MS = 1_200;
const SERVER_DRAFT_MAX_WAIT_MS = 5_000;
const SERVER_DRAFT_MAX_DISCARD_REBASES = 3;

export type DocumentServerDraftSyncStatus =
  | "idle"
  | "loading"
  | "queued"
  | "syncing"
  | "synced"
  | "offline"
  | "remote-available"
  | "conflict"
  | "error";

export type DocumentServerDraftSyncResult = {
  status: DocumentServerDraftSyncStatus;
  remoteDraft: DocumentServerDraftSnapshot | null;
  remotePreview: FormDraftRecoveryPreview | null;
  localPreview: FormDraftRecoveryPreview | null;
  queuedPreview: FormDraftRecoveryPreview | null;
  isDifferentDevice: boolean;
  /** 서버본을 현재 폼과 이 기기 canonical 초안에 명시적으로 적용한다. */
  useRemoteDraft: () => void;
  /** 현재 폼을 최신 서버 version 기준으로 명시적으로 다시 저장한다. */
  keepLocalDraft: () => void;
  /** 보관된 이전 요청의 원문을 명시적으로 폼에 복원한다. 서버에는 아직 쓰지 않는다. */
  restoreQueuedDraft: () => void;
  /** 계정 귀속 서버본만 명시적으로 폐기한다. */
  discardRemoteDraft: () => void;
  refresh: () => Promise<void>;
};

type LocalDraftState<T> = {
  data: T;
  payloadJson: string;
  payloadHash: string;
  baseResourceVersion: number | null;
};

type ClearServerDraftReason = "empty" | "discard" | "submitted";

export type DocumentServerDraftSyncController<T> =
  DocumentServerDraftSyncResult & {
    observeLocalDraft: (data: T) => void;
    clearLocalDraft: (reason: ClearServerDraftReason, submitted?: {
      submittedData?: T;
      submittedAliases?: readonly T[];
    }) => void;
  };

function parsePayloadData<T>(payloadJson: string): T | null {
  const payload = canonicalizeDocumentServerDraftPayload(payloadJson);
  return payload ? payload.data as T : null;
}

function readBaseResourceVersion(data: unknown): number | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const value = (data as Record<string, unknown>).baseRevision;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;
}

function createLocalDraftState<T>(data: T): LocalDraftState<T> {
  const payloadJson = serializeDocumentServerDraftPayload(data);
  const payload = canonicalizeDocumentServerDraftPayload(payloadJson);
  if (!payload) throw new TypeError("서버 초안 payload를 직렬화할 수 없습니다.");
  return {
    data,
    payloadJson,
    payloadHash: payload.payloadHash,
    baseResourceVersion: readBaseResourceVersion(data),
  };
}

function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function requiresLegacyDraftChoice(queue: QueuedDocumentServerDraft | null | undefined): boolean {
  return queue?.operationType === "UPSERT" && queue.expectedDraftVersion > 0 && !queue.expectedPayloadHash;
}

function notifyQueueChange(sourceKey: string): void {
  try {
    window.dispatchEvent(
      new CustomEvent(DOCUMENT_SERVER_DRAFT_QUEUE_CHANGE_EVENT, {
        detail: { sourceKey },
      }),
    );
  } catch {
    // localStorage 자체가 durable source of truth이므로 같은 탭 힌트 실패는 무시한다.
  }
}

export function useDocumentServerDraftSync<T>(
  sourceKey: string,
  onApplyRemote: (draft: T) => void,
): DocumentServerDraftSyncController<T> {
  const [status, setStatus] = useState<DocumentServerDraftSyncStatus>("loading");
  const [remoteDraft, setRemoteDraft] =
    useState<DocumentServerDraftSnapshot | null>(null);
  // 화면에 쓰는 로컬 초안 정보는 localDraftRef와 같은 시점에 state로 반영한다.
  const [localDraftView, setLocalDraftView] = useState<{
    preview: FormDraftRecoveryPreview;
    payloadHash: string;
  } | null>(null);
  const [queuedRecovery, setQueuedRecovery] = useState<QueuedDocumentServerDraft | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const ownerId = parseDocumentDraftKey(sourceKey)?.ownerId ?? "";
  const sourceGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const readyRef = useRef(false);
  const choiceRequiredRef = useRef(false);
  const remoteDraftRef = useRef<DocumentServerDraftSnapshot | null>(null);
  const localDraftRef = useRef<LocalDraftState<T> | null>(null);
  const localDraftSourceRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const terminalLockedOwnerRef = useRef<string | null>(null);
  const onApplyRemoteRef = useRef(onApplyRemote);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const drainingGenerationRef = useRef<number | null>(null);
  const mutationEpochRef = useRef(0);
  const refreshRequestedRef = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  // insertion effect는 같은 commit의 모든 layout/passive effect·이벤트보다 먼저 실행된다.
  useInsertionEffect(() => {
    onApplyRemoteRef.current = onApplyRemote;
  }, [onApplyRemote]);

  const updateLocalDraftView = useCallback((local: LocalDraftState<T> | null) => {
    setLocalDraftView(local
      ? {
          preview: createFormDraftRecoveryPreview(local.data),
          payloadHash: local.payloadHash,
        }
      : null);
  }, []);

  const clearTimers = useCallback(() => {
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
    if (maxWaitTimerRef.current !== null) clearTimeout(maxWaitTimerRef.current);
    debounceTimerRef.current = null;
    maxWaitTimerRef.current = null;
  }, []);

  const updateRemote = useCallback((draft: DocumentServerDraftSnapshot | null) => {
    remoteDraftRef.current = draft;
    if (mountedRef.current) setRemoteDraft(draft);
  }, []);

  const updateQueuedRecovery = useCallback((queue?: QueuedDocumentServerDraft | null) => {
    if (mountedRef.current) setQueuedRecovery(queue && requiresLegacyDraftChoice(queue) ? queue : null);
  }, []);

  const isOwnerTerminallyLocked = useCallback(() => {
    if (!ownerId) return false;
    if (terminalLockedOwnerRef.current === ownerId) return true;
    try {
      return isAccountOwnerTerminallyLocked(window.localStorage, ownerId);
    } catch {
      return false;
    }
  }, [ownerId]);

  const purgeTerminallyLockedOwner = useCallback(() => {
    terminalLockedOwnerRef.current = ownerId;
    sourceGenerationRef.current += 1;
    readyRef.current = false;
    choiceRequiredRef.current = false;
    clearTimers();
    remoteDraftRef.current = null;
    localDraftRef.current = null;
    localDraftSourceRef.current = null;
    deviceIdRef.current = null;
    if (mountedRef.current) {
      setRemoteDraft(null);
      setLocalDraftView(null);
      setQueuedRecovery(null);
      setDeviceId(null);
      setStatus("idle");
    }
  }, [clearTimers, ownerId]);

  const allowOwnerPersistence = useCallback(() => {
    if (!isOwnerTerminallyLocked()) return true;
    purgeTerminallyLockedOwner();
    return false;
  }, [isOwnerTerminallyLocked, purgeTerminallyLockedOwner]);

  const evaluateState = useCallback(
    (draft: DocumentServerDraftSnapshot | null, queue?: QueuedDocumentServerDraft | null) => {
      if (!mountedRef.current) return;
      updateQueuedRecovery(queue);
      const local = localDraftRef.current;
      if (queue) {
        const requiresChoice = queue.operationType === "UPSERT" && (
          choiceRequiredRef.current ||
          requiresLegacyDraftChoice(queue) ||
          Boolean(
            draft &&
              draft.payloadHash !== queue.payloadHash &&
              (queue.expectedDraftVersion !== draft.draftVersion || queue.expectedPayloadHash !== draft.payloadHash),
          )
        );
        choiceRequiredRef.current = requiresChoice;
        if (isBrowserOffline()) {
          setStatus("offline");
          return;
        }
        setStatus(requiresChoice ? "conflict" : "queued");
        return;
      }
      if (!draft) {
        choiceRequiredRef.current = Boolean(local);
        setStatus(local ? "conflict" : "idle");
        return;
      }
      if (!local) {
        choiceRequiredRef.current = true;
        setStatus("remote-available");
        return;
      }
      const isSynced = draft.payloadHash === local.payloadHash;
      choiceRequiredRef.current = !isSynced;
      setStatus(isSynced ? "synced" : "conflict");
    },
    [updateQueuedRecovery],
  );

  const rebaseNewerQueue = useCallback(
    (
      current: ReturnType<typeof readQueuedDocumentServerDraft>,
      serverDraft: DocumentServerDraftSnapshot | null,
      mayRebaseUpsert: boolean,
    ) => {
      if (!current || requiresLegacyDraftChoice(current.entry)) return;
      if (
        current.entry.operationType === "UPSERT" &&
        serverDraft?.payloadHash === current.entry.payloadHash
      ) {
        removeQueuedDocumentServerDraftIfUnchanged(
          window.localStorage,
          sourceKey,
          current.raw,
        );
        notifyQueueChange(sourceKey);
        return;
      }
      const expectedDraftVersion = serverDraft?.draftVersion ?? 0;
      if (current.entry.operationType === "DISCARD") {
        // 이전 요청의 응답은 이후에 생긴 삭제 의도를 완료한 증거가 아니다.
        if (!serverDraft || !current.entry.targetPayloadHashes?.includes(serverDraft.payloadHash)) return;
        if (current.entry.expectedDraftVersion === expectedDraftVersion) return;
        enqueueDocumentServerDraftDiscard(window.localStorage, {
          sourceKey,
          expectedDraftVersion,
          conflictCount: current.entry.conflictCount,
          targetPayloadHashes: current.entry.targetPayloadHashes,
        });
      } else {
        if (!mayRebaseUpsert || current.entry.expectedDraftVersion === expectedDraftVersion ||
          localDraftRef.current?.payloadHash !== current.entry.payloadHash) return;
        const data = parsePayloadData<unknown>(current.entry.payloadJson);
        if (!data) return;
        enqueueDocumentServerDraftUpsert(window.localStorage, {
          sourceKey,
          data,
          expectedDraftVersion,
          expectedPayloadHash: serverDraft?.payloadHash,
          baseResourceVersion: current.entry.baseResourceVersion,
          writerDeviceId: current.entry.writerDeviceId,
          conflictCount: current.entry.conflictCount,
        });
      }
      notifyQueueChange(sourceKey);
    },
    [sourceKey],
  );

  const drain = useCallback(async () => {
    if (!readyRef.current || !mountedRef.current || !allowOwnerPersistence()) {
      return;
    }
    const generation = sourceGenerationRef.current;
    if (drainingGenerationRef.current === generation) return;
    clearTimers();
    let queued: ReturnType<typeof readQueuedDocumentServerDraft>;
    try {
      queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
    } catch {
      setStatus("error");
      return;
    }
    if (!queued) {
      evaluateState(remoteDraftRef.current, null);
      return;
    }
    if (
      queued.entry.operationType === "UPSERT" &&
      (choiceRequiredRef.current || requiresLegacyDraftChoice(queued.entry))
    ) {
      evaluateState(remoteDraftRef.current, queued.entry);
      return;
    }
    if (isBrowserOffline()) {
      setStatus("offline");
      return;
    }

    drainingGenerationRef.current = generation;
    mutationEpochRef.current += 1;
    setStatus("syncing");
    try {
      if (!allowOwnerPersistence()) return;
      const result = queued.entry.operationType === "UPSERT"
        ? await saveDocumentServerDraft({
            sourceKey,
            operationId: queued.entry.operationId,
            expectedDraftVersion: queued.entry.expectedDraftVersion,
            expectedPayloadHash: queued.entry.expectedPayloadHash,
            payloadJson: queued.entry.payloadJson,
            baseResourceVersion: queued.entry.baseResourceVersion,
            writerDeviceId: queued.entry.writerDeviceId,
          })
        : await discardDocumentServerDraft({
            sourceKey,
            operationId: queued.entry.operationId,
            expectedDraftVersion: queued.entry.expectedDraftVersion,
            targetPayloadHashes: queued.entry.targetPayloadHashes,
          });
      if (
        !mountedRef.current ||
        generation !== sourceGenerationRef.current ||
        !allowOwnerPersistence()
      ) return;

      if (result.ok) {
        updateRemote(result.current);
        const removed = removeQueuedDocumentServerDraftIfUnchanged(
          window.localStorage,
          sourceKey,
          queued.raw,
        );
        if (removed) notifyQueueChange(sourceKey);
        const newer = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
        if (newer) {
          const ownResult = queued.entry.operationType === "UPSERT"
            ? result.current?.payloadHash === queued.entry.payloadHash
            : result.current === null;
          rebaseNewerQueue(newer, result.current, ownResult);
          const rebased = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
          evaluateState(result.current, rebased?.entry ?? null);
          if (rebased) setTimeout(() => void drainRef.current(), 0);
        } else {
          evaluateState(result.current, null);
        }
        return;
      }

      updateRemote(result.current);
      const currentQueue = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      if (currentQueue?.raw !== queued.raw) {
        rebaseNewerQueue(currentQueue, result.current, false);
        const remaining = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
        evaluateState(result.current, remaining?.entry);
        if (remaining && !choiceRequiredRef.current) setTimeout(() => void drainRef.current(), 0);
        return;
      }
      if (
        result.reason === "VERSION_CONFLICT" &&
        queued.entry.operationType === "DISCARD" &&
        result.current &&
        queued.entry.targetPayloadHashes?.includes(result.current.payloadHash) &&
        queued.entry.conflictCount < SERVER_DRAFT_MAX_DISCARD_REBASES
      ) {
        enqueueDocumentServerDraftDiscard(window.localStorage, {
          sourceKey,
          expectedDraftVersion: result.current?.draftVersion ?? 0,
          conflictCount: queued.entry.conflictCount + 1,
          targetPayloadHashes: queued.entry.targetPayloadHashes,
        });
        notifyQueueChange(sourceKey);
        setStatus("queued");
        setTimeout(() => void drainRef.current(), 0);
        return;
      }
      if (result.reason === "VERSION_CONFLICT" && queued.entry.operationType === "DISCARD") {
        removeQueuedDocumentServerDraftIfUnchanged(window.localStorage, sourceKey, queued.raw);
        notifyQueueChange(sourceKey);
        evaluateState(result.current, null);
        return;
      }
      if (
        result.reason === "VERSION_CONFLICT" ||
        result.reason === "OPERATION_PAYLOAD_CONFLICT"
      ) {
        choiceRequiredRef.current = true;
      }
      setStatus(
        result.reason === "VERSION_CONFLICT" ||
          result.reason === "OPERATION_PAYLOAD_CONFLICT"
          ? "conflict"
          : "error",
      );
    } catch {
      if (!allowOwnerPersistence()) return;
      if (!mountedRef.current || generation !== sourceGenerationRef.current) return;
      setStatus(isBrowserOffline() ? "offline" : "error");
    } finally {
      if (drainingGenerationRef.current === generation) drainingGenerationRef.current = null;
      if (mountedRef.current && generation === sourceGenerationRef.current && refreshRequestedRef.current) {
        refreshRequestedRef.current = false;
        queueMicrotask(() => void refreshRef.current());
      }
    }
  }, [
    allowOwnerPersistence,
    clearTimers,
    evaluateState,
    rebaseNewerQueue,
    sourceKey,
    updateRemote,
  ]);
  useInsertionEffect(() => {
    drainRef.current = drain;
  }, [drain]);

  const scheduleDrain = useCallback(() => {
    if (!readyRef.current || !allowOwnerPersistence()) return;
    if (isBrowserOffline()) {
      if (mountedRef.current) setStatus("offline");
      return;
    }
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => void drainRef.current(), SERVER_DRAFT_DEBOUNCE_MS);
    if (maxWaitTimerRef.current === null) {
      maxWaitTimerRef.current = setTimeout(
        () => void drainRef.current(),
        SERVER_DRAFT_MAX_WAIT_MS,
      );
    }
    if (mountedRef.current) setStatus("queued");
  }, [allowOwnerPersistence]);

  const refresh = useCallback(async () => {
    if (!allowOwnerPersistence()) return;
    if (drainingGenerationRef.current === sourceGenerationRef.current) {
      refreshRequestedRef.current = true;
      return;
    }
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const generation = sourceGenerationRef.current;
    const mutationEpoch = mutationEpochRef.current;
    const task = (async () => {
      try {
        if (!allowOwnerPersistence()) return;
        const result = await readDocumentServerDraft(sourceKey);
        if (
          !mountedRef.current ||
          generation !== sourceGenerationRef.current ||
          !allowOwnerPersistence()
        ) return;
        if (mutationEpoch !== mutationEpochRef.current || drainingGenerationRef.current === generation) {
          refreshRequestedRef.current = true;
          return;
        }
        readyRef.current = true;
        const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
        updateQueuedRecovery(queued?.entry);
        if (!result.ok) {
          setStatus("error");
          return;
        }
        updateRemote(result.draft);
        if (
          queued?.entry.operationType === "UPSERT" &&
          !requiresLegacyDraftChoice(queued.entry) &&
          result.draft?.payloadHash === queued.entry.payloadHash
        ) {
          removeQueuedDocumentServerDraftIfUnchanged(
            window.localStorage,
            sourceKey,
            queued.raw,
          );
          notifyQueueChange(sourceKey);
        } else if (queued?.entry.operationType === "DISCARD" && !result.draft) {
          removeQueuedDocumentServerDraftIfUnchanged(
            window.localStorage,
            sourceKey,
            queued.raw,
          );
          notifyQueueChange(sourceKey);
        }
        const remaining = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
        evaluateState(result.draft, remaining?.entry ?? null);
        if (remaining && !isBrowserOffline()) void drainRef.current();
      } catch {
        if (!allowOwnerPersistence()) return;
        if (!mountedRef.current || generation !== sourceGenerationRef.current) return;
        readyRef.current = true;
        const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
        updateQueuedRecovery(queued?.entry);
        setStatus(queued && isBrowserOffline() ? "offline" : "error");
      }
    })();
    refreshPromiseRef.current = task;
    try {
      await task;
    } finally {
      if (refreshPromiseRef.current === task) refreshPromiseRef.current = null;
      if (mountedRef.current && generation === sourceGenerationRef.current &&
        drainingGenerationRef.current !== generation && refreshRequestedRef.current) {
        refreshRequestedRef.current = false;
        queueMicrotask(() => void refreshRef.current());
      }
    }
  }, [allowOwnerPersistence, evaluateState, sourceKey, updateQueuedRecovery, updateRemote]);
  useInsertionEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const observeLocalDraft = useCallback(
    (data: T) => {
      if (!allowOwnerPersistence()) return;
      try {
        const local = createLocalDraftState(data);
        localDraftRef.current = local;
        localDraftSourceRef.current = sourceKey;
        if (mountedRef.current) updateLocalDraftView(local);
        const current = remoteDraftRef.current;
        const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
        // canonical 복원본과 다른 고유 원문도 명시적 선택 전에는 교체하지 않는다.
        if (requiresLegacyDraftChoice(queued?.entry)) {
          evaluateState(current, queued?.entry);
          return;
        }
        if (current?.payloadHash === local.payloadHash) {
          choiceRequiredRef.current = false;
          if (queued?.entry.operationType === "UPSERT" && queued.entry.payloadHash === local.payloadHash) {
            removeQueuedDocumentServerDraftIfUnchanged(
              window.localStorage,
              sourceKey,
              queued.raw,
            );
            notifyQueueChange(sourceKey);
          }
          if (mountedRef.current) setStatus("synced");
          return;
        }
        if (choiceRequiredRef.current) {
          evaluateState(current, queued?.entry ?? null);
          return;
        }
        const writerDeviceId = deviceIdRef.current ??
          getOrCreateDocumentServerDraftDeviceId(window.localStorage, ownerId);
        deviceIdRef.current = writerDeviceId;
        if (mountedRef.current) setDeviceId(writerDeviceId);
        enqueueDocumentServerDraftUpsert(window.localStorage, {
          sourceKey,
          data,
          expectedDraftVersion:
            current?.draftVersion ?? queued?.entry.expectedDraftVersion ?? 0,
          expectedPayloadHash: current?.payloadHash ?? (queued?.entry.operationType === "UPSERT" ? queued.entry.expectedPayloadHash : undefined),
          baseResourceVersion: local.baseResourceVersion,
          writerDeviceId,
        });
        notifyQueueChange(sourceKey);
        scheduleDrain();
      } catch {
        if (mountedRef.current) setStatus("error");
      }
    },
    [allowOwnerPersistence, evaluateState, ownerId, scheduleDrain, sourceKey, updateLocalDraftView],
  );

  const clearLocalDraft = useCallback(
    (reason: ClearServerDraftReason, submitted?: { submittedData?: T; submittedAliases?: readonly T[] }) => {
      if (!allowOwnerPersistence()) return;
      const local = localDraftRef.current;
      const hadLocalDraft = local !== null;
      let targetPayloadHashes: string[];
      try {
        const data = submitted?.submittedData ?? local?.data;
        targetPayloadHashes = data === undefined ? [] : [...new Set(
          [data, ...(submitted?.submittedAliases ?? [])].map((value) => createLocalDraftState(value).payloadHash),
        )];
      } catch {
        if (mountedRef.current) setStatus("error");
        return;
      }
      // 성공 응답을 기다리는 동안 생긴 다른 로컬 작성본도 제출 정리의 대상이 아니다.
      if (reason === "submitted" && local && !targetPayloadHashes.includes(local.payloadHash)) return;
      localDraftRef.current = null;
      localDraftSourceRef.current = null;
      if (mountedRef.current) setLocalDraftView(null);
      clearTimers();
      try {
        const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
        if (requiresLegacyDraftChoice(queued?.entry)) {
          evaluateState(remoteDraftRef.current, queued?.entry);
          return;
        }
        if (reason === "empty" && choiceRequiredRef.current) {
          if (queued?.entry.operationType === "UPSERT" && targetPayloadHashes.includes(queued.entry.payloadHash)) {
            removeQueuedDocumentServerDraftIfUnchanged(
              window.localStorage,
              sourceKey,
              queued.raw,
            );
            notifyQueueChange(sourceKey);
          }
          evaluateState(remoteDraftRef.current, readQueuedDocumentServerDraft(window.localStorage, sourceKey)?.entry);
          return;
        }
        if (reason === "empty" && !hadLocalDraft) {
          evaluateState(remoteDraftRef.current, queued?.entry ?? null);
          return;
        }
        choiceRequiredRef.current = false;
        if (queued?.entry.operationType === "UPSERT" && !targetPayloadHashes.includes(queued.entry.payloadHash)) {
          evaluateState(remoteDraftRef.current, queued.entry);
          return;
        }
        const remote = remoteDraftRef.current;
        if (targetPayloadHashes.length === 0 || (remote && !targetPayloadHashes.includes(remote.payloadHash) &&
          drainingGenerationRef.current !== sourceGenerationRef.current)) {
          if (queued?.entry.operationType === "UPSERT") {
            removeQueuedDocumentServerDraftIfUnchanged(window.localStorage, sourceKey, queued.raw);
            notifyQueueChange(sourceKey);
          }
          evaluateState(remote, readQueuedDocumentServerDraft(window.localStorage, sourceKey)?.entry);
          return;
        }
        enqueueDocumentServerDraftDiscard(window.localStorage, {
          sourceKey,
          targetPayloadHashes,
          expectedDraftVersion:
            remoteDraftRef.current?.draftVersion ??
            queued?.entry.expectedDraftVersion ??
            0,
        });
        notifyQueueChange(sourceKey);
        if (mountedRef.current) setStatus(isBrowserOffline() ? "offline" : "queued");
        if (readyRef.current && !isBrowserOffline()) void drainRef.current();
      } catch {
        if (mountedRef.current) setStatus("error");
      }
    },
    [allowOwnerPersistence, clearTimers, evaluateState, sourceKey],
  );

  const restoreQueuedDraft = useCallback(() => {
    if (!allowOwnerPersistence() || queuedRecovery?.operationType !== "UPSERT" ||
      queuedRecovery.sourceKey !== sourceKey) return;
    try {
      const current = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      // 화면에 표시한 원문과 달라졌다면 새 내용을 먼저 보여 주고 다시 선택받는다.
      if (!requiresLegacyDraftChoice(current?.entry) || current?.entry.operationType !== "UPSERT" ||
        current.entry.operationId !== queuedRecovery.operationId ||
        current.entry.payloadHash !== queuedRecovery.payloadHash) {
        evaluateState(remoteDraftRef.current, current?.entry);
        return;
      }
      const data = parsePayloadData<T>(current.entry.payloadJson);
      if (!data) return;
      clearTimers();
      const local = createLocalDraftState(data);
      localDraftRef.current = local;
      localDraftSourceRef.current = sourceKey;
      updateLocalDraftView(local);
      onApplyRemoteRef.current(data);
      evaluateState(remoteDraftRef.current, current.entry);
    } catch {
      setStatus("error");
    }
  }, [allowOwnerPersistence, clearTimers, evaluateState, queuedRecovery, sourceKey, updateLocalDraftView]);

  const useRemoteDraft = useCallback(() => {
    if (!allowOwnerPersistence()) return;
    const remote = remoteDraftRef.current;
    if (!remote) return;
    const data = parsePayloadData<T>(remote.payloadJson);
    if (!data) {
      setStatus("error");
      return;
    }
    clearTimers();
    choiceRequiredRef.current = false;
    try {
      const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      if (queued) {
        removeQueuedDocumentServerDraftIfUnchanged(
          window.localStorage,
          sourceKey,
          queued.raw,
        );
        notifyQueueChange(sourceKey);
      }
      const local = createLocalDraftState(data);
      localDraftRef.current = local;
      localDraftSourceRef.current = sourceKey;
      updateLocalDraftView(local);
      onApplyRemoteRef.current(data);
      setStatus("synced");
    } catch {
      setStatus("error");
    }
  }, [allowOwnerPersistence, clearTimers, sourceKey, updateLocalDraftView]);

  const keepLocalDraft = useCallback(() => {
    if (!allowOwnerPersistence()) return;
    const local = localDraftRef.current;
    if (!local) return;
    choiceRequiredRef.current = false;
    try {
      const writerDeviceId = deviceIdRef.current ??
        getOrCreateDocumentServerDraftDeviceId(window.localStorage, ownerId);
      deviceIdRef.current = writerDeviceId;
      setDeviceId(writerDeviceId);
      enqueueDocumentServerDraftUpsert(window.localStorage, {
        sourceKey,
        data: local.data,
        expectedDraftVersion: remoteDraftRef.current?.draftVersion ?? 0,
        expectedPayloadHash: remoteDraftRef.current?.payloadHash,
        baseResourceVersion: local.baseResourceVersion,
        writerDeviceId,
      });
      notifyQueueChange(sourceKey);
      setStatus(isBrowserOffline() ? "offline" : "queued");
      if (readyRef.current && !isBrowserOffline()) void drainRef.current();
    } catch {
      setStatus("error");
    }
  }, [allowOwnerPersistence, ownerId, sourceKey]);

  const discardRemoteDraft = useCallback(() => {
    if (!allowOwnerPersistence()) return;
    choiceRequiredRef.current = false;
    try {
      const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      enqueueDocumentServerDraftDiscard(window.localStorage, {
        sourceKey,
        targetPayloadHashes: remoteDraftRef.current ? [remoteDraftRef.current.payloadHash] : undefined,
        expectedDraftVersion:
          remoteDraftRef.current?.draftVersion ??
          queued?.entry.expectedDraftVersion ??
          0,
      });
      notifyQueueChange(sourceKey);
      setStatus(isBrowserOffline() ? "offline" : "queued");
      if (readyRef.current && !isBrowserOffline()) void drainRef.current();
    } catch {
      setStatus("error");
    }
  }, [allowOwnerPersistence, sourceKey]);

  useEffect(() => {
    mountedRef.current = true;
    if (terminalLockedOwnerRef.current !== ownerId) {
      terminalLockedOwnerRef.current = null;
    }
    sourceGenerationRef.current += 1;
    refreshPromiseRef.current = null;
    refreshRequestedRef.current = false;
    readyRef.current = false;
    choiceRequiredRef.current = false;
    remoteDraftRef.current = null;
    // 이 effect는 sourceKey별 서버 초안 구독과 localStorage(device id·queue) 읽기를 시작하는
    // 외부 시스템 동기화다. ref 초기화와 같은 시점에 state도 되돌려야 remount·source 전환에서
    // ref/state가 어긋나지 않으므로 render 단계로 옮길 수 없다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 초안 구독·localStorage 동기화 effect의 source별 초기화
    setRemoteDraft(null);
    setQueuedRecovery(null);
    if (localDraftSourceRef.current !== sourceKey) {
      localDraftRef.current = null;
      localDraftSourceRef.current = null;
      setLocalDraftView(null);
    } else if (localDraftRef.current) {
      updateLocalDraftView(localDraftRef.current);
    }
    setStatus("loading");
    const mayPersist = allowOwnerPersistence();
    if (mayPersist) {
      try {
        const nextDeviceId = getOrCreateDocumentServerDraftDeviceId(
          window.localStorage,
          ownerId,
        );
        deviceIdRef.current = nextDeviceId;
        setDeviceId(nextDeviceId);
        updateQueuedRecovery(readQueuedDocumentServerDraft(window.localStorage, sourceKey)?.entry);
      } catch {
        deviceIdRef.current = null;
        setDeviceId(null);
      }
    }

    const queueKey = createDocumentServerDraftQueueKey(sourceKey);
    const terminalLockKey = createAccountTerminalLockStorageKey(ownerId);
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let unchangedPolls = 0;
    let resumeQueued = false;
    const clearPollTimer = () => {
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
    };
    const remoteFingerprint = () => {
      const draft = remoteDraftRef.current;
      return draft ? `${draft.draftVersion}:${draft.payloadHash}` : "none";
    };
    const schedulePoll = () => {
      clearPollTimer();
      if (!active) return;
      const delay = getDocumentServerDraftPollDelay({
        visible: document.visibilityState !== "hidden",
        online: !isBrowserOffline(),
        unchangedPolls,
      });
      if (delay === null) return;
      pollTimer = setTimeout(() => {
        const before = remoteFingerprint();
        void refresh().finally(() => {
          if (!active) return;
          unchangedPolls = before === remoteFingerprint() ? unchangedPolls + 1 : 0;
          schedulePoll();
        });
      }, delay);
    };
    const resumeActiveSync = () => {
      clearPollTimer();
      unchangedPolls = 0;
      if (
        resumeQueued ||
        document.visibilityState === "hidden" ||
        isBrowserOffline()
      ) return;
      resumeQueued = true;
      queueMicrotask(() => {
        resumeQueued = false;
        if (!active || document.visibilityState === "hidden" || isBrowserOffline()) return;
        let queued: ReturnType<typeof readQueuedDocumentServerDraft>;
        try {
          queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
        } catch {
          setStatus("error");
          schedulePoll();
          return;
        }
        const operation = queued ? drainRef.current() : refresh();
        void operation.finally(schedulePoll);
      });
    };
    const handleOnline = () => {
      resumeActiveSync();
    };
    const handleFocus = () => {
      resumeActiveSync();
    };
    const handleOffline = () => {
      clearPollTimer();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") clearPollTimer();
      else resumeActiveSync();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === terminalLockKey) {
        if (!allowOwnerPersistence()) return;
      }
      if (event.key !== queueKey) return;
      if (!allowOwnerPersistence()) return;
      const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      evaluateState(remoteDraftRef.current, queued?.entry ?? null);
      unchangedPolls = 0;
      clearPollTimer();
      schedulePoll();
      if (queued && !isBrowserOffline()) {
        void drainRef.current().finally(schedulePoll);
      }
    };
    const handleQueueChange = (event: Event) => {
      if (!allowOwnerPersistence()) return;
      const detail = (event as CustomEvent<{ sourceKey?: string }>).detail;
      if (detail?.sourceKey !== sourceKey) return;
      const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      evaluateState(remoteDraftRef.current, queued?.entry ?? null);
      unchangedPolls = 0;
      clearPollTimer();
      schedulePoll();
    };
    const handleTerminalLock = (event: Event) => {
      if (!isAccountTerminalLockEventForOwner(event, ownerId)) return;
      clearPollTimer();
      purgeTerminallyLockedOwner();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener(ACCOUNT_TERMINAL_LOCK_EVENT, handleTerminalLock);
    window.addEventListener(DOCUMENT_SERVER_DRAFT_QUEUE_CHANGE_EVENT, handleQueueChange);
    if (mayPersist) void refresh().finally(schedulePoll);

    return () => {
      active = false;
      mountedRef.current = false;
      sourceGenerationRef.current += 1;
      clearTimers();
      clearPollTimer();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(ACCOUNT_TERMINAL_LOCK_EVENT, handleTerminalLock);
      window.removeEventListener(
        DOCUMENT_SERVER_DRAFT_QUEUE_CHANGE_EVENT,
        handleQueueChange,
      );
    };
  }, [
    allowOwnerPersistence,
    clearTimers,
    evaluateState,
    ownerId,
    purgeTerminallyLockedOwner,
    refresh,
    sourceKey,
    updateLocalDraftView,
    updateQueuedRecovery,
  ]);

  const localPreview = localDraftView?.preview ?? null;
  const remotePreview = remoteDraft
    ? createFormDraftRecoveryPreview(parsePayloadData<unknown>(remoteDraft.payloadJson))
    : null;
  const queuedPreview = queuedRecovery?.operationType === "UPSERT" &&
    queuedRecovery.sourceKey === sourceKey &&
    queuedRecovery.payloadHash !== localDraftView?.payloadHash
    ? createFormDraftRecoveryPreview(parsePayloadData<unknown>(queuedRecovery.payloadJson))
    : null;

  return {
    status,
    remoteDraft,
    remotePreview,
    localPreview,
    queuedPreview,
    isDifferentDevice: Boolean(
      remoteDraft && deviceId && remoteDraft.writerDeviceId !== deviceId,
    ),
    observeLocalDraft,
    clearLocalDraft,
    useRemoteDraft,
    keepLocalDraft,
    restoreQueuedDraft,
    discardRemoteDraft,
    refresh,
  };
}
