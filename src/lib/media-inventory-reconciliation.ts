import { inArray } from "drizzle-orm";
import type { DbContext } from "@/db/client";
import { mediaObjects } from "@/db/schema";
import { asDocumentReadDb } from "@/lib/document-lifecycle-atomic";
import { isManagedFinalMediaObjectKey } from "@/lib/media-lifecycle";

const RECONCILIATION_PREFIX = "media/";
const RECONCILIATION_CURSOR_KEY =
  ".portal-maintenance/media-final-reconciliation-v1.json";
const RECONCILIATION_DELETE_TIMEOUT_MS = 2_000;

export interface RuntimeR2InventoryObject {
  key: string;
}

export interface RuntimeR2InventoryBucket {
  list(options: {
    prefix: string;
    limit: number;
    startAfter?: string;
  }): Promise<{ objects: RuntimeR2InventoryObject[]; truncated: boolean }>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
}

export type MediaInventoryReconciliationResult = {
  inspected: number;
  deleted: number;
  preserved: number;
  invalid: number;
  failed: number;
  cycleCompleted: boolean;
  budgetExhausted: boolean;
};

function emptyResult(): MediaInventoryReconciliationResult {
  return {
    inspected: 0,
    deleted: 0,
    preserved: 0,
    invalid: 0,
    failed: 0,
    cycleCompleted: false,
    budgetExhausted: false,
  };
}

function isSafeReconciliationCursor(value: string): boolean {
  return (
    value.startsWith(RECONCILIATION_PREFIX) &&
    value.length <= 1_024 &&
    !value.includes("\0")
  );
}

async function readStartAfter(
  bucket: RuntimeR2InventoryBucket,
): Promise<string | undefined> {
  const object = await bucket.get(RECONCILIATION_CURSOR_KEY);
  if (!object) return undefined;
  try {
    const parsed = JSON.parse(await object.text()) as {
      version?: unknown;
      startAfter?: unknown;
    };
    return parsed.version === 1 &&
      typeof parsed.startAfter === "string" &&
      isSafeReconciliationCursor(parsed.startAfter)
      ? parsed.startAfter
      : undefined;
  } catch {
    return undefined;
  }
}

async function saveStartAfter(
  bucket: RuntimeR2InventoryBucket,
  startAfter: string | undefined,
): Promise<void> {
  if (!startAfter) {
    await bucket.delete(RECONCILIATION_CURSOR_KEY);
    return;
  }
  await bucket.put(
    RECONCILIATION_CURSOR_KEY,
    JSON.stringify({ version: 1, startAfter }),
  );
}

async function deleteWithTimeout(
  bucket: RuntimeR2InventoryBucket,
  objectKey: string,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      bucket.delete(objectKey),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("R2_RECONCILIATION_DELETE_TIMEOUT")),
          RECONCILIATION_DELETE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** final prefix를 bounded page로 순회해 registry가 없거나 삭제 상태인 object를 재삭제한다. */
export async function reconcileManagedFinalMediaObjects(
  context: DbContext,
  bucket: RuntimeR2InventoryBucket,
  input: {
    limit?: number;
    shouldContinue?: () => boolean;
  } = {},
): Promise<MediaInventoryReconciliationResult> {
  const shouldContinue = input.shouldContinue ?? (() => true);
  const requestedLimit = input.limit ?? 50;
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 50;
  const result = emptyResult();
  if (!shouldContinue()) {
    result.budgetExhausted = true;
    return result;
  }

  const startAfter = await readStartAfter(bucket);
  const page = await bucket.list({
    prefix: RECONCILIATION_PREFIX,
    limit,
    ...(startAfter ? { startAfter } : {}),
  });
  const managedKeys = page.objects
    .map((object) => object.key)
    .filter(isManagedFinalMediaObjectKey);
  const rows = managedKeys.length
    ? await asDocumentReadDb(context)
        .select({ objectKey: mediaObjects.objectKey, state: mediaObjects.state })
        .from(mediaObjects)
        .where(inArray(mediaObjects.objectKey, managedKeys))
    : [];
  const stateByKey = new Map(rows.map((row) => [row.objectKey, row.state]));

  let lastProcessed = startAfter;
  for (const object of page.objects) {
    if (!shouldContinue()) {
      result.budgetExhausted = true;
      break;
    }
    result.inspected += 1;
    lastProcessed = object.key;
    if (!isManagedFinalMediaObjectKey(object.key)) {
      result.invalid += 1;
      continue;
    }
    const state = stateByKey.get(object.key);
    if (state && state !== "PENDING_DELETE" && state !== "DELETED") {
      result.preserved += 1;
      continue;
    }
    try {
      await deleteWithTimeout(bucket, object.key);
      result.deleted += 1;
    } catch {
      result.failed += 1;
    }
  }

  const processedWholePage = result.inspected === page.objects.length;
  if (processedWholePage && !page.truncated) {
    result.cycleCompleted = true;
    await saveStartAfter(bucket, undefined);
  } else if (lastProcessed && lastProcessed !== startAfter) {
    await saveStartAfter(bucket, lastProcessed);
  }
  return result;
}
