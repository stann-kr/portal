import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  COLLAB_CLOSE_EXPIRED,
  COLLAB_CLOSE_RESET,
  COLLAB_CLOSE_TOO_LARGE,
  COLLAB_MAX_MESSAGE_BYTES,
  COLLAB_MAX_ROOM_BYTES,
  COLLAB_MESSAGE_AWARENESS,
  COLLAB_MESSAGE_CONTROL,
  COLLAB_MESSAGE_SYNC,
  COLLAB_CLOSE_GONE,
  COLLAB_CLOSE_STALE,
  COLLAB_LEASE_SECONDS,
  type CollabClientControlMessage,
  type CollabControlMessage,
  type CollabMode,
} from "./protocol";
import type { CollabTokenClaims } from "./token";
import { collabSavedMarker } from "./saved-marker";

/**
 * 문서 room의 동기화 규칙. Durable Object(document-room.ts)가 저장소와 소켓을 넘겨 쓰고,
 * 단위 테스트는 메모리 구현으로 같은 규칙을 검증한다.
 *
 * - 쓰기 권한 소켓의 update만 문서에 반영한다. 읽기 소켓은 step1(상태 요청)만 처리한다.
 * - 반영된 update는 즉시 저장한 뒤 다른 소켓에 전달한다. 저장이 실패하면 전달하지 않는다.
 * - update 로그가 쌓이면 하나의 snapshot으로 압축한다.
 * - 쓰기 소켓이 보낸 update는 저장한 뒤 그 소켓에 누적 개수(ack)를 알린다. 클라이언트는 이것으로 "서버 확인분"을 안다.
 * - 노트·게시물 room의 세대(epoch)는 D1 lifecycle 표지(마지막 복원 revision)이고 서버가 소유한다. 복원은 상태를 비우지 않고
 *   같은 문서에 적용하는 한 update다: `restoreBegin`(기준 S 영속화) → `restoreHold`(지금 상태 C, 잠시 들어오는 update를 큐에 보관)
 *   → `restoreApply`(lifecycle이 더 클 때만 update·lifecycle을 한 번에 저장하고 알린 뒤 큐 배출). 입력·연결은 막지 않는다.
 * - 연결은 토큰 lease까지만 유효하고, 더 새 토큰의 `renew`로만 연장된다(권한 회수·강등).
 */
export type RoomSocketAttachment = {
  userId: string;
  mode: CollabMode;
  /** 이 소켓의 room key(renew 토큰 확인용). */
  key: string;
  connectedAt: number;
  /** 권한 lease 끝(ms). 지나면 닫는다. renew로만 늘어난다. */
  validUntil: number;
  /** 마지막으로 받은 토큰의 발급 시각(ms). 더 새 토큰만 renew로 받는다. */
  leaseIat: number;
  /** 읽기로 강등됐다. 같은 연결은 다시 쓰기로 올리지 않는다. */
  downgraded?: boolean;
  /** 이 소켓이 알린 awareness client id. 연결이 끊기면 지운다. */
  awarenessClientIds: number[];
  /** 이 소켓에서 받아 저장한 update 개수(ack). */
  applied: number;
};

export interface RoomSocket {
  send(data: Uint8Array | string): void;
  close(code: number, reason: string): void;
  getAttachment(): RoomSocketAttachment | null;
  setAttachment(value: RoomSocketAttachment): void;
}

export type StoredRoomState = {
  /** 문서 세대. 노트·게시물은 D1 lifecycle 표지, 그 밖은 reset 횟수. */
  epoch: number;
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
  /** 알림 순번과 마지막 알림 시각(ms). */
  seq?: number;
  changedAt?: number;
  /** 저장 담당이 마지막으로 저장했다고 알린 state vector. */
  savedSv?: Uint8Array | null;
  /** 진행 중인 복원 기록(준비 때의 기준 상태 S). */
  restoreIntent?: RestoreIntent | null;
};

export type RestoreIntent = { id: string; at: number; base: Uint8Array };

