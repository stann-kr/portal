import type { CollabWorkerEnv } from "./worker-route";
import {
  advanceCollabRoom,
  closeCollabRoom,
  isCollabRoomPrepared,
  notifyCollabRoom,
  prepareCollabRoom,
  readCollabRoomEpoch,
  resetCollabRoom,
  setCollabRoomMeta,
  thawCollabRoom,
} from "./worker-route";
import { COLLAB_EPOCH_FIELD, type CollabPrepareMode, type CollabPrepareResult } from "./protocol";
import { formatCollabDocKey } from "./doc-key";

/**
 * Next route·server action에서 같은 Worker의 공동 편집 binding을 읽는다.
 * next dev·테스트처럼 Cloudflare context가 없으면 null(혼자 모드)이다.
 */
export function readCollabWorkerEnv(): CollabWorkerEnv | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const env = getCloudflareContext()?.env as CollabWorkerEnv | undefined;
    return env?.DOC_ROOMS ? env : null;
  } catch {
    return null;
  }
}

/** 응답 뒤에도 끝까지 보내게 한다(알림처럼 저장 응답을 늦추면 안 되는 일). context가 없으면 그냥 기다리지 않는다. */
function runAfterResponse(task: Promise<unknown>): void {
  const settled = task.catch(() => undefined);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext()?.ctx as { waitUntil?: (promise: Promise<unknown>) => void } | undefined;
    ctx?.waitUntil?.(settled);
  } catch {
    // next dev·테스트: 기다리지 않는다.
  }
}

async function withRetry(label: string, key: string, task: () => Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (await task()) return true;
    } catch {
      // 다시 시도한다.
    }
  }
  console.error(JSON.stringify({ event: label, outcome: "failed", kind: key.split(":")[0] }));
  return false;
}

/**
 * 복원 전 준비(freeze → checkpoint). binding이 없으면(혼자 모드) 확인할 room이 없어 성공으로 본다.
 * 실패면 호출한 쪽이 복원하지 않고 `thawCollabRoomAfterAbort`를 부른다.
 */
export async function prepareCollabRoomForRestore(
  key: string,
  id: string,
  mode: CollabPrepareMode,
): Promise<CollabPrepareResult> {
  const env = readCollabWorkerEnv();
  if (!env) return { ok: true, checkpoint: null };
  try {
    return (await prepareCollabRoom(env, key, { id, mode })) ?? { ok: true, checkpoint: null };
  } catch {
    return { ok: false, reason: "timeout" };
  }
}

/** 복원 commit 직전: 준비가 아직 유효한지(안전 시간으로 풀려 새 입력을 받기 시작했으면 복원하지 않는다). */
export async function isCollabRoomStillPrepared(key: string, id: string): Promise<boolean> {
  const env = readCollabWorkerEnv();
  if (!env) return true;
  return isCollabRoomPrepared(env, key, id).catch(() => false);
}

export async function thawCollabRoomAfterAbort(key: string, id: string): Promise<void> {
  const env = readCollabWorkerEnv();
  if (!env) return;
  await thawCollabRoom(env, key, id).catch(() => undefined);
}

/**
 * 복원 commit 뒤 room을 그 revision(lifecycle 표지)으로 넘긴다. 실패해도 다음 연결·renew의 토큰 세대가 room을 수렴시킨다.
 */
export async function advanceCollabRoomAfterRestore(key: string, target: number): Promise<void> {
  const env = readCollabWorkerEnv();
  if (!env) return;
  await withRetry("collab_room_advance", key, () => advanceCollabRoom(env, key, target));
}

/** 휴지통 이동(keep: 상태 보존)·영구 삭제(keep 아님) 뒤 열린 연결을 닫는다. */
export async function closeCollabRoomAfterMutation(key: string, keep: boolean): Promise<void> {
  const env = readCollabWorkerEnv();
  if (!env) return;
  await withRetry("collab_room_close", key, () => closeCollabRoom(env, key, keep));
}

