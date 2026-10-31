import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  COLLAB_CLOSE_EXPIRED,
  COLLAB_CLOSE_RESET,
  COLLAB_CLOSE_TOO_LARGE,
  COLLAB_CLOSE_UNAUTHORIZED,
  COLLAB_MESSAGE_AWARENESS,
  COLLAB_MESSAGE_CONTROL,
  COLLAB_MESSAGE_SYNC,
  COLLAB_SUBPROTOCOL,
  COLLAB_TOKEN_PATH,
  type CollabControlMessage,
  type CollabMode,
} from "../protocol";
import type { CollabTokenResponse } from "../token-handler";

/**
 * 브라우저 공동 편집 연결. 연결마다 새 토큰을 받아 room에 붙고, 끊기면 다시 붙는다.
 * - `connecting`·`connected`(서버와 동기화 끝)·`offline`(재시도 대기)
 * - `solo`: 공동 편집 binding이 없는 환경(next dev). 기기 보관만 하고 이 탭이 저장한다.
 * - `denied`: 권한 없음·문서 없음. `too-large`: room 상한 초과.
 */
export type CollabConnectionStatus = "connecting" | "connected" | "offline" | "solo" | "denied" | "too-large";

export type CollabTokenRequest = { key: string } | { createNote: { operationId: string; studentId: string } };

export type CollabProviderEvents = {
  status: (status: CollabConnectionStatus) => void;
  /** room이 비워졌다(복원·휴지통). 새 epoch로 다시 시작해야 한다. */
  reset: (epoch: number) => void;
  /** 이 기기 보관본과 room의 epoch가 다르다. */
  epoch: (epoch: number) => void;
  mode: (mode: CollabMode) => void;
};

export type CollabProviderOptions = {
  request: CollabTokenRequest;
  /** 이 기기에 보관된 상태의 epoch. room epoch와 다르면 `epoch` 이벤트로 알리고 동기화하지 않는다. */
  localEpoch: number | null;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  location?: { protocol: string; host: string };
};

const MAX_BACKOFF_MS = 15_000;

type Listener<K extends keyof CollabProviderEvents> = CollabProviderEvents[K];

export class CollabProvider {
  readonly awareness: awarenessProtocol.Awareness;
  status: CollabConnectionStatus = "connecting";
  mode: CollabMode | null = null;
  /** 토큰 응답의 본인 정보(커서 이름·색). */
  identity: { userId: string; displayName: string } | null = null;
  /** 서버 상태를 한 번 이상 받아 합쳤는지(이번 연결 기준). */
  synced = false;
  /** 서버에 아직 보내지 못한 이 기기 입력이 있는지. 이탈 보호에 쓴다. */
  hasPendingLocalChanges = false;
  private socket: WebSocket | null = null;
  private destroyed = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private helloReceived = false;
  private readonly listeners = new Map<keyof CollabProviderEvents, Set<(...args: never[]) => void>>();
  private readonly fetchImpl: typeof fetch;
  private readonly WebSocketImpl: typeof WebSocket | undefined;