export interface RoomStorage {
  load(): StoredRoomState;
  appendUpdate(update: Uint8Array): void;
  /** snapshot을 바꾸고 update 로그를 비운다. 한 transaction이어야 한다. */
  replaceWithSnapshot(snapshot: Uint8Array): void;
  /** 저장 상태(문서·savedSv)를 모두 지우고 새 epoch를 기록한다. */
  reset(nextEpoch: number): void;
  /** 상태를 지우지 않고 epoch(lifecycle)만 기록한다. */
  setEpoch?(epoch: number): void;
  setRestoreIntent?(intent: RestoreIntent | null): void;
  /** 여러 쓰기를 한 transaction으로 묶는다(없으면 그냥 실행). */
  transact?<T>(task: () => T): T;
  setSeq?(seq: number, changedAt: number): void;
  setSavedSv?(sv: Uint8Array | null): void;
}

/** renew 토큰 확인. DocumentRoom이 AUTH_SECRET으로 서명·만료·key를 확인해 claims를 돌려준다. */
export type RenewVerifier = (token: string, key: string) => Promise<CollabTokenClaims | null>;

export const ROOM_COMPACT_UPDATE_COUNT = 200;
/** room 밖에서 바꾼 칸의 D1 version을 남기는 meta key 접미사(`noteDate@v`). 내용 칸이 아니다. */
export const COLLAB_META_VERSION_SUFFIX = "@v";
/** 진행 중인 복원 기록이 다른 복원을 막는 시간(action이 중간에 죽으면 이 뒤 새 복원이 기록을 바꿀 수 있다). */
export const ROOM_RESTORE_INTENT_MS = 60_000;
/** 복원 update를 만드는 동안 들어온 update를 큐에 보관하는 최대 시간. 지나면 큐를 배출하고 이번 적용은 거부한다. */
export const ROOM_RESTORE_HOLD_MS = 3000;

/**
 * 서버 쪽 awareness(커서·이름) 보관. y-protocols Awareness는 주기 timer를 돌려 DO hibernation을 막으므로
 * 인코딩된 상태만 client id별로 들고 있는다. 각 client id는 처음 알린 소켓만 쓸 수 있고,
 * 서버가 `user.userId`를 토큰의 사용자로 덮어쓰며 읽기 소켓의 `canSave`는 false로 바꾼다.
 */
type AwarenessEntry = { clock: number; state: string; socket: RoomSocket };

type AwarenessDecoded = { clientId: number; clock: number; state: string };

export function decodeAwarenessUpdate(update: Uint8Array): AwarenessDecoded[] {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const entries: AwarenessDecoded[] = [];
  for (let index = 0; index < count; index += 1) {
    entries.push({
      clientId: decoding.readVarUint(decoder),
      clock: decoding.readVarUint(decoder),
      state: decoding.readVarString(decoder),
    });
  }
  return entries;
}

export function encodeAwarenessEntries(entries: readonly { clientId: number; clock: number; state: string }[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const entry of entries) {
    encoding.writeVarUint(encoder, entry.clientId);
    encoding.writeVarUint(encoder, entry.clock);
    encoding.writeVarString(encoder, entry.state);
  }
  return encoding.toUint8Array(encoder);
}

/** 서버가 보장하는 awareness 내용: 사용자 id는 토큰 기준, 저장 담당 자격은 쓰기 소켓만. */
export function sanitizeAwarenessState(state: string, attachment: RoomSocketAttachment): string {
  if (state === "null") return state;
  let parsed: unknown;
  try {
    parsed = JSON.parse(state);
  } catch {
    return "null";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "null";
  const value = parsed as Record<string, unknown>;
  const user = value.user && typeof value.user === "object" && !Array.isArray(value.user) ? (value.user as Record<string, unknown>) : {};
  return JSON.stringify({
    ...value,
    user: { ...user, userId: attachment.userId },
    canSave: attachment.mode === "write" && value.canSave === true,
  });
}
export const ROOM_COMPACT_BYTES = 1024 * 1024;

function encodeStateVectorBase64(doc: Y.Doc): string {
  const bytes = Y.encodeStateVector(doc);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodeControl(message: CollabControlMessage): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLAB_MESSAGE_CONTROL);
  encoding.writeVarString(encoder, JSON.stringify(message));
  return encoding.toUint8Array(encoder);
}

