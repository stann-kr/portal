import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
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
  private awareness: awarenessProtocol.Awareness | null = null;
  private epoch = 0;
  private snapshotBytes = 0;
  private pendingUpdateBytes = 0;
  private pendingUpdateCount = 0;

  constructor(
    private readonly storage: RoomStorage,
    private readonly sockets: () => RoomSocket[],
    private readonly now: () => number = Date.now,
  ) {}

  private load(): { doc: Y.Doc; awareness: awarenessProtocol.Awareness } {
    if (this.doc && this.awareness) return { doc: this.doc, awareness: this.awareness };
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
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);
    this.doc = doc;
    this.awareness = awareness;
    return { doc, awareness };
  }

  private onDocUpdate(update: Uint8Array, origin: unknown): void {
    this.storage.appendUpdate(update);
    this.pendingUpdateBytes += update.byteLength;
    this.pendingUpdateCount += 1;
    const message = encodeSyncUpdate(update);
    for (const socket of this.sockets()) {
      if (socket !== origin) safeSend(socket, message);
    }
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

  connect(socket: RoomSocket, input: { userId: string; mode: CollabMode }): void {
    const { doc, awareness } = this.load();
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
    const states = Array.from(awareness.getStates().keys());
    if (states.length > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, COLLAB_MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, states),
      );
      safeSend(socket, encoding.toUint8Array(awarenessEncoder));
    }
  }

  message(socket: RoomSocket, data: Uint8Array): void {
    const attachment = socket.getAttachment();
    if (!attachment) {
      safeClose(socket, 1008, "no-session");
      return;
    }
    if (this.now() - attachment.connectedAt > COLLAB_SOCKET_MAX_AGE_MS) {
      safeClose(socket, COLLAB_CLOSE_EXPIRED, "expired");
      return;
    }
    if (data.byteLength > COLLAB_MAX_MESSAGE_BYTES) {
      safeSend(socket, encodeControl({ t: "error", code: "too-large" }));
      safeClose(socket, COLLAB_CLOSE_TOO_LARGE, "too-large");
      return;
    }
    const { doc, awareness } = this.load();
    try {
      const decoder = decoding.createDecoder(data);
      const type = decoding.readVarUint(decoder);
      if (type === COLLAB_MESSAGE_SYNC) {
        this.handleSync(socket, attachment, decoder, doc);
      } else if (type === COLLAB_MESSAGE_AWARENESS) {
        this.handleAwareness(socket, attachment, decoder, awareness);
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

  private handleAwareness(
    socket: RoomSocket,
    attachment: RoomSocketAttachment,
    decoder: decoding.Decoder,
    awareness: awarenessProtocol.Awareness,
  ): void {
    const update = decoding.readVarUint8Array(decoder);
    const clientIds = readAwarenessClientIds(update);
    const known = new Set(attachment.awarenessClientIds);
    let changed = false;
    for (const clientId of clientIds) {
      if (!known.has(clientId)) {
        known.add(clientId);
        changed = true;
      }
    }
    if (changed) socket.setAttachment({ ...attachment, awarenessClientIds: Array.from(known) });
    awarenessProtocol.applyAwarenessUpdate(awareness, update, socket);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLAB_MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const other of this.sockets()) {
      if (other !== socket) safeSend(other, message);
    }
  }

  /** 소켓이 닫히면 그 소켓의 커서를 다른 사람 화면에서 지운다. */
  disconnect(socket: RoomSocket): void {
    const attachment = socket.getAttachment();
    if (!attachment || attachment.awarenessClientIds.length === 0 || !this.awareness) return;
    const ids = attachment.awarenessClientIds.filter((id) => this.awareness?.getStates().has(id));
    if (ids.length === 0) return;
    awarenessProtocol.removeAwarenessStates(this.awareness, ids, "disconnect");
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLAB_MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids));
    const message = encoding.toUint8Array(encoder);
    for (const other of this.sockets()) {
      if (other !== socket) safeSend(other, message);
    }
  }

  /** 메모리 상태(awareness 갱신 timer 포함)를 정리한다. 테스트와 room 종료에서 쓴다. */
  destroy(): void {
    this.awareness?.destroy();
    this.doc?.destroy();
    this.awareness = null;
    this.doc = null;
  }

  /** 저장 상태를 지우고 epoch를 올린 뒤 모든 연결에 알리고 닫는다. */
  reset(): number {
    this.load();
    const nextEpoch = this.epoch + 1;
    this.storage.reset(nextEpoch);
    this.doc?.destroy();
    this.awareness?.destroy();
    this.doc = null;
    this.awareness = null;
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

/** awareness update에 담긴 client id 목록만 읽는다(상태 내용은 해석하지 않는다). */
export function readAwarenessClientIds(update: Uint8Array): number[] {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const ids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(decoding.readVarUint(decoder));
    decoding.readVarUint(decoder);
    decoding.readVarString(decoder);
  }
  return ids;
}

/** WebSocket close 코드는 1005·1006 같은 예약 코드를 다시 보낼 수 없다. */
export function normalizeCloseCode(code: number): number {
  if (code === 1000 || (code >= 3000 && code <= 4999)) return code;
  if (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) return code;
  return 1000;
}