  constructor(
    readonly doc: Y.Doc,
    private readonly options: CollabProviderOptions,
  ) {
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.WebSocketImpl = options.WebSocketImpl ?? (typeof WebSocket === "undefined" ? undefined : WebSocket);
    doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleWake);
      document.addEventListener("visibilitychange", this.handleWake);
    }
    void this.connect();
  }

  on<K extends keyof CollabProviderEvents>(event: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (...args: never[]) => void);
    this.listeners.set(event, set);
    return () => set.delete(listener as (...args: never[]) => void);
  }

  private emit<K extends keyof CollabProviderEvents>(event: K, ...args: Parameters<CollabProviderEvents[K]>): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as unknown as (...values: Parameters<CollabProviderEvents[K]>) => void)(...args);
    }
  }

  private setStatus(status: CollabConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", status);
  }

  private setMode(mode: CollabMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.emit("mode", mode);
  }

  private async connect(): Promise<void> {
    if (this.destroyed) return;
    this.clearRetry();
    this.setStatus(this.status === "offline" ? "offline" : "connecting");
    let token: CollabTokenResponse;
    try {
      const response = await this.fetchImpl(COLLAB_TOKEN_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.options.request),
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 403 || response.status === 400) {
        this.setStatus("denied");
        return;
      }
      if (!response.ok) throw new Error(`token ${response.status}`);
      token = (await response.json()) as CollabTokenResponse;
    } catch {
      this.scheduleRetry();
      return;
    }
    if (this.destroyed) return;
    this.identity = { userId: token.userId, displayName: token.displayName };
    this.setMode(token.mode);
    if (!token.collab) {
      this.synced = false;
      this.setStatus("solo");
      return;
    }
    const WebSocketImpl = this.WebSocketImpl;
    if (!WebSocketImpl) {
      this.setStatus("solo");
      return;
    }
    const location = this.options.location ?? window.location;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${token.path}`;
    let socket: WebSocket;
    try {
      socket = new WebSocketImpl(url, [COLLAB_SUBPROTOCOL, token.token]);
    } catch {
      this.scheduleRetry();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    this.helloReceived = false;
    this.synced = false;
    socket.onmessage = (event) => this.handleMessage(socket, event.data);
    socket.onclose = (event) => this.handleClose(socket, event.code);
    socket.onerror = () => {
      // close 이벤트가 이어서 온다.
    };
  }

  private send(data: Uint8Array): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || !this.helloReceived) return;
    try {
      socket.send(data);
    } catch {
      // close에서 다시 연결한다.
    }
  }

  private handleMessage(socket: WebSocket, data: unknown): void {
    if (socket !== this.socket || this.destroyed) return;
    if (!(data instanceof ArrayBuffer)) return;
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(decoder);
    if (type === COLLAB_MESSAGE_CONTROL) {
      this.handleControl(JSON.parse(decoding.readVarString(decoder)) as CollabControlMessage);
      return;
    }
    if (!this.helloReceived) return;
    if (type === COLLAB_MESSAGE_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
      const messageType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
      // 읽기 전용은 서버 상태 요청(step1)에 이 기기 상태를 돌려주지 않는다.
      if (encoding.length(encoder) > 1 && this.mode === "write") this.send(encoding.toUint8Array(encoder));
      if (messageType === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true;
        this.attempts = 0;
        if (this.mode === "write") this.hasPendingLocalChanges = false;
        this.setStatus("connected");
      }
      return;
    }
    if (type === COLLAB_MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
    }
  }

  private handleControl(message: CollabControlMessage): void {
    if (message.t === "hello") {
      this.setMode(message.mode);
      if (this.options.localEpoch !== null && this.options.localEpoch !== message.epoch) {
        this.emit("epoch", message.epoch);
        return;
      }
      this.helloReceived = true;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.send(encoding.toUint8Array(encoder));
      if (this.awareness.getLocalState() !== null) {
        this.sendAwareness([this.doc.clientID]);
      }
      return;
    }
    if (message.t === "reset") {
      this.emit("reset", message.epoch);
      return;
    }
    if (message.t === "error" && message.code === "too-large") {
      this.setStatus("too-large");
    }
  }

  private handleClose(socket: WebSocket, code: number): void {
    if (socket !== this.socket) return;
    this.socket = null;
    this.helloReceived = false;
    this.synced = false;
    const others = Array.from(this.awareness.getStates().keys()).filter((id) => id !== this.doc.clientID);
    if (others.length > 0) awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
    if (this.destroyed || code === COLLAB_CLOSE_RESET) return;
    if (code === COLLAB_CLOSE_TOO_LARGE) {
      this.setStatus("too-large");
      return;
    }
    if (code === COLLAB_CLOSE_UNAUTHORIZED) {
      this.setStatus("denied");
      return;
    }
    if (code === COLLAB_CLOSE_EXPIRED) {
      void this.connect();
      return;
    }
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.destroyed) return;
    this.setStatus("offline");
    this.clearRetry();
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempts);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private readonly handleWake = () => {
    if (this.destroyed || this.status !== "offline") return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    this.attempts = 0;
    void this.connect();
  };

  private readonly handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.mode === "read") return;
    if (!this.synced || !this.socket || this.socket.readyState !== 1) {
      this.hasPendingLocalChanges = true;
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  };

  private readonly handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return;
    this.sendAwareness(added.concat(updated, removed));
  };

  private sendAwareness(clientIds: number[]): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLAB_MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds));
    this.send(encoding.toUint8Array(encoder));
  }

  /** 서버에 보내지 못한 입력이 남았는지(연결 중이면 전송 대기 바이트까지 본다). */
  hasUnsentChanges(): boolean {
    if (this.status === "solo" || this.mode === "read") return false;
    if (this.hasPendingLocalChanges) return true;
    return Boolean(this.socket && this.socket.bufferedAmount > 0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearRetry();
    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleWake);
      document.removeEventListener("visibilitychange", this.handleWake);
    }
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], "destroy");
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close(1000, "destroy");
      } catch {
        // 이미 닫혔다.
      }
    }
    this.awareness.destroy();
  }
}