function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function encodeAwarenessMessage(entries: readonly { clientId: number; clock: number; state: string }[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLAB_MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodeAwarenessEntries(entries));
  return encoding.toUint8Array(encoder);
}

function safeSend(socket: RoomSocket, data: Uint8Array | string): void {
  try {
    socket.send(data);
  } catch {
    // 이미 닫힌 소켓은 close 이벤트에서 정리된다.
  }
}

function safeClose(socket: RoomSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // 이미 닫혔다.
  }
}

type RestoreHold = {
  id: string;
  /** 보관 중 받은 메시지(받은 순서대로 배출한다). */
  queue: Array<{ socket: RoomSocket; data: Uint8Array }>;
  timer: ReturnType<typeof setTimeout>;
};

export type RestoreBeginResult =
  | { ok: true; state: Uint8Array; clean: boolean; seeded: boolean; lifecycle: number }
  | { ok: false; reason: "busy" };

export type RestoreHoldResult =
  | { ok: true; state: Uint8Array; base: Uint8Array | null; lifecycle: number; seeded: boolean }
  | { ok: false; reason: "busy" };

export type RestoreApplyResult = { ok: true; applied: boolean; lifecycle: number } | { ok: false; reason: "expired" };

function bytesEqual(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * "저장한 내용과 같은가"의 비교 값. state vector만으로는 삭제(같은 clock 안의 delete)를 구분하지 못하므로
 * delete set까지 포함한 Yjs snapshot을 쓴다. 클라이언트(`collabSavedMarker`)와 같은 식이다.
 */
export const roomSavedMarker = collabSavedMarker;

export type RoomConnectInput = {
  userId: string;
  mode: CollabMode;
  key?: string;
  /** lease 끝(ms). 없으면 지금 + lease. */
  validUntil?: number;
  leaseIat?: number;
  /** 토큰의 lifecycle 표지(노트·게시물). */
  lifecycle?: number | null;
};

export class RoomCore {
  private doc: Y.Doc | null = null;
  private readonly awareness = new Map<number, AwarenessEntry>();
  private epoch = 0;
  private seq = 0;
  private changedAt = 0;
  private savedSv: Uint8Array | null = null;
  private snapshotBytes = 0;
  private pendingUpdateBytes = 0;
  private pendingUpdateCount = 0;
  private intent: RestoreIntent | null = null;
  private hold: RestoreHold | null = null;

  constructor(
    private readonly storage: RoomStorage,
    private readonly sockets: () => RoomSocket[],
    private readonly now: () => number = Date.now,
    private readonly verifyRenew: RenewVerifier | null = null,
    /** lease 끝이 바뀌면 알린다(DocumentRoom이 alarm을 맞춘다). */
    private readonly onDeadline: ((deadline: number | null) => void) | null = null,
  ) {}

  private load(): { doc: Y.Doc } {
    if (this.doc) return { doc: this.doc };
    const state = this.storage.load();
    const doc = new Y.Doc({ gc: true });
    this.epoch = state.epoch;
    this.seq = state.seq ?? 0;
    this.changedAt = state.changedAt ?? 0;
    this.savedSv = state.savedSv ?? null;
    this.intent = state.restoreIntent ?? null;
    this.snapshotBytes = state.snapshot?.byteLength ?? 0;
    this.pendingUpdateBytes = 0;
    this.pendingUpdateCount = 0;
    if (state.snapshot) Y.applyUpdate(doc, state.snapshot);
    for (const update of state.updates) {
      Y.applyUpdate(doc, update);
      this.pendingUpdateBytes += update.byteLength;
      this.pendingUpdateCount += 1;
    }
    doc.on("update", (update: Uint8Array, origin: unknown) => this.onDocUpdate(update, origin));
    this.doc = doc;
    this.restoreAwarenessOwnership();
    return { doc };
  }

  private onDocUpdate(update: Uint8Array, origin: unknown): void {
    this.storage.appendUpdate(update);
    this.pendingUpdateBytes += update.byteLength;
    this.pendingUpdateCount += 1;
    // 반영한 소켓(origin)을 뺀 나머지에 전달한다. 서버가 직접 바꾼 칸(set-meta)은 origin이 없어 모두에게 간다.
    const except = origin && typeof origin === "object" && "send" in origin ? (origin as RoomSocket) : null;
    this.broadcast(encodeSyncUpdate(update), except);
    if (
      this.pendingUpdateCount >= ROOM_COMPACT_UPDATE_COUNT ||
      this.pendingUpdateBytes >= ROOM_COMPACT_BYTES
    ) {
      this.compact();
    }
  }

  private compact(): void {
    if (!this.doc) return;
    const snapshot = Y.encodeStateAsUpdate(this.doc);
    this.storage.replaceWithSnapshot(snapshot);
    this.snapshotBytes = snapshot.byteLength;
    this.pendingUpdateBytes = 0;
    this.pendingUpdateCount = 0;
  }

  /** 현재 저장 크기 추정(snapshot + 압축 전 update). */
  get storedBytes(): number {
    return this.snapshotBytes + this.pendingUpdateBytes;
  }

  get currentEpoch(): number {
    this.load();
    return this.epoch;
  }

  get isHolding(): boolean {
    return this.hold !== null;
  }

  private restoreAwarenessOwnership(): void {
    for (const socket of this.sockets()) {
      for (const clientId of socket.getAttachment()?.awarenessClientIds ?? []) {
        if (!this.awareness.has(clientId)) this.awareness.set(clientId, { clock: 0, state: "null", socket });
      }
    }
  }

  /** 다른 소켓에 전달한다. lease가 지난 소켓은 받기만 하더라도 닫는다. */
  private broadcast(message: Uint8Array, except: RoomSocket | null): void {
    for (const socket of this.sockets()) {
      if (socket === except) continue;
      if (this.isExpired(socket)) {
        safeClose(socket, COLLAB_CLOSE_EXPIRED, "expired");
        continue;
      }
      safeSend(socket, message);
    }
  }

  private isExpired(socket: RoomSocket): boolean {
    const attachment = socket.getAttachment();
    return !attachment || this.now() > attachment.validUntil;
  }

  /** 가장 이른 lease 끝(ms). 조용한 소켓도 제때 닫도록 alarm에 쓴다. */
  nextDeadline(): number | null {
    let deadline: number | null = null;
    for (const socket of this.sockets()) {
      const until = socket.getAttachment()?.validUntil;
      if (typeof until === "number" && (deadline === null || until < deadline)) deadline = until;
    }
    return deadline;
  }

  /** lease가 지난 소켓을 닫는다(alarm). */
  sweepExpired(): void {
    for (const socket of this.sockets()) {
      if (this.isExpired(socket)) safeClose(socket, COLLAB_CLOSE_EXPIRED, "expired");
    }
    this.onDeadline?.(this.nextDeadline());
  }

  connect(socket: RoomSocket, input: RoomConnectInput): void {
    this.load();
    if (typeof input.lifecycle === "number") {
      if (input.lifecycle < this.epoch) {
        safeSend(socket, encodeControl({ t: "error", code: "stale" }));
        safeClose(socket, COLLAB_CLOSE_STALE, "stale");
        return;
      }
      // 아직 시드되지 않은 room은 지울 내용이 없으므로 D1 세대를 그대로 따른다(시드가 그 세대의 head로 채운다).
      // 시드된 room이 뒤처졌으면(복원 적용 전 action 중단) 토큰 route의 repair가 같은 문서에 복원을 적용한다.
      if (input.lifecycle > this.epoch && !this.isSeeded()) this.setEpoch(input.lifecycle);
    }
    const { doc } = this.load();
    const now = this.now();
    socket.setAttachment({
      userId: input.userId,
      mode: input.mode,
      key: input.key ?? "",
      connectedAt: now,
      validUntil: input.validUntil ?? now + COLLAB_LEASE_SECONDS * 1000,
      leaseIat: input.leaseIat ?? 0,
      awarenessClientIds: [],
      applied: 0,
    });
    safeSend(
      socket,
      encodeControl({ t: "hello", epoch: this.epoch, mode: input.mode, seq: this.seq, ...(this.changedAt ? { changedAt: this.changedAt } : {}) }),
    );
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    safeSend(socket, encoding.toUint8Array(encoder));
    const live = Array.from(this.awareness.entries())
      .filter(([, entry]) => entry.state !== "null")
      .map(([clientId, entry]) => ({ clientId, clock: entry.clock, state: entry.state }));
    if (live.length > 0) safeSend(socket, encodeAwarenessMessage(live));
    this.onDeadline?.(this.nextDeadline());
  }

  message(socket: RoomSocket, data: Uint8Array): void {
    const attachment = socket.getAttachment();
    if (!attachment) {
      safeClose(socket, 1008, "no-session");
      return;
    }
    if (this.isExpired(socket)) {
      safeClose(socket, COLLAB_CLOSE_EXPIRED, "expired");
      return;
    }
    if (data.byteLength > COLLAB_MAX_MESSAGE_BYTES) {
      safeSend(socket, encodeControl({ t: "error", code: "too-large" }));
      safeClose(socket, COLLAB_CLOSE_TOO_LARGE, "too-large");
      return;
    }
    const { doc } = this.load();
    // 복원 update를 만드는 동안 받은 문서 변경은 큐에 두었다가 적용 뒤 같은 순서로 처리한다(입력·연결은 막지 않는다).
    if (this.hold && data.byteLength > 0 && data[0] === COLLAB_MESSAGE_SYNC && attachment.mode === "write") {
      this.hold.queue.push({ socket, data });
      return;
    }
    try {
      const decoder = decoding.createDecoder(data);
      const type = decoding.readVarUint(decoder);
      if (type === COLLAB_MESSAGE_SYNC) {
        this.handleSync(socket, attachment, decoder, doc);
      } else if (type === COLLAB_MESSAGE_AWARENESS) {
        this.handleAwareness(socket, attachment, decoder);
      } else if (type === COLLAB_MESSAGE_CONTROL) {
        const message = JSON.parse(decoding.readVarString(decoder)) as CollabClientControlMessage;
        if (!message || typeof message !== "object" || typeof message.t !== "string") throw new Error("bad control");
        this.handleClientControl(socket, attachment, message);
      } else {
        throw new Error("unknown message type");
      }
    } catch {
      safeSend(socket, encodeControl({ t: "error", code: "bad-message" }));
      safeClose(socket, 1007, "bad-message");
    }
  }

  private handleSync(
    socket: RoomSocket,
    attachment: RoomSocketAttachment,
    decoder: decoding.Decoder,
    doc: Y.Doc,
  ): void {
    const subtype = decoding.readVarUint(decoder);
    if (subtype === syncProtocol.messageYjsSyncStep1) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
      syncProtocol.readSyncStep1(decoder, encoder, doc);
      safeSend(socket, encoding.toUint8Array(encoder));
      return;
    }
    if (subtype !== syncProtocol.messageYjsSyncStep2 && subtype !== syncProtocol.messageYjsUpdate) {
      throw new Error("unknown sync message");
    }
    const update = decoding.readVarUint8Array(decoder);
    if (attachment.mode !== "write") {
      safeSend(socket, encodeControl({ t: "error", code: "read-only" }));
      return;
    }
    if (this.storedBytes + update.byteLength > COLLAB_MAX_ROOM_BYTES) {
      this.compact();
      if (this.storedBytes + update.byteLength > COLLAB_MAX_ROOM_BYTES) {
        safeSend(socket, encodeControl({ t: "error", code: "too-large" }));
        safeClose(socket, COLLAB_CLOSE_TOO_LARGE, "too-large");
        return;
      }
    }
    Y.applyUpdate(doc, update, socket);
    // 저장(appendUpdate)은 위 update 이벤트에서 끝났다. 받은 개수를 알려 클라이언트가 확인분을 갱신하게 한다.
    const applied = attachment.applied + 1;
    socket.setAttachment({ ...attachment, applied });
    safeSend(socket, encodeControl({ t: "ack", n: applied }));
  }

  private handleAwareness(socket: RoomSocket, attachment: RoomSocketAttachment, decoder: decoding.Decoder): void {
    const entries = decodeAwarenessUpdate(decoding.readVarUint8Array(decoder));
    const accepted: AwarenessDecoded[] = [];
    const owned = new Set(attachment.awarenessClientIds);
    for (const entry of entries) {
      const current = this.awareness.get(entry.clientId);
      // 다른 소켓이 쓰는 client id는 바꿀 수 없다(커서·저장 담당 위조 방지).
      if (current && current.socket !== socket) continue;
      if (current && entry.clock < current.clock) continue;
      const state = sanitizeAwarenessState(entry.state, attachment);
      this.awareness.set(entry.clientId, { clock: entry.clock, state, socket });
      owned.add(entry.clientId);
      accepted.push({ clientId: entry.clientId, clock: entry.clock, state });
    }
    if (owned.size !== attachment.awarenessClientIds.length) {
      socket.setAttachment({ ...attachment, awarenessClientIds: Array.from(owned) });
    }
    if (accepted.length === 0) return;
    this.broadcast(encodeAwarenessMessage(accepted), socket);
  }

  private handleClientControl(socket: RoomSocket, attachment: RoomSocketAttachment, message: CollabClientControlMessage): void {
    switch (message.t) {
      case "saved": {
        if (attachment.mode !== "write" || typeof message.sv !== "string") return;
        const sv = base64ToBytes(message.sv);
        // 저장한 내용이 지금 room 상태와 같을 때만 "저장됨"으로 기록한다.
        if (sv && bytesEqual(sv, roomSavedMarker(this.load().doc))) this.setSavedSv(sv);
        return;
      }
      case "renew": {
        if (typeof message.token !== "string" || !this.verifyRenew) return;
        void this.renew(socket, message.token);
        return;
      }
      default:
        throw new Error("unknown control");
    }
  }

  private async renew(socket: RoomSocket, token: string): Promise<void> {
    const before = socket.getAttachment();
    if (!before || !this.verifyRenew) return;
    const claims = await this.verifyRenew(token, before.key).catch(() => null);
    const attachment = socket.getAttachment();
    if (!claims || !attachment || claims.u !== attachment.userId || claims.k !== attachment.key) return;
    // 더 새 토큰만 받는다. 같은 토큰을 다시 보내 lease를 늘릴 수 없다.
    if (claims.i <= attachment.leaseIat) return;
    if (this.isExpired(socket)) {
      safeClose(socket, COLLAB_CLOSE_EXPIRED, "expired");
      return;
    }
    if (typeof claims.e === "number" && claims.e < this.currentEpoch) {
      // D1보다 앞선 room 세대는 생기지 않는다. 옛 토큰이면 닫고 새 토큰으로 다시 붙게 한다.
      safeClose(socket, COLLAB_CLOSE_STALE, "stale");
      return;
    }
    const downgrade = attachment.mode === "write" && claims.m === "read";
    const next: RoomSocketAttachment = {
      ...attachment,
      validUntil: claims.l * 1000,
      leaseIat: claims.i,
      ...(downgrade ? { mode: "read" as const, downgraded: true } : {}),
    };
    socket.setAttachment(next);
    if (downgrade) {
      safeSend(socket, encodeControl({ t: "mode", mode: "read" }));
      // 저장 담당 자격을 거둔다(다른 사람 화면의 선출도 바뀐다).
      const changed: AwarenessDecoded[] = [];
      for (const [clientId, entry] of this.awareness) {
        if (entry.socket !== socket || entry.state === "null") continue;
        const state = sanitizeAwarenessState(entry.state, next);
        const clock = entry.clock + 1;
        this.awareness.set(clientId, { clock, state, socket });
        changed.push({ clientId, clock, state });
      }
      if (changed.length > 0) this.broadcast(encodeAwarenessMessage(changed), null);
    }
    this.onDeadline?.(this.nextDeadline());
  }

  private setSavedSv(sv: Uint8Array | null): void {
    this.savedSv = sv;
    this.storage.setSavedSv?.(sv);
  }

  /** room 상태가 마지막 저장과 같은지(또는 아직 비어 있는지). */
  private isClean(): boolean {
    const { doc } = this.load();
    if (doc.store.clients.size === 0) return true;
    return bytesEqual(this.savedSv, roomSavedMarker(doc));
  }

  private isSeeded(): boolean {
    return this.load().doc.getMap("meta").has("seeded");
  }

  private setEpoch(epoch: number): void {
    this.epoch = epoch;
    this.storage.setEpoch?.(epoch);
  }

  private setIntent(intent: RestoreIntent | null): void {
    this.intent = intent;
    this.storage.setRestoreIntent?.(intent);
  }

  /**
   * 복원 준비: 지금 상태를 기준 S로 영속화하고 돌려준다. 입력·연결은 막지 않는다.
   * 다른 복원이 진행 중이면(기록이 아직 새것) busy.
   */
  restoreBegin(id: string): RestoreBeginResult {
    const { doc } = this.load();
    const now = this.now();
    if ((this.intent && this.intent.id !== id && now - this.intent.at < ROOM_RESTORE_INTENT_MS) || (this.hold && this.hold.id !== id)) {
      return { ok: false, reason: "busy" };
    }
    const state = Y.encodeStateAsUpdate(doc);
    this.setIntent({ id, at: now, base: state });
    return { ok: true, state, clean: this.isClean(), seeded: this.isSeeded(), lifecycle: this.epoch };
  }

  /** 복원 준비를 취소한다(복원하지 않기로 함). 같은 id일 때만. */
  restoreAbort(id: string): void {
    this.load();
    if (this.intent?.id === id) this.setIntent(null);
    if (this.hold?.id === id) this.releaseHold();
  }

  /**
   * 복원 update를 만들 지금 상태 C를 돌려주고, 적용할 때까지(최대 ROOM_RESTORE_HOLD_MS) 들어오는 update를 큐에 보관한다.
   * 준비 기록이 없으면(repair) C가 기준이다.
   */
  restoreHold(id: string): RestoreHoldResult {
    const { doc } = this.load();
    if (this.hold && this.hold.id !== id) return { ok: false, reason: "busy" };
    if (this.hold) clearTimeout(this.hold.timer);
    const queue = this.hold?.queue ?? [];
    const hold: RestoreHold = {
      id,
      queue,
      timer: setTimeout(() => {
        if (this.hold === hold) this.releaseHold();
      }, ROOM_RESTORE_HOLD_MS),
    };
    this.hold = hold;
    const base = this.intent?.id === id ? this.intent.base : null;
    return { ok: true, state: Y.encodeStateAsUpdate(doc), base, lifecycle: this.epoch, seeded: this.isSeeded() };
  }

  /**
   * 복원 update를 적용한다. hold가 이 id로 유효하고 target이 지금 lifecycle보다 클 때만:
   * 모든 소켓에 `restored`를 알린 뒤 update·lifecycle·기록 삭제를 한 transaction으로 저장·전달하고 큐를 배출한다.
   * target이 같거나 작으면(이미 적용) 적용하지 않고 성공으로 끝낸다.
   */
  restoreApply(id: string, target: number, update: Uint8Array): RestoreApplyResult {
    const { doc } = this.load();
    if (!this.hold || this.hold.id !== id) return { ok: false, reason: "expired" };
    if (!Number.isSafeInteger(target) || target <= this.epoch) {
      if (this.intent?.id === id) this.setIntent(null);
      this.releaseHold();
      return { ok: true, applied: false, lifecycle: this.epoch };
    }
    const base = encodeStateVectorBase64(doc);
    this.broadcast(encodeControl({ t: "restored", id, lifecycle: target, base }), null);
    const apply = () => {
      if (update.byteLength > 0) Y.applyUpdate(doc, update, null);
      this.setEpoch(target);
      this.setIntent(null);
    };
    if (this.storage.transact) this.storage.transact(apply);
    else apply();
    this.releaseHold();
    return { ok: true, applied: true, lifecycle: target };
  }

  private releaseHold(): void {
    const hold = this.hold;
    if (!hold) return;
    clearTimeout(hold.timer);
    this.hold = null;
    for (const entry of hold.queue) this.message(entry.socket, entry.data);
  }

  /** 소켓이 닫히면 그 소켓의 커서를 다른 사람 화면에서 지운다. 마지막 연결이면 메모리 상태를 내려놓는다. */
  disconnect(socket: RoomSocket): void {
    const removed: AwarenessDecoded[] = [];
    for (const [clientId, entry] of this.awareness) {
      if (entry.socket !== socket) continue;
      this.awareness.delete(clientId);
      removed.push({ clientId, clock: entry.clock + 1, state: "null" });
    }
    if (removed.length > 0) this.broadcast(encodeAwarenessMessage(removed), socket);
    if (this.hold) this.hold.queue = this.hold.queue.filter((entry) => entry.socket !== socket);
    if (this.sockets().every((other) => other === socket) && !this.hold) this.destroy();
  }

  /** 메모리 상태를 정리한다(다음 연결에서 저장소로부터 다시 읽는다). */
  destroy(): void {
    this.doc?.destroy();
    this.doc = null;
    this.awareness.clear();
  }

  private resetTo(nextEpoch: number, except: RoomSocket | null = null): number {
    if (this.hold) {
      clearTimeout(this.hold.timer);
      this.hold = null;
    }
    this.intent = null;
    this.storage.reset(nextEpoch);
    this.destroy();
    this.epoch = nextEpoch;
    this.savedSv = null;
    this.snapshotBytes = 0;
    this.pendingUpdateBytes = 0;
    this.pendingUpdateCount = 0;
    const message = encodeControl({ t: "reset", epoch: nextEpoch });
    for (const socket of this.sockets()) {
      if (socket === except) continue;
      safeSend(socket, message);
      safeClose(socket, COLLAB_CLOSE_RESET, "reset");
    }
    return nextEpoch;
  }

  /** 저장 상태를 지우고 epoch를 올린 뒤 모든 연결에 알리고 닫는다(lifecycle이 없는 가이드·작성본). */
  reset(): number {
    this.load();
    return this.resetTo(this.epoch + 1);
  }

  /** 연결을 모두 닫는다. keep이면 상태를 보존한다(휴지통 — 복구하면 그대로 이어진다). */
  closeAll(keep: boolean): void {
    this.load();
    if (!keep) {
      this.resetTo(this.epoch + 1);
      return;
    }
    for (const socket of this.sockets()) safeClose(socket, COLLAB_CLOSE_GONE, "gone");
  }

  /** room 밖에서 바뀐 칸을 room에 반영한다. 아직 시드되지 않은 room은 건드리지 않는다(시드가 새 head를 읽는다). */
  setMeta(field: string, value: string, epoch?: number, version?: number): boolean {
    const { doc } = this.load();
    // 늦게 도착한 옛 세대의 변경(복원 전 날짜 이동)은 새 세대에 적용하지 않는다.
    if (typeof epoch === "number" && epoch !== this.epoch) return false;
    const meta = doc.getMap("meta");
    if (!meta.has("seeded")) return false;
    // 같은 세대 안에서도 늦게 도착한 옛 변경은 무시한다: 그 칸의 마지막 반영 version과 저장 담당이 알린 head version보다 새 것만.
    const versionKey = `${field}${COLLAB_META_VERSION_SUFFIX}`;
    if (typeof version === "number") {
      const fieldVersion = meta.get(versionKey);
      const headVersion = meta.get("headVersion");
      if ((typeof fieldVersion === "number" && version <= fieldVersion) || (typeof headVersion === "number" && version < headVersion)) {
        return false;
      }
    }
    if (meta.get(field) === value && typeof version !== "number") return true;
    const wasClean = this.isClean();
    doc.transact(() => {
      meta.set(field, value);
      if (typeof version === "number") meta.set(versionKey, version);
    }, null);
    // D1에 이미 반영된 값이므로, 저장된 상태였다면 그대로 저장된 상태로 둔다.
    if (wasClean) this.setSavedSv(roomSavedMarker(doc));
    return true;
  }

  /** 알림 room: 순번을 올리고 모두에게 알린다. */
  notify(): number {
    this.load();
    this.seq += 1;
    this.changedAt = this.now();
    this.storage.setSeq?.(this.seq, this.changedAt);
    this.broadcast(encodeControl({ t: "changed", seq: this.seq }), null);
    return this.seq;
  }
}

/** WebSocket close 코드는 1005·1006 같은 예약 코드를 다시 보낼 수 없다. */
export function normalizeCloseCode(code: number): number {
  if (code === 1000 || (code >= 3000 && code <= 4999)) return code;
  if (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) return code;
  return 1000;
}
