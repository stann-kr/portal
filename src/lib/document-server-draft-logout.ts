import { createCreationOperationId } from "@/lib/creation-operation";
import type {
  DiscardDocumentServerDraftInput,
  DocumentServerDraftMutationResult,
} from "@/lib/document-server-draft-contract";
import {
  listQueuedDocumentServerDraftDiscardsForOwner,
  removeQueuedDocumentServerDraftIfUnchanged,
  type StoredQueuedDocumentServerDraftDiscard,
} from "@/lib/document-server-draft-queue";
import type { FormDraftStorage } from "@/lib/form-draft";

/** 로그아웃이 기다리는 최대 시간. 넘기면 서버 초안이 남더라도 로그아웃을 계속한다. */
export const SERVER_DRAFT_LOGOUT_FLUSH_TIMEOUT_MS = 3_000;
const SERVER_DRAFT_LOGOUT_MAX_DISCARD_REBASES = 3;

export type ServerDraftLogoutFlushResult = {
  attempted: number;
  discarded: number;
  timedOut: boolean;
};

type DiscardServerDraft = (
  input: DiscardDocumentServerDraftInput,
) => Promise<DocumentServerDraftMutationResult>;

/**
 * 폐기 요청 하나를 보낸다. 다른 기기가 같은 본문을 다시 저장해 version만 앞섰으면 그 version으로
 * 다시 보내고(편집기의 rebase 규칙과 같은 횟수), 서버본이 없거나 다른 본문이면 건드리지 않는다.
 */
async function sendQueuedDiscard(
  storage: Pick<FormDraftStorage, "getItem" | "removeItem">,
  stored: StoredQueuedDocumentServerDraftDiscard,
  discard: DiscardServerDraft,
  createOperationId: () => string,
): Promise<boolean> {
  const { entry } = stored;
  let request: DiscardDocumentServerDraftInput = {
    sourceKey: entry.sourceKey,
    operationId: entry.operationId,
    expectedDraftVersion: entry.expectedDraftVersion,
    ...(entry.targetPayloadHashes ? { targetPayloadHashes: entry.targetPayloadHashes } : {}),
  };
  let conflictCount = entry.conflictCount;
  for (;;) {
    let result: DocumentServerDraftMutationResult;
    try {
      result = await discard(request);
    } catch {
      return false;
    }
    if (result.ok) {
      removeQueuedDocumentServerDraftIfUnchanged(storage, entry.sourceKey, stored.raw);
      return true;
    }
    if (result.reason !== "VERSION_CONFLICT") return false;
    const current = result.current;
    if (
      current &&
      entry.targetPayloadHashes?.includes(current.payloadHash) &&
      conflictCount < SERVER_DRAFT_LOGOUT_MAX_DISCARD_REBASES
    ) {
      conflictCount += 1;
      request = { ...request, operationId: createOperationId(), expectedDraftVersion: current.draftVersion };
      continue;
    }
    removeQueuedDocumentServerDraftIfUnchanged(storage, entry.sourceKey, stored.raw);
    return current === null;
  }
}

/**
 * 로그아웃 정리는 이 기기의 서버 초안 대기열까지 지운다. 그 전에 이 계정의 폐기 요청만 보내
 * 이미 게시·저장한 글의 계정 작성본이 다음 작성 화면에 남지 않게 한다. 저장(UPSERT) 요청은
 * 공유 기기 보호에 따라 보내지 않고 함께 지운다.
 */
export async function flushQueuedDocumentServerDraftDiscards({
  storage,
  ownerId,
  discard,
  timeoutMs = SERVER_DRAFT_LOGOUT_FLUSH_TIMEOUT_MS,
  createOperationId = createCreationOperationId,
}: {
  storage: Pick<FormDraftStorage, "length" | "key" | "getItem" | "removeItem">;
  ownerId: string;
  discard: DiscardServerDraft;
  timeoutMs?: number;
  createOperationId?: () => string;
}): Promise<ServerDraftLogoutFlushResult> {
  const queued = listQueuedDocumentServerDraftDiscardsForOwner(storage, ownerId);
  if (queued.length === 0) return { attempted: 0, discarded: 0, timedOut: false };
  let discarded = 0;
  const work = Promise.all(queued.map(async (stored) => {
    if (await sendQueuedDiscard(storage, stored, discard, createOperationId)) discarded += 1;
  }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    work.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return { attempted: queued.length, discarded, timedOut };
}
