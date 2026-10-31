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
  type QueuedDocumentServerDraftDiscard,
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
import {
  ACCOUNT_LOGOUT_LOCK_EVENT,
  createAccountLogoutLockStorageKey,
  isAccountLogoutLockEventForOwner,
  isAccountOwnerLogoutLocked,
} from "@/lib/account-logout-lock";
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

/**
 * 문서 form이 서버 초안 비교·폐기 규칙을 넘기는 옵션(2026-10-31 노트 편집기 안정화).
 * 구현은 이 hook이 맡고, form은 "무엇이 휘발 값인지"와 "어떤 서버본이 더 이상 의미 없는지"만 알려 준다.
 */
export type DocumentServerDraftSyncOptions<T> = {
  /**
   * 서버 payload와 비교 hash에서 제외하는 휘발 필드(예: `operationId`). 로컬 저장본(useFormDraft)에는 그대로 남아
   * 재진입 replay가 유지되고, 서버본을 적용할 때 이 필드는 비어 있으므로 form이 새 값을 만든다.
   */
  volatileKeys?: readonly string[];
  /**
   * 관찰된 서버본(다른 기기 포함)을 사용자 선택 없이 조용히 폐기할지 판정한다. `"discard"`면 그 version·hash를
   * 대상으로 DISCARD를 큐에 넣어 보내고 선택창을 띄우지 않는다. 노트 편집은 서버본이 현재 저장된 head와 같거나
   * `baseRevision`이 head보다 오래된 경우 폐기한다. 로컬과 같은 본문은 이 판정 전에 `synced`로 처리된다.
   */
  classifyRemoteDraft?: (remote: T, snapshot: DocumentServerDraftSnapshot) => "keep" | "discard";
};

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

/** 서버 payload·비교 hash에서 휘발 필드를 뺀 객체. 휘발 필드가 없으면 같은 객체를 돌려준다. */
function stripVolatileKeys<T>(data: T, volatileKeys: readonly string[] | undefined): T {
  if (!volatileKeys?.length || typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (!volatileKeys.some((key) => key in record)) return data;
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!volatileKeys.includes(key)) stripped[key] = value;
  }
  return stripped as T;
}

/** 로컬 초안 상태는 휘발 필드를 뺀 데이터로 만든다. 큐·제출 정리·선택 저장이 모두 같은 본문을 보게 된다. */
function createLocalDraftState<T>(data: T, volatileKeys?: readonly string[]): LocalDraftState<T> {
  const stripped = stripVolatileKeys(data, volatileKeys);
  const payloadJson = serializeDocumentServerDraftPayload(stripped);
  const payload = canonicalizeDocumentServerDraftPayload(payloadJson);
  if (!payload) throw new TypeError("서버 초안 payload를 직렬화할 수 없습니다.");
  return {
    data: stripped,
    payloadJson,
    payloadHash: payload.payloadHash,
    baseResourceVersion: readBaseResourceVersion(stripped),
  };
}

function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function requiresLegacyDraftChoice(queue: QueuedDocumentServerDraft | null | undefined): boolean {
  return queue?.operationType === "UPSERT" && queue.expectedDraftVersion > 0 && !queue.expectedPayloadHash;
}

/**
 * 큐의 DISCARD가 관찰된 서버본을 겨냥하는지 판정하고, 겨냥한다면 그 version으로 다시 겨냥한 입력을 만든다.
 * 본문 hash가 대상에 있을 때만 대상이다(제출 정리는 전송 중·큐에 있던 이전 입력의 hash를 대상에 넣어 둔다).
 * 같은 기기(같은 브라우저의 다른 탭)가 썼더라도 다른 본문은 대상이 아니므로 null을 돌려 보존한다.
 */
function rebaseDiscardEntry(
  entry: QueuedDocumentServerDraftDiscard,
  remote: DocumentServerDraftSnapshot,
): {
  expectedDraftVersion: number;
  targetPayloadHashes: string[];
  supersededOperationIds?: string[];
} | null {
  if (!entry.targetPayloadHashes?.includes(remote.payloadHash)) return null;
  return {
    expectedDraftVersion: remote.draftVersion,
    targetPayloadHashes: entry.targetPayloadHashes,
    ...(entry.supersededOperationIds ? { supersededOperationIds: entry.supersededOperationIds } : {}),
  };
}

