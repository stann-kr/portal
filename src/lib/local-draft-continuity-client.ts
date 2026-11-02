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
import {
  clearCollabLocalDataExceptOwner,
  clearCollabLocalDataForOwner,
  inspectCollabLocalDataForOwner,
  lockCollabOwner,
  type CollabLocalCleanupResult,
  type CollabLocalClearOptions,
} from "@/lib/collab/client/local-store";

export type BrowserLocalDocumentDraftCleanupResult =
  LocalDocumentDraftCleanupResult & {
    storageUnavailable: boolean;
  };

/** 계정 경계 정리(로그아웃·전환·삭제) 결과. 공동 편집 기기 보관 정리 결과를 함께 담는다. */
export type BrowserLocalAccountBoundaryCleanupResult =
  BrowserLocalDocumentDraftCleanupResult & {
    collab: CollabLocalCleanupResult;
  };

export type BrowserLocalDocumentDraftListResult = LocalDocumentDraftListResult & {
  storageUnavailable: boolean;
};

export type BrowserLocalDocumentDraftOwnerInspectionResult =
  LocalDocumentDraftOwnerInspectionResult & {
    storageUnavailable: boolean;
    /** 남은 공동 편집 DB 이름·localStorage key. 비어야 정리 완료다. */
    collabKeys: string[];
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

function lockCollabOwnerSafely(ownerId: string): void {
  try {
    lockCollabOwner(ownerId);
  } catch {
    // 잠금 실패는 아래 정리 결과(남은 이름)로 드러난다.
  }
}

async function clearCollabSafely(
  run: () => Promise<CollabLocalCleanupResult>,
): Promise<CollabLocalCleanupResult> {
  try {
    return await run();
  } catch {
    return { remaining: ["portal-collab:"], deletedDbNames: [], storageUnavailable: false };
  }
}

/**
 * owner 범위 정리 공통 순서: 공동 편집 잠금 → broadcast → localStorage 초안 동기 삭제 → 공동 편집 기기 보관 삭제 대기.
 * 첫 await 전까지는 동기로 실행되므로 호출자가 기다리지 않아도 localStorage 정리 순서는 이전과 같다.
 */
async function clearOwnerBoundary(
  ownerId: string,
  options: CollabLocalClearOptions,
): Promise<BrowserLocalAccountBoundaryCleanupResult> {
  lockCollabOwnerSafely(ownerId);
  broadcastFormDraftContinuityClear({
    mode: "owner",
    ownerId,
    lock: true,
  });
  const storage = readLocalStorage();
  const drafts = storage
    ? { ...removeLocalDocumentDraftsForOwner(storage, ownerId), storageUnavailable: false }
    : unavailableCleanupResult();
  const collab = await clearCollabSafely(() => clearCollabLocalDataForOwner(ownerId, options));
  return { ...drafts, collab };
}

/** 로그아웃 전에 현재 계정의 memory·durable 초안과 공동 편집 기기 보관을 모두 폐기한다. */
export function clearLocalDocumentDraftsForLogout(
  ownerId: string,
  options: CollabLocalClearOptions = {},
): Promise<BrowserLocalAccountBoundaryCleanupResult> {
  return clearOwnerBoundary(ownerId, options);
}

/** 서버가 계정 삭제를 확인한 뒤 열린 탭을 잠그고 해당 owner만 정리한다. */
export function clearLocalDocumentDraftsForDeletedOwner(
  ownerId: string,
  options: CollabLocalClearOptions = {},
): Promise<BrowserLocalAccountBoundaryCleanupResult> {
  return clearOwnerBoundary(ownerId, options);
}

/** 계정 token 제거 전에 owner-scoped durable key와 공동 편집 기기 보관이 정말 사라졌는지 확인한다. */
export async function inspectBrowserLocalDocumentDraftsForOwner(
  ownerId: string,
): Promise<BrowserLocalDocumentDraftOwnerInspectionResult> {
  const storage = readLocalStorage();
  if (!storage) {
    return {
      storageKeys: [],
      enumerationFailed: false,
      storageUnavailable: true,
      collabKeys: [],
    };
  }
  const drafts = inspectLocalDocumentDraftsForOwner(storage, ownerId);
  let collabKeys: string[];
  try {
    collabKeys = await inspectCollabLocalDataForOwner(ownerId);
  } catch {
    collabKeys = ["portal-collab:"];
  }
  return {
    ...drafts,
    storageUnavailable: false,
    collabKeys,
  };
}

/** 인증 계정이 바뀌면 현재 계정 외의 공유 기기 잔여본(공동 편집 기기 보관 포함)을 제거한다. */
export async function clearLocalDocumentDraftsFromOtherOwners(
  ownerId: string,
  options: CollabLocalClearOptions = {},
): Promise<BrowserLocalAccountBoundaryCleanupResult> {
  broadcastFormDraftContinuityClear({
    mode: "except-owner",
    ownerId,
    lock: true,
  });
  const storage = readLocalStorage();
  const drafts = storage
    ? { ...removeLocalDocumentDraftsExceptOwner(storage, ownerId), storageUnavailable: false }
    : unavailableCleanupResult();
  const collab = await clearCollabSafely(() => clearCollabLocalDataExceptOwner(ownerId, options));
  return { ...drafts, collab };
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
