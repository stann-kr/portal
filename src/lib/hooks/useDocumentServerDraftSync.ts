/**
 * @file src/lib/hooks/useDocumentServerDraftSync.ts
 * @description 계정 귀속 서버 초안의 CAS 저장, 오프라인 재시도, 명시적 충돌 선택을 관리한다.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const SERVER_DRAFT_DEBOUNCE_MS = 1_200;
const SERVER_DRAFT_MAX_WAIT_MS = 5_000;
const SERVER_DRAFT_POLL_MS = 15_000;
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
  isDifferentDevice: boolean;
  /** 서버본을 현재 폼과 이 기기 canonical 초안에 명시적으로 적용한다. */
  useRemoteDraft: () => void;
  /** 현재 폼을 최신 서버 version 기준으로 명시적으로 다시 저장한다. */
  keepLocalDraft: () => void;
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
    clearLocalDraft: (reason: ClearServerDraftReason) => void;
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
  const [localPreview, setLocalPreview] =
    useState<FormDraftRecoveryPreview | null>(null);
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
  const onApplyRemoteRef = useRef(onApplyRemote);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainRef = useRef<() => Promise<void>>(async () => undefined);
  onApplyRemoteRef.current = onApplyRemote;

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

  const evaluateState = useCallback(
    (draft: DocumentServerDraftSnapshot | null, queue?: QueuedDocumentServerDraft | null) => {
      if (!mountedRef.current) return;
      const local = localDraftRef.current;
      if (queue) {
        const requiresChoice = queue.operationType === "UPSERT" && (
          choiceRequiredRef.current ||
          Boolean(
            draft &&
              draft.payloadHash !== queue.payloadHash &&
              queue.expectedDraftVersion !== draft.draftVersion,
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
    [],
  );

  const rebaseNewerQueue = useCallback(
    (
      current: ReturnType<typeof readQueuedDocumentServerDraft>,
      serverDraft: DocumentServerDraftSnapshot | null,
    ) => {
      if (!current) return;
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
      if (current.entry.expectedDraftVersion === expectedDraftVersion) return;
      if (current.entry.operationType === "DISCARD") {
        enqueueDocumentServerDraftDiscard(window.localStorage, {
          sourceKey,
          expectedDraftVersion,
          conflictCount: current.entry.conflictCount,
        });
      } else {
        const data = parsePayloadData<unknown>(current.entry.payloadJson);
        if (!data) return;
        enqueueDocumentServerDraftUpsert(window.localStorage, {
          sourceKey,
          data,
          expectedDraftVersion,
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
    if (!readyRef.current || !mountedRef.current) return;
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
      choiceRequiredRef.current
    ) {
      evaluateState(remoteDraftRef.current, queued.entry);
      return;
    }
    if (isBrowserOffline()) {
      setStatus("offline");
      return;
    }

    const generation = sourceGenerationRef.current;
    setStatus("syncing");
    try {
      const result = queued.entry.operationType === "UPSERT"
        ? await saveDocumentServerDraft({
            sourceKey,
            operationId: queued.entry.operationId,
            expectedDraftVersion: queued.entry.expectedDraftVersion,
            payloadJson: queued.entry.payloadJson,
            baseResourceVersion: queued.entry.baseResourceVersion,
            writerDeviceId: queued.entry.writerDeviceId,
          })
        : await discardDocumentServerDraft({
            sourceKey,
            operationId: queued.entry.operationId,
            expectedDraftVersion: queued.entry.expectedDraftVersion,
          });
      if (!mountedRef.current || generation !== sourceGenerationRef.current) return;

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
          rebaseNewerQueue(newer, result.current);
          const rebased = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
          evaluateState(result.current, rebased?.entry ?? null);
          if (rebased) setTimeout(() => void drainRef.current(), 0);
        } else {
          evaluateState(result.current, null);
        }
        return;
      }

      updateRemote(result.current);
      if (
        result.reason === "VERSION_CONFLICT" &&
        queued.entry.operationType === "DISCARD" &&
        queued.entry.conflictCount < SERVER_DRAFT_MAX_DISCARD_REBASES
      ) {
        enqueueDocumentServerDraftDiscard(window.localStorage, {
          sourceKey,
          expectedDraftVersion: result.current?.draftVersion ?? 0,
          conflictCount: queued.entry.conflictCount + 1,
        });
        notifyQueueChange(sourceKey);
        setStatus("queued");
        setTimeout(() => void drainRef.current(), 0);
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
      if (!mountedRef.current || generation !== sourceGenerationRef.current) return;
      setStatus(isBrowserOffline() ? "offline" : "error");
    }
  }, [clearTimers, evaluateState, rebaseNewerQueue, sourceKey, updateRemote]);
  drainRef.current = drain;

  const scheduleDrain = useCallback(() => {
    if (!readyRef.current) return;
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
  }, []);

  const refresh = useCallback(async () => {
    const generation = sourceGenerationRef.current;
    try {
      const result = await readDocumentServerDraft(sourceKey);
      if (!mountedRef.current || generation !== sourceGenerationRef.current) return;
      readyRef.current = true;
      if (!result.ok) {
        setStatus("error");
        return;
      }
      updateRemote(result.draft);
      const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      if (
        queued?.entry.operationType === "UPSERT" &&
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
      if (!mountedRef.current || generation !== sourceGenerationRef.current) return;
      readyRef.current = true;
      const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      setStatus(queued && isBrowserOffline() ? "offline" : "error");
    }
  }, [evaluateState, sourceKey, updateRemote]);

  const observeLocalDraft = useCallback(
    (data: T) => {
      try {
        const local = createLocalDraftState(data);
        localDraftRef.current = local;
        localDraftSourceRef.current = sourceKey;
        if (mountedRef.current) setLocalPreview(createFormDraftRecoveryPreview(data));
        const current = remoteDraftRef.current;
        if (current?.payloadHash === local.payloadHash) {
          choiceRequiredRef.current = false;
          const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
          if (queued?.entry.operationType === "UPSERT") {
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
        const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
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
          baseResourceVersion: local.baseResourceVersion,
          writerDeviceId,
        });
        notifyQueueChange(sourceKey);
        scheduleDrain();
      } catch {
        if (mountedRef.current) setStatus("error");
      }
    },
    [evaluateState, ownerId, scheduleDrain, sourceKey],
  );

  const clearLocalDraft = useCallback(
    (reason: ClearServerDraftReason) => {
      const hadLocalDraft = localDraftRef.current !== null;
      localDraftRef.current = null;
      localDraftSourceRef.current = null;
      if (mountedRef.current) setLocalPreview(null);
      clearTimers();
      if (reason === "empty" && choiceRequiredRef.current) {
        try {
          const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
          if (queued?.entry.operationType === "UPSERT") {
            removeQueuedDocumentServerDraftIfUnchanged(
              window.localStorage,
              sourceKey,
              queued.raw,
            );
            notifyQueueChange(sourceKey);
          }
          evaluateState(remoteDraftRef.current, null);
        } catch {
          if (mountedRef.current) setStatus("error");
        }
        return;
      }
      if (reason === "empty" && !hadLocalDraft) {
        evaluateState(remoteDraftRef.current, null);
        return;
      }
      choiceRequiredRef.current = false;
      try {
        const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
        enqueueDocumentServerDraftDiscard(window.localStorage, {
          sourceKey,
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
    [clearTimers, evaluateState, sourceKey],
  );

  const useRemoteDraft = useCallback(() => {
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
      localDraftRef.current = createLocalDraftState(data);
      localDraftSourceRef.current = sourceKey;
      setLocalPreview(createFormDraftRecoveryPreview(data));
      onApplyRemoteRef.current(data);
      setStatus("synced");
    } catch {
      setStatus("error");
    }
  }, [clearTimers, sourceKey]);

  const keepLocalDraft = useCallback(() => {
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
        baseResourceVersion: local.baseResourceVersion,
        writerDeviceId,
      });
      notifyQueueChange(sourceKey);
      setStatus(isBrowserOffline() ? "offline" : "queued");
      if (readyRef.current && !isBrowserOffline()) void drainRef.current();
    } catch {
      setStatus("error");
    }
  }, [ownerId, sourceKey]);

  const discardRemoteDraft = useCallback(() => {
    choiceRequiredRef.current = false;
    try {
      const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      enqueueDocumentServerDraftDiscard(window.localStorage, {
        sourceKey,
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
  }, [sourceKey]);

  useEffect(() => {
    mountedRef.current = true;
    sourceGenerationRef.current += 1;
    readyRef.current = false;
    choiceRequiredRef.current = false;
    remoteDraftRef.current = null;
    setRemoteDraft(null);
    if (localDraftSourceRef.current !== sourceKey) {
      localDraftRef.current = null;
      localDraftSourceRef.current = null;
      setLocalPreview(null);
    } else if (localDraftRef.current) {
      setLocalPreview(createFormDraftRecoveryPreview(localDraftRef.current.data));
    }
    setStatus("loading");
    try {
      const nextDeviceId = getOrCreateDocumentServerDraftDeviceId(
        window.localStorage,
        ownerId,
      );
      deviceIdRef.current = nextDeviceId;
      setDeviceId(nextDeviceId);
    } catch {
      deviceIdRef.current = null;
      setDeviceId(null);
    }
    void refresh();

    const queueKey = createDocumentServerDraftQueueKey(sourceKey);
    const handleOnline = () => {
      const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      if (queued) void drainRef.current();
      else void refresh();
    };
    const handleFocus = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== queueKey) return;
      const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      evaluateState(remoteDraftRef.current, queued?.entry ?? null);
      if (queued && !isBrowserOffline()) void drainRef.current();
    };
    const handleQueueChange = (event: Event) => {
      const detail = (event as CustomEvent<{ sourceKey?: string }>).detail;
      if (detail?.sourceKey !== sourceKey) return;
      const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      evaluateState(remoteDraftRef.current, queued?.entry ?? null);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);
    window.addEventListener(DOCUMENT_SERVER_DRAFT_QUEUE_CHANGE_EVENT, handleQueueChange);
    const poll = setInterval(() => {
      if (document.visibilityState !== "hidden" && !isBrowserOffline()) void refresh();
    }, SERVER_DRAFT_POLL_MS);

    return () => {
      mountedRef.current = false;
      sourceGenerationRef.current += 1;
      clearTimers();
      clearInterval(poll);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        DOCUMENT_SERVER_DRAFT_QUEUE_CHANGE_EVENT,
        handleQueueChange,
      );
    };
  }, [clearTimers, evaluateState, ownerId, refresh, sourceKey]);

  const remotePreview = remoteDraft
    ? createFormDraftRecoveryPreview(parsePayloadData<unknown>(remoteDraft.payloadJson))
    : null;

  return {
    status,
    remoteDraft,
    remotePreview,
    localPreview,
    isDifferentDevice: Boolean(
      remoteDraft && deviceId && remoteDraft.writerDeviceId !== deviceId,
    ),
    observeLocalDraft,
    clearLocalDraft,
    useRemoteDraft,
    keepLocalDraft,
    discardRemoteDraft,
    refresh,
  };
}
