import type { CollabWorkerEnv } from "./worker-route";
import {
  abortCollabRoomRestore,
  applyCollabRoomRestore,
  beginCollabRoomRestore,
  closeCollabRoom,
  holdCollabRoomRestore,
  notifyCollabRoom,
  readCollabRoomEpoch,
  setCollabRoomMeta,
} from "./worker-route";
import { COLLAB_EPOCH_FIELD } from "./protocol";
import { buildCollabRestoreUpdate, readCollabStateContent } from "./server-restore";
import type { MergeFields } from "./client/merge";
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** 복원 준비 결과. none: binding 없음(혼자 모드, room 없음). */
export type CollabRestorePrepared =
  | { kind: "none" }
  | {
      kind: "ready";
      /** room 상태가 마지막 저장과 같다(밀린 입력 없음). */
      clean: boolean;
      seeded: boolean;
      lifecycle: number;
      /** 준비 시점 room 본문·칸(시드되지 않았으면 null). checkpoint·게시본 비교에 쓴다. */
      content: { html: string; fields: MergeFields } | null;
    }
  | { kind: "busy" }
  | { kind: "failed" };

/**
 * 복원 준비: room이 지금 상태(S)를 복원 기준으로 영속화한다. 입력·연결은 막지 않는다.
 * 실패하면 복원하지 않는다(호출한 쪽이 `abortCollabRestore`).
 */
export async function beginCollabRestore(key: string, id: string): Promise<CollabRestorePrepared> {
  const env = readCollabWorkerEnv();
  if (!env) return { kind: "none" };
  try {
    const result = await beginCollabRoomRestore(env, key, id);
    if (!result) return { kind: "none" };
    if (!result.ok) return { kind: "busy" };
    const state = base64ToBytes(result.state);
    const content = result.seeded ? readCollabStateContent(state) : null;
    return {
      kind: "ready",
      clean: result.clean,
      seeded: result.seeded,
      lifecycle: result.lifecycle,
      content: content ? { html: content.html, fields: content.fields } : null,
    };
  } catch {
    return { kind: "failed" };
  }
}

export async function abortCollabRestore(key: string, id: string): Promise<void> {
  const env = readCollabWorkerEnv();
  if (!env) return;
  await abortCollabRoomRestore(env, key, id).catch(() => undefined);
}

const RESTORE_APPLY_ATTEMPTS = 3;

/**
 * 복원 commit 뒤: 같은 live 문서에 복원본을 한 update로 적용한다(room을 비우지 않는다).
 * room이 잠시 보관하는 동안 지금 상태(C)를 받아 서버에서 update를 만들고, lifecycle이 더 클 때만 적용된다.
 * 시드되지 않은 room은 지울 내용이 없으므로 lifecycle만 맞춘다(시드가 새 head로 채운다).
 * 실패해도 D1은 이미 복원됐다: 옛 lifecycle 저장은 거부되고, 다음 토큰 발급의 repair가 다시 적용한다.
 */
export async function applyCollabRestore(
  key: string,
  id: string,
  target: number,
  revision: { html: string; fields: MergeFields },
): Promise<boolean> {
  const env = readCollabWorkerEnv();
  if (!env) return true;
  for (let attempt = 0; attempt < RESTORE_APPLY_ATTEMPTS; attempt += 1) {
    try {
      const held = await holdCollabRoomRestore(env, key, id);
      if (!held) return true;
      if (!held.ok) continue;
      if (held.lifecycle >= target) {
        await applyCollabRoomRestore(env, key, { id, target, update: "", token: held.token }).catch(() => null);
        return true;
      }
      if (!held.seeded) {
        // 시드 전 room: 지울 내용이 없다. lifecycle만 맞추면 시드가 새 head로 채운다.
        const applied = await applyCollabRoomRestore(env, key, { id, target, update: "", token: held.token });
        if (applied?.ok) return true;
        continue;
      }
      const current = base64ToBytes(held.state);
      const update = buildCollabRestoreUpdate({
        base: held.base ? base64ToBytes(held.base) : null,
        current,
        html: revision.html,
        fields: revision.fields,
        lifecycle: target,
      });
      const applied = await applyCollabRoomRestore(env, key, { id, target, update: bytesToBase64(update), token: held.token });
      if (applied?.ok) return true;
    } catch {
      // 다시 시도한다.
    }
  }
  console.error(JSON.stringify({ event: "collab_room_restore", outcome: "failed", kind: key.split(":")[0] }));
  return false;
}

/**
 * room이 D1보다 뒤처졌으면(복원 commit 뒤 적용 전에 action이 끝남) 같은 복원을 다시 적용한다.
 * 토큰 발급 전에 부른다(읽기 사용자의 요청도 room을 수렴시킨다). 기준은 room에 남은 복원 기록, 없으면 지금 상태.
 */
export async function repairCollabRoomIfBehind(
  key: string,
  lifecycle: number,
  loadRevision: () => Promise<{ html: string; fields: MergeFields } | null>,
): Promise<void> {
  const env = readCollabWorkerEnv();
  if (!env || lifecycle <= 0) return;
  const current = await readCollabRoomEpoch(env, key).catch(() => null);
  if (current === null || current >= lifecycle) return;
  const revision = await loadRevision().catch(() => null);
  if (!revision) return;
  await applyCollabRestore(key, `repair:${lifecycle}`, lifecycle, revision);
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
