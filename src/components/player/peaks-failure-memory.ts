/**
 * @file src/components/player/peaks-failure-memory.ts
 * @description 이 브라우저가 파형을 만들지 못한 매체를 7일 동안 기억한다(재생할 때마다 파일을 다시 받아 실패하지 않게).
 * localStorage에 매체 ID와 시각만 둔다. 저장소를 못 쓰면(사생활 보호 창 등) 기억하지 않고 조용히 넘어간다.
 */

export const PEAKS_FAILURE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KEY_PREFIX = "portal:peaks-failed:";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 최근 7일 안에 이 매체의 파형을 만들지 못했는지. 기한이 지난 기록은 지운다. */
export function hasRecentPeaksFailure(mediaObjectId: string, now = Date.now(), storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(KEY_PREFIX + mediaObjectId);
    if (raw === null) return false;
    const at = Number(raw);
    if (Number.isFinite(at) && at <= now && now - at < PEAKS_FAILURE_TTL_MS) return true;
    storage.removeItem(KEY_PREFIX + mediaObjectId);
    return false;
  } catch {
    return false;
  }
}

/** 이 매체의 파형을 만들지 못했다고 기억한다. */
export function rememberPeaksFailure(mediaObjectId: string, now = Date.now(), storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(KEY_PREFIX + mediaObjectId, String(now));
  } catch {
    // 저장소가 가득 찼거나 막혀 있으면 기억하지 않는다.
  }
}
