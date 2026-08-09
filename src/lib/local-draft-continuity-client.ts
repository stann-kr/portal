"use client";

import {
  inspectLocalDocumentDraftsForOwner,
  listLocalDocumentDrafts,
  removeOwnerlessLegacyDocumentDrafts,
  removeLocalDocumentDraftSource,
  removeLocalDocumentDraftsExceptOwner,
  removeLocalDocumentDraftsForOwner,
  snapshotOwnerlessLegacyDocumentDrafts,
  type LocalDocumentDraftCleanupResult,
  type LocalDocumentDraftListResult,
  type LocalDocumentDraftOwnerInspectionResult,
  type OwnerlessLegacyDocumentDraftCleanupResult,
  type OwnerlessLegacyDocumentDraftSnapshot,
  type OwnerlessLegacyDocumentDraftSnapshotResult,
} from "@/lib/local-document-drafts";
import { broadcastFormDraftContinuityClear } from "@/lib/hooks/useFormDraft";

export type BrowserLocalDocumentDraftCleanupResult =
  LocalDocumentDraftCleanupResult & {
    storageUnavailable: boolean;
  };

export type BrowserLocalDocumentDraftListResult = LocalDocumentDraftListResult & {
  storageUnavailable: boolean;
};

export type BrowserLocalDocumentDraftOwnerInspectionResult =
  LocalDocumentDraftOwnerInspectionResult & {
    storageUnavailable: boolean;
  };

export type BrowserOwnerlessLegacyDocumentDraftSnapshotResult =
  OwnerlessLegacyDocumentDraftSnapshotResult & {
    storageUnavailable: boolean;
  };

export type BrowserOwnerlessLegacyDocumentDraftCleanupResult =
  OwnerlessLegacyDocumentDraftCleanupResult & {
    storageUnavailable: boolean;
  };

function readLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function unavailableCleanupResult(): BrowserLocalDocumentDraftCleanupResult {
  return {
    sourceKeys: [],
    removedKeys: [],
    failedKeys: [],
    enumerationFailed: false,
    storageUnavailable: true,
  };
}

/** 로그아웃 전에 현재 계정의 memory·durable 초안을 모두 폐기한다. */
export function clearLocalDocumentDraftsForLogout(
  ownerId: string,
): BrowserLocalDocumentDraftCleanupResult {
  broadcastFormDraftContinuityClear({
    mode: "owner",
    ownerId,
    lock: true,
  });
  const storage = readLocalStorage();
  if (!storage) return unavailableCleanupResult();
  return {
    ...removeLocalDocumentDraftsForOwner(storage, ownerId),
    storageUnavailable: false,
  };
}

/** 서버가 계정 삭제를 확인한 뒤 열린 탭을 잠그고 해당 owner만 정리한다. */
export function clearLocalDocumentDraftsForDeletedOwner(
  ownerId: string,
): BrowserLocalDocumentDraftCleanupResult {
  broadcastFormDraftContinuityClear({
    mode: "owner",
    ownerId,
    lock: true,
  });
  const storage = readLocalStorage();
  if (!storage) return unavailableCleanupResult();
  return {
    ...removeLocalDocumentDraftsForOwner(storage, ownerId),
    storageUnavailable: false,
  };
}

/** 계정 token 제거 전에 owner-scoped durable key가 정말 사라졌는지 확인한다. */
export function inspectBrowserLocalDocumentDraftsForOwner(
  ownerId: string,
): BrowserLocalDocumentDraftOwnerInspectionResult {
  const storage = readLocalStorage();
  if (!storage) {
    return {
      storageKeys: [],
      enumerationFailed: false,
      storageUnavailable: true,
    };
  }
  return {
    ...inspectLocalDocumentDraftsForOwner(storage, ownerId),
    storageUnavailable: false,
  };
}

/** 인증 계정이 바뀌면 현재 계정 외의 공유 기기 잔여본을 제거한다. */
export function clearLocalDocumentDraftsFromOtherOwners(
  ownerId: string,
): BrowserLocalDocumentDraftCleanupResult {
  broadcastFormDraftContinuityClear({
    mode: "except-owner",
    ownerId,
    lock: true,
  });
  const storage = readLocalStorage();
  if (!storage) return unavailableCleanupResult();
  return {
    ...removeLocalDocumentDraftsExceptOwner(storage, ownerId),
    storageUnavailable: false,
  };
}

/** 현재 로그인은 유지한 채 이 계정의 기기 초안을 전부 명시적으로 폐기한다. */
export function discardAllLocalDocumentDrafts(
  ownerId: string,
): BrowserLocalDocumentDraftCleanupResult {
  broadcastFormDraftContinuityClear({
    mode: "owner",
    ownerId,
    lock: false,
  });
  const storage = readLocalStorage();
  if (!storage) return unavailableCleanupResult();
  return {
    ...removeLocalDocumentDraftsForOwner(storage, ownerId),
    storageUnavailable: false,
  };
}

/** 현재 로그인은 유지한 채 선택한 문서의 기기 초안을 명시적으로 폐기한다. */
export function discardLocalDocumentDraft(
  ownerId: string,
  sourceKey: string,
): BrowserLocalDocumentDraftCleanupResult {
  broadcastFormDraftContinuityClear({
    mode: "source",
    ownerId,
    sourceKey,
    lock: false,
  });
  const storage = readLocalStorage();
  if (!storage) return unavailableCleanupResult();
  return {
    ...removeLocalDocumentDraftSource(storage, ownerId, sourceKey),
    storageUnavailable: false,
  };
}

export function readLocalDocumentDrafts(
  ownerId: string,
): BrowserLocalDocumentDraftListResult {
  const storage = readLocalStorage();
  if (!storage) {
    return {
      drafts: [],
      failedKeys: [],
      enumerationFailed: false,
      storageUnavailable: true,
    };
  }
  return {
    ...listLocalDocumentDrafts(storage, ownerId),
    storageUnavailable: false,
  };
}

export function readOwnerlessLegacyLocalDocumentDrafts(): BrowserOwnerlessLegacyDocumentDraftSnapshotResult {
  const storage = readLocalStorage();
  if (!storage) {
    return {
      snapshots: [],
      enumerationFailed: false,
      storageUnavailable: true,
    };
  }
  return {
    ...snapshotOwnerlessLegacyDocumentDrafts(storage),
    storageUnavailable: false,
  };
}

/** 로그인 화면의 명시적 2단계 확인에서만 구버전 ownerless allowlist를 폐기한다. */
export function discardOwnerlessLegacyLocalDocumentDrafts(
  expectedSnapshots: readonly OwnerlessLegacyDocumentDraftSnapshot[],
): BrowserOwnerlessLegacyDocumentDraftCleanupResult {
  const storage = readLocalStorage();
  if (!storage) {
    return {
      ...unavailableCleanupResult(),
      snapshotChanged: false,
      currentSnapshots: [],
    };
  }
  return {
    ...removeOwnerlessLegacyDocumentDrafts(storage, expectedSnapshots),
    storageUnavailable: false,
  };
}
