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
  COLLAB_SOCKET_MAX_AGE_MS,
  type CollabControlMessage,
  type CollabMode,
} from "./protocol";

/**
 * 문서 room의 동기화 규칙. Durable Object(document-room.ts)가 저장소와 소켓을 넘겨 쓰고,
 * 단위 테스트는 메모리 구현으로 같은 규칙을 검증한다.
 *
 * - 쓰기 권한 소켓의 update만 문서에 반영한다. 읽기 소켓은 step1(상태 요청)만 처리한다.
 * - 반영된 update는 즉시 저장한 뒤 다른 소켓에 전달한다. 저장이 실패하면 전달하지 않는다.
 * - update 로그가 쌓이면 하나의 snapshot으로 압축한다.
 * - reset은 epoch를 올리고 저장 상태를 지운 뒤 모든 연결을 닫는다(복원·휴지통 이동 뒤).
 */
export type RoomSocketAttachment = {
  userId: string;
  mode: CollabMode;
  connectedAt: number;
  /** 이 소켓이 알린 awareness client id. 연결이 끊기면 지운다. */
  awarenessClientIds: number[];
};

export interface RoomSocket {
  send(data: Uint8Array | string): void;
  close(code: number, reason: string): void;
  getAttachment(): RoomSocketAttachment | null;
  setAttachment(value: RoomSocketAttachment): void;
}

export type StoredRoomState = {
  epoch: number;
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
};

export interface RoomStorage {
  load(): StoredRoomState;
  appendUpdate(update: Uint8Array): void;
  /** snapshot을 바꾸고 update 로그를 비운다. 한 transaction이어야 한다. */
  replaceWithSnapshot(snapshot: Uint8Array): void;
  /** 저장 상태를 모두 지우고 새 epoch를 기록한다. */
  reset(nextEpoch: number): void;
}

export const ROOM_COMPACT_UPDATE_COUNT = 200;

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

export class RoomCore {
  private doc: Y.Doc | null = null;
  private readonly awareness = new Map<number, AwarenessEntry>();
  private epoch = 0;
  private snapshotBytes = 0;
  private pendingUpdateBytes = 0;
  private pendingUpdateCount = 0;

  constructor(
    private readonly storage: RoomStorage,
    private readonly sockets: () => RoomSocket[],
    private readonly now: () => number = Date.now,
  ) {}

  private load(): { doc: Y.Doc } {
    if (this.doc) return { doc: this.doc };
    const state = this.storage.load();
    const doc = new Y.Doc({ gc: true });
    this.epoch = state.epoch;
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
    // 반영한 소켓(origin)을 뺀 나머지에 전달한다. 서버에서 update를 만드는 곳은 소켓 메시지뿐이다.
    this.broadcast(encodeSyncUpdate(update), (origin ?? null) as RoomSocket | null);
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

  /**
   * 휴면 복귀로 메모리가 비면 소켓 attachment에 남은 client id 소유권만 되살린다. 상태는 각 클라이언트가
   * 주기적으로 다시 알리므로(clock 증가) 그때 채워진다. 그 사이 다른 소켓이 그 id를 가로채지 못한다.
   */
  private restoreAwarenessOwnership(): void {
    for (const socket of this.sockets()) {
      for (const clientId of socket.getAttachment()?.awarenessClientIds ?? []) {
        if (!this.awareness.has(clientId)) this.awareness.set(clientId, { clock: 0, state: "null", socket });
      }
    }
  }

  /** 다른 소켓에 전달한다. 최대 연결 시간이 지난 소켓은 받기만 하더라도 닫아 권한을 다시 확인하게 한다. */
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
    return !attachment || this.now() - attachment.connectedAt > COLLAB_SOCKET_MAX_AGE_MS;
  }

  connect(socket: RoomSocket, input: { userId: string; mode: CollabMode }): void {
    const { doc } = this.load();
    socket.setAttachment({
      userId: input.userId,
      mode: input.mode,
      connectedAt: this.now(),
      awarenessClientIds: [],
    });
    safeSend(socket, encodeControl({ t: "hello", epoch: this.epoch, mode: input.mode }));
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    safeSend(socket, encoding.toUint8Array(encoder));
    const live = Array.from(this.awareness.entries())
      .filter(([, entry]) => entry.state !== "null")
      .map(([clientId, entry]) => ({ clientId, clock: entry.clock, state: entry.state }));
    if (live.length > 0) safeSend(socket, encodeAwarenessMessage(live));
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
    try {
      const decoder = decoding.createDecoder(data);
      const type = decoding.readVarUint(decoder);
      if (type === COLLAB_MESSAGE_SYNC) {
        this.handleSync(socket, attachment, decoder, doc);
      } else if (type === COLLAB_MESSAGE_AWARENESS) {
        this.handleAwareness(socket, attachment, decoder);
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

  /** 소켓이 닫히면 그 소켓의 커서를 다른 사람 화면에서 지운다. 마지막 연결이면 메모리 상태를 내려놓는다. */
  disconnect(socket: RoomSocket): void {
    const removed: AwarenessDecoded[] = [];
    for (const [clientId, entry] of this.awareness) {
      if (entry.socket !== socket) continue;
      this.awareness.delete(clientId);
      removed.push({ clientId, clock: entry.clock + 1, state: "null" });
    }
    if (removed.length > 0) this.broadcast(encodeAwarenessMessage(removed), socket);
    if (this.sockets().every((other) => other === socket)) this.destroy();
  }

  /** 메모리 상태를 정리한다(다음 연결에서 저장소로부터 다시 읽는다). */
  destroy(): void {
    this.doc?.destroy();
    this.doc = null;
    this.awareness.clear();
  }

  /** 저장 상태를 지우고 epoch를 올린 뒤 모든 연결에 알리고 닫는다. */
  reset(): number {
    this.load();
    const nextEpoch = this.epoch + 1;
    this.storage.reset(nextEpoch);
    this.destroy();
    this.epoch = nextEpoch;
    this.snapshotBytes = 0;
    this.pendingUpdateBytes = 0;
    this.pendingUpdateCount = 0;
    const message = encodeControl({ t: "reset", epoch: nextEpoch });
    for (const socket of this.sockets()) {
      safeSend(socket, message);
      safeClose(socket, COLLAB_CLOSE_RESET, "reset");
    }
    return nextEpoch;
  }
}

/** WebSocket close 코드는 1005·1006 같은 예약 코드를 다시 보낼 수 없다. */
export function normalizeCloseCode(code: number): number {
  if (code === 1000 || (code >= 3000 && code <= 4999)) return code;
  if (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) return code;
  return 1000;
}