/** room 밖에서 바뀐 칸(캘린더 날짜 이동)을 열린 room에 반영한다. 다음 자동 저장이 옛 값으로 되돌리지 않게 한다. */
export async function setCollabRoomMetaAfterMutation(
  key: string,
  field: string,
  value: string,
  epoch?: number,
  version?: number,
): Promise<void> {
  const env = readCollabWorkerEnv();
  if (!env) return;
  await setCollabRoomMeta(env, key, field, value, epoch, version).catch(() => false);
}

/** 답글·학생 최근 노트 알림. 저장 응답을 늦추지 않도록 응답 뒤에 보낸다(실패해도 화면은 30초 재조회로 따라온다). */
export function notifyCollabTopic(topic: "qna" | "student-notes", id: string): void {
  const env = readCollabWorkerEnv();
  if (!env) return;
  let key: string;
  try {
    key = formatCollabDocKey({ kind: "notify", topic, id });
  } catch {
    return;
  }
  runAfterResponse(notifyCollabRoom(env, key));
}

/**
 * 복원·휴지통 이동·영구 삭제가 D1에 반영된 뒤 room을 비운다. 열린 편집기는 reset을 받고 새 head로 다시 시작한다.
 * 권한 확인은 앞선 원자 쓰기가 끝냈으므로 성공한 경우에만 부른다. 실패하면 한 번 더 시도하고 log만 남긴다
 * (D1 변경은 이미 끝났다. 남은 room 내용이 다시 저장되더라도 revision 이력에서 복원할 수 있다).
 */
export async function resetCollabRoomAfterMutation(key: string): Promise<void> {
  const env = readCollabWorkerEnv();
  if (!env) return;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (await resetCollabRoom(env, key)) return;
    } catch {
      // 다시 시도한다.
    }
  }
  console.error(JSON.stringify({ event: "collab_room_reset", outcome: "failed", kind: key.split(":")[0] }));
}

/**
 * 공동 편집 저장 요청이 지금 room과 같은 epoch에서 왔는지 확인한다. 복원·휴지통 이동으로 room이 비워진 뒤
 * 늦게 도착한(또는 version 충돌로 다시 보낸) 옛 내용이 새 head를 덮지 않게 한다.
 * epoch 칸이 없는 요청(공동 편집 이전 화면)과 binding이 없는 환경은 확인하지 않는다.
 */
export async function isStaleCollabSave(formData: FormData, key: string): Promise<boolean> {
  const raw = formData.get(COLLAB_EPOCH_FIELD);
  if (raw === null || raw === "") return false;
  const epoch = Number(raw);
  if (!Number.isSafeInteger(epoch) || epoch < 0) return true;
  const env = readCollabWorkerEnv();
  if (!env) return false;
  const current = await readCollabRoomEpoch(env, key);
  return current !== null && current !== epoch;
}

export const STALE_COLLAB_SAVE_MESSAGE = "문서가 복원되거나 정리되어 최신 내용으로 다시 불러옵니다. 이 저장은 반영하지 않았습니다.";

/**
 * 노트·게시물 공동 편집 저장이 실은 room generation(lifecycle 표지와 같은 값)을 읽는다. 값은 원자 쓰기 조건으로 넘긴다.
 * 칸이 있으면 음이 아닌 safe integer여야 한다. binding이 있는 환경(공동 편집)에서는 칸이 없으면 거부하고,
 * binding이 없는 혼자 모드(next dev·테스트)에서는 칸 없이 기존대로 저장한다.
 */
export function parseCollabSaveEpoch(
  formData: FormData,
): { ok: true; collabEpoch: number | undefined } | { ok: false } {
  const raw = formData.get(COLLAB_EPOCH_FIELD);
  if (raw === null || raw === "") {
    return readCollabWorkerEnv() ? { ok: false } : { ok: true, collabEpoch: undefined };
  }
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return { ok: false };
  const epoch = Number(raw);
  return Number.isSafeInteger(epoch) ? { ok: true, collabEpoch: epoch } : { ok: false };
}