/** 큐의 DISCARD가 이미 이 서버본의 version·hash를 정확히 겨냥하고 있는지. */
function discardAlreadyTargets(
  entry: QueuedDocumentServerDraftDiscard,
  remote: DocumentServerDraftSnapshot,
): boolean {
  return entry.expectedDraftVersion === remote.draftVersion &&
    Boolean(entry.targetPayloadHashes?.includes(remote.payloadHash));
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
  options: DocumentServerDraftSyncOptions<T> = {},
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
  // 서버 응답을 기다리는 요청. 제출 정리·명시 폐기가 "이 UPSERT는 더 이상 유효하지 않다"(서버 fence)를 담을 때 읽는다.
  const inFlightRef = useRef<QueuedDocumentServerDraft | null>(null);
  // 옵션 객체는 매 render 새로 올 수 있으므로 ref로 최신값을 읽는다.
  const optionsRef = useRef(options);
  // 서버본의 canonical hash(휘발 필드 제외) memo. 서버 hash가 같으면 다시 계산하지 않는다.
  const remoteCanonicalRef = useRef<{ payloadHash: string; canonicalHash: string } | null>(null);
  // 서버본(draftVersion:payloadHash)별 결정. 사용자 선택은 늦은 관찰에서 다시 적용하고, 자동 폐기는 한 번만 시도한다.
  // 자동 보존(keep)은 기억하지 않는다: head가 올라가면(제출·자동 저장 성공) 같은 서버본도 다시 판정해야 한다.
  const remoteDecisionRef = useRef(new Map<string, "use" | "keep" | "discard" | "auto-discard">());
  // insertion effect는 같은 commit의 모든 layout/passive effect·이벤트보다 먼저 실행된다.
  useInsertionEffect(() => {
    onApplyRemoteRef.current = onApplyRemote;
    optionsRef.current = options;
  }, [onApplyRemote, options]);

  const toLocalDraftState = useCallback(
    (data: T) => createLocalDraftState(data, optionsRef.current.volatileKeys),
    [],
  );

  /**
   * 서버본을 로컬과 같은 기준(휘발 필드 제외)으로 비교하기 위한 hash. legacy 서버본(operationId 포함)도
   * 내용이 같으면 로컬과 같은 hash가 된다. CAS·DISCARD 대상에는 서버가 돌려준 `payloadHash`를 그대로 쓴다.
   */
  const canonicalRemoteHash = useCallback((remote: DocumentServerDraftSnapshot): string => {
    const volatileKeys = optionsRef.current.volatileKeys;
    if (!volatileKeys?.length) return remote.payloadHash;
    const memo = remoteCanonicalRef.current;
    if (memo?.payloadHash === remote.payloadHash) return memo.canonicalHash;
    const data = parsePayloadData<T>(remote.payloadJson);
    let canonicalHash = remote.payloadHash;
    if (data) {
      try {
        canonicalHash = createLocalDraftState(data, volatileKeys).payloadHash;
      } catch {
        canonicalHash = remote.payloadHash;
      }
    }
    remoteCanonicalRef.current = { payloadHash: remote.payloadHash, canonicalHash };
    return canonicalHash;
  }, []);

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

  // 같은 계정이 로그아웃하는 동안에는 서버 초안 저장(UPSERT)만 멈춘다. 로컬 초안과 대기열은 그대로 두고,
  // 로그아웃이 실패해 잠금이 풀리면 이어서 보낸다.
  const isOwnerLogoutLocked = useCallback(() => {
    if (!ownerId) return false;
    try {
      return isAccountOwnerLogoutLocked(window.localStorage, ownerId);
    } catch {
      return false;
    }
  }, [ownerId]);

  const allowOwnerPersistence = useCallback(() => {
    if (!isOwnerTerminallyLocked()) return true;
    purgeTerminallyLockedOwner();
    return false;
  }, [isOwnerTerminallyLocked, purgeTerminallyLockedOwner]);

  const remoteDecisionKey = (draft: DocumentServerDraftSnapshot) => `${draft.draftVersion}:${draft.payloadHash}`;

  /**
   * 선택창으로 가기 직전에 서버본을 자동으로 처리할 수 있는지 본다. 순서는 사용자가 같은 서버본에 이미 내린
   * 선택 → form의 `classifyRemoteDraft` 판정. 처리했으면 큐에 넣고 drain을 예약한 뒤 true를 돌려준다.
   * - 로컬이 없으면 그 서버본(version·hash)만 겨냥한 DISCARD.
   * - 로컬이 있으면 로컬을 그 서버본 위에 CAS 저장(`keepLocalDraft`와 같은 의미). 로컬 입력은 잃지 않는다.
   * `classifyRemoteDraft`는 매 평가마다 다시 부른다(문자열·숫자 비교라 저렴). 보존 판정을 기억하면 head가
   * 올라간 뒤(제출·자동 저장 성공) 오래된 서버본이 `remote-available`로 남는다.
   */
  const autoResolveRemote = useCallback(
    (draft: DocumentServerDraftSnapshot, local: LocalDraftState<T> | null, conflictCount = 0): boolean => {
      const key = remoteDecisionKey(draft);
      const decisions = remoteDecisionRef.current;
      let decision = decisions.get(key);
      if (decision === undefined) {
        const classify = optionsRef.current.classifyRemoteDraft;
        if (!classify) return false;
        const data = parsePayloadData<T>(draft.payloadJson);
        if (!data) return false;
        let verdict: "keep" | "discard";
        try {
          verdict = classify(data, draft);
        } catch {
          return false;
        }
        if (verdict !== "discard") return false;
        decision = "auto-discard";
        decisions.set(key, decision);
      } else if (decision === "auto-discard") {
        // 자동 폐기를 이미 시도한 서버본이 또 보이면 사용자 선택으로 넘긴다.
        return false;
      }
      if (conflictCount >= SERVER_DRAFT_MAX_DISCARD_REBASES) return false;
      if ((decision === "use" || decision === "keep") && !local) return false;
      try {
        if (local) {
          const writerDeviceId = deviceIdRef.current ??
            getOrCreateDocumentServerDraftDeviceId(window.localStorage, ownerId);
          deviceIdRef.current = writerDeviceId;
          enqueueDocumentServerDraftUpsert(window.localStorage, {
            sourceKey,
            data: local.data,
            expectedDraftVersion: draft.draftVersion,
            expectedPayloadHash: draft.payloadHash,
            baseResourceVersion: local.baseResourceVersion,
            writerDeviceId,
            conflictCount,
          });
        } else {
          enqueueDocumentServerDraftDiscard(window.localStorage, {
            sourceKey,
            expectedDraftVersion: draft.draftVersion,
            targetPayloadHashes: [draft.payloadHash],
            conflictCount,
          });
        }
      } catch {
        return false;
      }
      choiceRequiredRef.current = false;
      notifyQueueChange(sourceKey);
      if (mountedRef.current) setStatus(isBrowserOffline() ? "offline" : "queued");
      if (!isBrowserOffline()) setTimeout(() => void drainRef.current(), 0);
      return true;
    },
    [ownerId, sourceKey],
  );

  const evaluateState = useCallback(
    (draft: DocumentServerDraftSnapshot | null, queue?: QueuedDocumentServerDraft | null) => {
      if (!mountedRef.current) return;
      updateQueuedRecovery(queue);
      const local = localDraftRef.current;
      if (queue) {
        const mismatch = Boolean(
          draft && queue.operationType === "UPSERT" &&
            draft.payloadHash !== queue.payloadHash &&
            (queue.expectedDraftVersion !== draft.draftVersion || queue.expectedPayloadHash !== draft.payloadHash),
        );
        // 큐의 UPSERT가 현재 로컬 그대로이고 서버본만 다르면(예: 새로고침 복구 뒤 오래된 서버본) 자동 처리를 먼저 본다.
        if (
          draft && mismatch && local && queue.operationType === "UPSERT" &&
          !choiceRequiredRef.current && !requiresLegacyDraftChoice(queue) &&
          queue.payloadHash === local.payloadHash &&
          autoResolveRemote(draft, local, queue.conflictCount)
        ) return;
        const requiresChoice = queue.operationType === "UPSERT" && (
          choiceRequiredRef.current ||
          requiresLegacyDraftChoice(queue) ||
          mismatch
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
        if (autoResolveRemote(draft, null)) return;
        choiceRequiredRef.current = true;
        setStatus("remote-available");
        return;
      }
      const isSynced = canonicalRemoteHash(draft) === local.payloadHash;
      if (!isSynced && autoResolveRemote(draft, local)) return;
      choiceRequiredRef.current = !isSynced;
      setStatus(isSynced ? "synced" : "conflict");
    },
    [autoResolveRemote, canonicalRemoteHash, updateQueuedRecovery],
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
        if (!serverDraft) return;
        const rebased = rebaseDiscardEntry(current.entry, serverDraft);
        if (!rebased || discardAlreadyTargets(current.entry, serverDraft)) return;
        enqueueDocumentServerDraftDiscard(window.localStorage, {
          sourceKey,
          ...rebased,
          conflictCount: current.entry.conflictCount,
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
      (choiceRequiredRef.current || requiresLegacyDraftChoice(queued.entry) || isOwnerLogoutLocked())
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
    inFlightRef.current = queued.entry;
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
            supersededOperationIds: queued.entry.supersededOperationIds,
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
        } else if (
          queued.entry.operationType === "DISCARD" &&
          result.current &&
          queued.entry.conflictCount < SERVER_DRAFT_MAX_DISCARD_REBASES &&
          rebaseDiscardEntry(queued.entry, result.current)
        ) {
          // 폐기 뒤 조회에 이 기기가 쓴 서버본이 다시 잡혔다(지연 반영·재실행 응답). 같은 의도로 다시 겨냥한다.
          enqueueDocumentServerDraftDiscard(window.localStorage, {
            sourceKey,
            ...rebaseDiscardEntry(queued.entry, result.current)!,
            conflictCount: queued.entry.conflictCount + 1,
          });
          notifyQueueChange(sourceKey);
          setStatus("queued");
          setTimeout(() => void drainRef.current(), 0);
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
        queued.entry.conflictCount < SERVER_DRAFT_MAX_DISCARD_REBASES &&
        rebaseDiscardEntry(queued.entry, result.current)
      ) {
        enqueueDocumentServerDraftDiscard(window.localStorage, {
          sourceKey,
          ...rebaseDiscardEntry(queued.entry, result.current)!,
          conflictCount: queued.entry.conflictCount + 1,
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
        result.reason === "VERSION_CONFLICT" &&
        queued.entry.operationType === "UPSERT" &&
        result.current &&
        localDraftRef.current?.payloadHash === queued.entry.payloadHash &&
        autoResolveRemote(result.current, localDraftRef.current, queued.entry.conflictCount + 1)
      ) return;
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
      if (inFlightRef.current === queued.entry) inFlightRef.current = null;
      if (drainingGenerationRef.current === generation) drainingGenerationRef.current = null;
      if (mountedRef.current && generation === sourceGenerationRef.current && refreshRequestedRef.current) {
        refreshRequestedRef.current = false;
        queueMicrotask(() => void refreshRef.current());
      }
    }
  }, [
    allowOwnerPersistence,
    autoResolveRemote,
    clearTimers,
    evaluateState,
    isOwnerLogoutLocked,
    rebaseNewerQueue,
    sourceKey,
    updateRemote,
  ]);
  useInsertionEffect(() => {
    drainRef.current = drain;
  }, [drain]);

  const scheduleDrain = useCallback(() => {
    if (!readyRef.current || !allowOwnerPersistence()) return;
    if (isOwnerLogoutLocked()) {
      clearTimers();
      if (mountedRef.current) setStatus("queued");
      return;
    }
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
  }, [allowOwnerPersistence, clearTimers, isOwnerLogoutLocked]);

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
        } else if (
          queued?.entry.operationType === "DISCARD" && !result.draft &&
          // fence 대상이 있는 폐기는 서버본이 없어도 보내야 늦은 저장을 막는다(서버는 receipt만 선점하고 ok).
          !queued.entry.supersededOperationIds?.length
        ) {
          removeQueuedDocumentServerDraftIfUnchanged(
            window.localStorage,
            sourceKey,
            queued.raw,
          );
          notifyQueueChange(sourceKey);
        } else if (
          queued?.entry.operationType === "DISCARD" &&
          result.draft &&
          !discardAlreadyTargets(queued.entry, result.draft) &&
          queued.entry.conflictCount < SERVER_DRAFT_MAX_DISCARD_REBASES &&
          rebaseDiscardEntry(queued.entry, result.draft)
        ) {
          // 응답을 받지 못한 채 남은 폐기 의도(예: 새 노트 생성 직후 화면 전환)를 지금 관찰한 서버본으로 다시 겨냥한다.
          enqueueDocumentServerDraftDiscard(window.localStorage, {
            sourceKey,
            ...rebaseDiscardEntry(queued.entry, result.draft)!,
            conflictCount: queued.entry.conflictCount + 1,
          });
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
        const local = toLocalDraftState(data);
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
        if (current && canonicalRemoteHash(current) === local.payloadHash) {
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
          data: local.data,
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
    [allowOwnerPersistence, canonicalRemoteHash, evaluateState, ownerId, scheduleDrain, sourceKey, toLocalDraftState, updateLocalDraftView],
  );

  /**
   * 폐기 의도를 만드는 시점에 같은 sourceKey로 전송 중이거나 큐에 있던 UPSERT(이 기기의 이전 입력).
   * - `operationId`: 서버가 receipt를 DISCARD로 선점해, 늦게 도착한 저장이 폐기한 서버본을 되살리지 못하게 한다(서버 fence).
   * - `payloadHash`: 폐기 대상 hash에 넣어, 이전 입력이 늦게 반영된 서버본을 그 version으로 다시 겨냥해 지운다.
   *   본문으로 겨냥하므로 같은 기기 ID를 쓰는 다른 탭의 다른 본문은 지우지 않는다.
   */
  const collectSupersededUpserts = useCallback(
    (queued: QueuedDocumentServerDraft | null | undefined): { operationId: string; payloadHash: string }[] => {
      const upserts = new Map<string, { operationId: string; payloadHash: string }>();
      const inFlight = inFlightRef.current;
      if (inFlight?.operationType === "UPSERT" && inFlight.sourceKey === sourceKey) {
        upserts.set(inFlight.operationId, { operationId: inFlight.operationId, payloadHash: inFlight.payloadHash });
      }
      if (queued?.operationType === "UPSERT" && queued.sourceKey === sourceKey) {
        upserts.set(queued.operationId, { operationId: queued.operationId, payloadHash: queued.payloadHash });
      }
      return [...upserts.values()];
    },
    [sourceKey],
  );

  const clearLocalDraft = useCallback(
    (reason: ClearServerDraftReason, submitted?: { submittedData?: T; submittedAliases?: readonly T[] }) => {
      if (!allowOwnerPersistence()) return;
      const local = localDraftRef.current;
      const hadLocalDraft = local !== null;
      let targetPayloadHashes: string[];
      const remote = remoteDraftRef.current;
      try {
        const data = submitted?.submittedData ?? local?.data;
        targetPayloadHashes = data === undefined ? [] : [...new Set(
          [data, ...(submitted?.submittedAliases ?? [])].map((value) => toLocalDraftState(value).payloadHash),
        )];
        // 서버본이 휘발 필드만 다른 같은 본문이면(legacy 포함) 서버가 저장한 hash도 대상에 넣어 서버 CAS가 맞게 한다.
        if (remote && targetPayloadHashes.includes(canonicalRemoteHash(remote)) &&
          !targetPayloadHashes.includes(remote.payloadHash)) {
          targetPayloadHashes.push(remote.payloadHash);
        }
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
        if (targetPayloadHashes.length === 0 || (remote && !targetPayloadHashes.includes(remote.payloadHash) &&
          drainingGenerationRef.current !== sourceGenerationRef.current)) {
          if (queued?.entry.operationType === "UPSERT") {
            removeQueuedDocumentServerDraftIfUnchanged(window.localStorage, sourceKey, queued.raw);
            notifyQueueChange(sourceKey);
          }
          evaluateState(remote, readQueuedDocumentServerDraft(window.localStorage, sourceKey)?.entry);
          return;
        }
        // 전송 중·큐의 이전 입력(이 기기)은 제출 뒤 늦게 반영돼도 본문 hash로 겨냥해 지운다. 위 guard들 뒤에만 넣는다:
        // 앞에 넣으면 제출 뒤 새로 친 입력(큐의 다른 UPSERT)까지 정리 대상이 된다.
        const superseded = collectSupersededUpserts(queued?.entry);
        const supersededOperationIds = superseded.map((upsert) => upsert.operationId);
        enqueueDocumentServerDraftDiscard(window.localStorage, {
          sourceKey,
          targetPayloadHashes: [...new Set([...targetPayloadHashes, ...superseded.map((upsert) => upsert.payloadHash)])],
          expectedDraftVersion:
            remoteDraftRef.current?.draftVersion ??
            queued?.entry.expectedDraftVersion ??
            0,
          ...(supersededOperationIds.length > 0 ? { supersededOperationIds } : {}),
        });
        notifyQueueChange(sourceKey);
        if (mountedRef.current) setStatus(isBrowserOffline() ? "offline" : "queued");
        if (readyRef.current && !isBrowserOffline()) void drainRef.current();
      } catch {
        if (mountedRef.current) setStatus("error");
      }
    },
    [allowOwnerPersistence, canonicalRemoteHash, clearTimers, collectSupersededUpserts, evaluateState, sourceKey, toLocalDraftState],
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
      const local = toLocalDraftState(data);
      localDraftRef.current = local;
      localDraftSourceRef.current = sourceKey;
      updateLocalDraftView(local);
      onApplyRemoteRef.current(data);
      evaluateState(remoteDraftRef.current, current.entry);
    } catch {
      setStatus("error");
    }
  }, [allowOwnerPersistence, clearTimers, evaluateState, queuedRecovery, sourceKey, toLocalDraftState, updateLocalDraftView]);

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
    remoteDecisionRef.current.set(remoteDecisionKey(remote), "use");
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
      const local = toLocalDraftState(data);
      localDraftRef.current = local;
      localDraftSourceRef.current = sourceKey;
      updateLocalDraftView(local);
      onApplyRemoteRef.current(data);
      setStatus("synced");
    } catch {
      setStatus("error");
    }
  }, [allowOwnerPersistence, clearTimers, sourceKey, toLocalDraftState, updateLocalDraftView]);

  const keepLocalDraft = useCallback(() => {
    if (!allowOwnerPersistence()) return;
    const local = localDraftRef.current;
    if (!local) return;
    choiceRequiredRef.current = false;
    if (remoteDraftRef.current) remoteDecisionRef.current.set(remoteDecisionKey(remoteDraftRef.current), "keep");
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
    if (remoteDraftRef.current) remoteDecisionRef.current.set(remoteDecisionKey(remoteDraftRef.current), "discard");
    try {
      const queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      const superseded = collectSupersededUpserts(queued?.entry);
      const supersededOperationIds = superseded.map((upsert) => upsert.operationId);
      // 명시 폐기도 전송 중·큐의 이전 입력이 늦게 반영된 서버본까지 본문 hash로 겨냥한다.
      const targetPayloadHashes = [...new Set([
        ...(remoteDraftRef.current ? [remoteDraftRef.current.payloadHash] : []),
        ...superseded.map((upsert) => upsert.payloadHash),
      ])];
      enqueueDocumentServerDraftDiscard(window.localStorage, {
        sourceKey,
        ...(targetPayloadHashes.length > 0 ? { targetPayloadHashes } : {}),
        expectedDraftVersion:
          remoteDraftRef.current?.draftVersion ??
          queued?.entry.expectedDraftVersion ??
          0,
        ...(supersededOperationIds.length > 0 ? { supersededOperationIds } : {}),
      });
      notifyQueueChange(sourceKey);
      setStatus(isBrowserOffline() ? "offline" : "queued");
      if (readyRef.current && !isBrowserOffline()) void drainRef.current();
    } catch {
      setStatus("error");
    }
  }, [allowOwnerPersistence, collectSupersededUpserts, sourceKey]);

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
    remoteCanonicalRef.current = null;
    remoteDecisionRef.current = new Map();
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
    const logoutLockKey = ownerId ? createAccountLogoutLockStorageKey(ownerId) : null;
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
    // 로그아웃 잠금이 걸리면 기다리던 저장 타이머를 멈추고, 풀리면 남은 대기열을 이어서 보낸다.
    const handleLogoutLockChange = () => {
      if (isOwnerLogoutLocked()) {
        clearTimers();
        return;
      }
      if (!allowOwnerPersistence() || !readyRef.current) return;
      let queued: ReturnType<typeof readQueuedDocumentServerDraft>;
      try {
        queued = readQueuedDocumentServerDraft(window.localStorage, sourceKey);
      } catch {
        return;
      }
      if (queued && !isBrowserOffline()) void drainRef.current().finally(schedulePoll);
    };
    const handleLogoutLock = (event: Event) => {
      if (!isAccountLogoutLockEventForOwner(event, ownerId)) return;
      handleLogoutLockChange();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === terminalLockKey) {
        if (!allowOwnerPersistence()) return;
      }
      if (logoutLockKey !== null && event.key === logoutLockKey) {
        handleLogoutLockChange();
        return;
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
    window.addEventListener(ACCOUNT_LOGOUT_LOCK_EVENT, handleLogoutLock);
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
      window.removeEventListener(ACCOUNT_LOGOUT_LOCK_EVENT, handleLogoutLock);
      window.removeEventListener(
        DOCUMENT_SERVER_DRAFT_QUEUE_CHANGE_EVENT,
        handleQueueChange,
      );
    };
  }, [
    allowOwnerPersistence,
    clearTimers,
    evaluateState,
    isOwnerLogoutLocked,
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
