import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  COLLAB_CLOSE_BUSY,
  COLLAB_CLOSE_EXPIRED,
  COLLAB_CLOSE_FREEZE_TIMEOUT,
  COLLAB_CLOSE_GONE,
  COLLAB_CLOSE_RESET,
  COLLAB_CLOSE_STALE,
  COLLAB_CLOSE_TOO_LARGE,
  COLLAB_CLOSE_UNAUTHORIZED,
  COLLAB_RENEW_INTERVAL_MS,
  COLLAB_MESSAGE_AWARENESS,
  COLLAB_MESSAGE_CONTROL,
  COLLAB_MESSAGE_SYNC,
  COLLAB_SUBPROTOCOL,
  COLLAB_TOKEN_PATH,
  type CollabClientControlMessage,
  type CollabControlMessage,
  type CollabMode,
  type CollabPrepareMode,
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
  /** 이 기기 doc과 room의 epoch가 다르다(보관본의 세대 또는 이번 provider가 처음 맞춘 세대). */
  epoch: (epoch: number) => void;
  mode: (mode: CollabMode) => void;
  /** 이 기기 상태를 room에 바로 합치면 안 된다(오프라인 첫 열기 선시드). 서버 상태 위에 다시 적용해야 한다. */
  hold: (epoch: number) => void;
  /** 복원 준비로 편집을 잠시 멈춘다. */
  freeze: (id: string) => void;
  thaw: () => void;
  /** 저장 담당에게 checkpoint 요청. 처리한 뒤 `sendFlushed`로 답한다. */
  flush: (id: string, mode: CollabPrepareMode) => void;
  /** 알림 room 순번(hello·changed). hello에는 마지막 알림 시각(ms)도 온다. */
  seq: (seq: number, reason: "hello" | "changed", changedAt?: number) => void;
};

export type CollabProviderOptions = {
  request: CollabTokenRequest;
  /** 이 기기에 보관된 상태의 epoch. room epoch와 다르면 `epoch` 이벤트로 알리고 동기화하지 않는다. */
  localEpoch: number | null;
  /** room이 확인한 상태만 담는 그림자 doc. room에서 온 update와 ack된 이 기기 update만 들어간다. */
  confirmed?: Y.Doc | null;
  /** hello 때 이 기기 상태를 보내지 말아야 하는지(true면 `hold`를 알리고 동기화하지 않는다). */
  shouldHold?: () => boolean;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  location?: { protocol: string; host: string };
};

const MAX_BACKOFF_MS = 15_000;
/** room이 freeze를 풀지 못하고 사라져도(휴면·장애) 편집이 멈춘 채로 남지 않게 스스로 푼다. */
const CLIENT_FREEZE_RELEASE_MS = 65_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

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
  /** 이번 provider가 한 번이라도 room의 hello를 받았는지(연결된 적이 있는지). */
  everConnected = false;
  /** 이번 provider가 한 번이라도 서버와 동기화(step2 수신)를 마쳤는지. */
  everSynced = false;
  /** hello로 받은 room epoch. */
  epoch: number | null = null;
  /** room이 복원을 준비 중이라 편집을 멈췄다. */
  frozen = false;
  /** 이번 연결에서 보낸 update 개수와 아직 ack되지 않은 것(확인분 갱신용). */
  private sentCount = 0;
  private unacked: Array<{ n: number; update: Uint8Array }> = [];
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  /** 저장 담당이 checkpoint 중이다(freeze 중에도 저장 표시 update를 보낸다). */
  private flushing = false;
  private readonly syncWaiters = new Set<() => void>();
  private readonly ackWaiters = new Set<() => void>();
  private freezeTimer: ReturnType<typeof setTimeout> | null = null;
  private socket: WebSocket | null = null;
  private destroyed = false;
  /** 진행 중인 연결 시도 번호. 겹친 시도(online·화면 복귀)의 늦은 응답은 버린다. */
  private connectSeq = 0;
  private connecting = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private helloReceived = false;
  private readonly listeners = new Map<keyof CollabProviderEvents, Set<(...args: never[]) => void>>();
  private readonly fetchImpl: typeof fetch;
  private readonly WebSocketImpl: typeof WebSocket | undefined;
  /** 이 doc이 속한 세대. 보관본이 없으면 첫 hello에서 정하고, 다시 연결했을 때 다르면 다시 시작하게 한다. */
  private knownEpoch: number | null;

  constructor(
    readonly doc: Y.Doc,
    private readonly options: CollabProviderOptions,
  ) {
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.knownEpoch = options.localEpoch;
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
    if (this.destroyed || this.connecting) return;
    if (this.socket && this.socket.readyState <= 1) return;
    this.clearRetry();
    this.connecting = true;
    const seq = ++this.connectSeq;
    try {
      await this.openConnection(seq);
    } finally {
      if (seq === this.connectSeq) this.connecting = false;
    }
  }

  private async openConnection(seq: number): Promise<void> {
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
      // 로그인 화면으로 돌려보내진 응답(세션 없음)도 권한 없음이다. 오프라인으로 보고 계속 기다리면 안 된다.
      if (response.status === 401 || response.status === 403 || response.status === 400 || response.redirected) {
        this.setStatus("denied");
        return;
      }
      if (!response.ok) throw new Error(`token ${response.status}`);
      token = (await response.json()) as CollabTokenResponse;
    } catch {
      this.scheduleRetry();
      return;
    }
    if (this.destroyed || seq !== this.connectSeq) return;
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
    this.sentCount = 0;
    this.unacked = [];
    socket.onmessage = (event) => this.handleMessage(socket, event.data);
    socket.onclose = (event) => this.handleClose(socket, event.code);
    socket.onerror = () => {
      // close 이벤트가 이어서 온다.
    };
  }

  private send(data: Uint8Array): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || !this.helloReceived) return false;
    try {
      socket.send(data);
      return true;
    } catch {
      // close에서 다시 연결한다.
      return false;
    }
  }

  /** 이 기기 update를 보낸다. ack가 오면 확인분(confirmed)에 넣는다. */
  private sendOwnUpdate(message: Uint8Array, update: Uint8Array): void {
    if (!this.send(message)) {
      this.hasPendingLocalChanges = true;
      return;
    }
    this.sentCount += 1;
    if (this.options.confirmed) this.unacked.push({ n: this.sentCount, update });
  }

  private sendControl(message: CollabClientControlMessage): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLAB_MESSAGE_CONTROL);
    encoding.writeVarString(encoder, JSON.stringify(message));
    this.send(encoding.toUint8Array(encoder));
  }

  /** 저장 성공(또는 이미 저장된 내용과 같음)을 room에 알린다. room은 이것으로 "밀린 내용 없음"을 안다. */
  reportSaved(stateVector: Uint8Array): void {
    if (this.mode !== "write") return;
    this.sendControl({ t: "saved", sv: bytesToBase64(stateVector) });
  }

  private sendFullState(): void {
    const update = Y.encodeStateAsUpdate(this.doc);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.hasPendingLocalChanges = false;
    this.sendOwnUpdate(encoding.toUint8Array(encoder), update);
  }

  /** room 상태를 한 번 더 받아 합친다(다른 탭·기기가 방금 보낸 변경까지 보이게). 연결이 없으면 바로 끝난다. */
  resync(timeoutMs = 3000): Promise<boolean> {
    if (!this.helloReceived || !this.socket || this.socket.readyState !== 1) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = (value: boolean) => {
        clearTimeout(timer);
        this.syncWaiters.delete(onSync);
        resolve(value);
      };
      const onSync = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      this.syncWaiters.add(onSync);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.send(encoding.toUint8Array(encoder));
    });
  }

  /** 보낸 update가 모두 room에 저장(ack)될 때까지 기다린다. */
  awaitAcked(timeoutMs = 5000): Promise<boolean> {
    if (!this.hasUnsentChanges()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const check = () => {
        if (this.hasUnsentChanges()) return;
        done(true);
      };
      const done = (value: boolean) => {
        clearTimeout(timer);
        this.ackWaiters.delete(check);
        resolve(value);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      this.ackWaiters.add(check);
    });
  }

  sendFlushed(message: { id: string; ok: boolean; revision?: number; stateVector?: Uint8Array; dirty?: boolean }): void {
    this.flushing = false;
    this.sendControl({
      t: "flushed",
      id: message.id,
      ok: message.ok,
      ...(typeof message.revision === "number" ? { revision: message.revision } : {}),
      ...(message.stateVector ? { sv: bytesToBase64(message.stateVector) } : {}),
      ...(typeof message.dirty === "boolean" ? { dirty: message.dirty } : {}),
    });
  }

  /** 저장이 room 세대 불일치(COLLAB_STALE)로 거부됐을 때 등: 새 토큰으로 다시 연결해 room을 D1 세대에 맞춘다. */
  reconnect(): void {
    if (this.destroyed) return;
    const socket = this.socket;
    if (socket) {
      this.socket = null;
      this.handleClose(socket, 1000, true);
      try {
        socket.close(1000, "reconnect");
      } catch {
        // 이미 닫혔다.
      }
    }
    this.attempts = 0;
    void this.connect();
  }

  private startRenew(): void {
    this.stopRenew();
    this.renewTimer = setInterval(() => void this.renew(), COLLAB_RENEW_INTERVAL_MS);
  }

  private stopRenew(): void {
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.renewTimer = null;
  }

  /** 새 토큰(세션·권한 재확인)으로 lease를 넘겨받는다. 권한이 사라졌으면 연결을 닫는다. */
  private async renew(): Promise<void> {
    const socket = this.socket;
    if (!socket || this.destroyed || !this.helloReceived) return;
    let response: Response;
    try {
      response = await this.fetchImpl(COLLAB_TOKEN_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.options.request),
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      return; // 다음 주기에 다시 시도한다. lease가 끝나면 room이 닫는다.
    }
    if (socket !== this.socket || this.destroyed) return;
    if (response.status === 401 || response.status === 403 || response.status === 400 || response.redirected) {
      this.socket = null;
      this.handleClose(socket, COLLAB_CLOSE_UNAUTHORIZED, true);
      try {
        socket.close(1000, "denied");
      } catch {
        // 이미 닫혔다.
      }
      this.setStatus("denied");
      return;
    }
    if (!response.ok) return;
    const token = (await response.json().catch(() => null)) as CollabTokenResponse | null;
    if (!token || !token.collab || socket !== this.socket) return;
    if (token.mode === "read") this.setMode("read");
    this.sendControl({ t: "renew", token: token.token });
  }

  private setFrozen(frozen: boolean): void {
    if (this.freezeTimer) clearTimeout(this.freezeTimer);
    this.freezeTimer = null;
    if (this.frozen === frozen) return;
    this.frozen = frozen;
    if (!frozen) this.flushing = false;
    if (frozen) {
      this.freezeTimer = setTimeout(() => this.setFrozen(false), CLIENT_FREEZE_RELEASE_MS);
      return;
    }
    this.emit("thaw");
    // 멈춘 동안의 입력(편집 잠금 전 몇 글자 등)을 보낸다. room은 이미 가진 부분을 무시한다.
    if (this.hasPendingLocalChanges && this.helloReceived && this.mode === "write") this.sendFullState();
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
      if (encoding.length(encoder) > 1 && this.mode === "write") {
        // 이 기기 상태(step2)를 보냈으므로 연결 전에 쌓인 입력도 함께 갔다. ack가 오면 지금 상태 전체가 확인분이 된다.
        this.sendOwnUpdate(encoding.toUint8Array(encoder), Y.encodeStateAsUpdate(this.doc));
        this.hasPendingLocalChanges = false;
      }
      if (messageType === syncProtocol.messageYjsSyncStep2) for (const waiter of [...this.syncWaiters]) waiter();
      if (messageType === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true;
        this.everSynced = true;
        this.attempts = 0;
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
      if (this.knownEpoch !== null && this.knownEpoch !== message.epoch) {
        this.emit("epoch", message.epoch);
        return;
      }
      if (message.mode === "write" && this.options.shouldHold?.()) {
        this.emit("hold", message.epoch);
        return;
      }
      this.helloReceived = true;
      this.everConnected = true;
      this.epoch = message.epoch;
      this.knownEpoch = message.epoch;
      if (typeof message.seq === "number") this.emit("seq", message.seq, "hello", message.changedAt);
      this.startRenew();
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
      return;
    }
    if (message.t === "ack") {
      const confirmed = this.options.confirmed;
      while (this.unacked.length > 0 && this.unacked[0].n <= message.n) {
        const entry = this.unacked.shift()!;
        if (confirmed && !confirmed.isDestroyed) Y.applyUpdate(confirmed, entry.update, this);
      }
      for (const waiter of [...this.ackWaiters]) waiter();
      return;
    }
    if (message.t === "freeze") {
      // 듣는 쪽(편집기)이 먼저 편집을 잠근 뒤 응답한다. 그 전에 보낸 입력은 room이 이미 받았다(같은 소켓 순서).
      this.setFrozen(true);
      this.emit("freeze", message.id);
      if (this.mode === "write") this.sendControl({ t: "frozen", id: message.id });
      return;
    }
    if (message.t === "thaw") {
      this.setFrozen(false);
      return;
    }
    if (message.t === "flush") {
      this.flushing = true;
      // freeze 직전에 끝난 저장의 표시(meta)가 보류돼 있으면 먼저 보낸다(room 상태가 저장 내용과 같아지게).
      if (this.hasPendingLocalChanges && this.mode === "write") this.sendFullState();
      this.emit("flush", message.id, message.mode);
      return;
    }
    if (message.t === "mode") {
      this.setMode(message.mode);
      return;
    }
    if (message.t === "changed") {
      this.emit("seq", message.seq, "changed");
    }
  }

  private handleClose(socket: WebSocket, code: number, detached = false): void {
    if (!detached && socket !== this.socket) return;
    this.socket = null;
    this.helloReceived = false;
    this.synced = false;
    this.stopRenew();
    // ack를 못 받은 update는 다음 연결의 step2가 다시 보낸다(그 ack로 확인분이 된다).
    if (this.unacked.length > 0) this.hasPendingLocalChanges = true;
    this.unacked = [];
    if (this.frozen) this.setFrozen(false);
    const others = Array.from(this.awareness.getStates().keys()).filter((id) => id !== this.doc.clientID);
    if (others.length > 0) awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
    if (this.destroyed || detached) return;
    if (code === COLLAB_CLOSE_RESET) {
      // reset 알림을 받았으면 이미 다시 시작했다(destroyed). 알림 없이 닫혔으면 다시 붙어 세대 확인(hello)으로 다시 시작한다.
      void this.connect();
      return;
    }
    if (code === COLLAB_CLOSE_STALE || code === COLLAB_CLOSE_GONE) {
      // 새 토큰으로 바로 다시 붙는다(세대가 맞춰지거나, 휴지통이면 토큰이 거부돼 denied가 된다).
      void this.connect();
      return;
    }
    if (code === COLLAB_CLOSE_BUSY || code === COLLAB_CLOSE_FREEZE_TIMEOUT) {
      this.scheduleRetry();
      return;
    }
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
    if (this.destroyed || this.status !== "offline" || this.connecting) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    this.attempts = 0;
    void this.connect();
  };

  private readonly handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) {
      // room에서 온 상태는 room이 이미 가진 것이므로 바로 확인분이다.
      const confirmed = this.options.confirmed;
      if (confirmed && !confirmed.isDestroyed) Y.applyUpdate(confirmed, update, this);
      return;
    }
    if (this.mode === "read") return;
    // 기기 보관(IndexedDB)에서 읽어 온 상태는 새 입력이 아니다. 서버와는 다음 동기화(step2)에서 맞춘다.
    if (origin && typeof origin === "object" && "whenSynced" in origin) return;
    // hello 뒤에는 동기화가 끝나기 전이라도 바로 보낸다(room은 빠진 앞부분을 step2가 오면 이어 붙인다).
    // freeze 동안에는 입력을 보내지 않는다. 저장 담당의 저장 표시(checkpoint 뒤 savedHash·headVersion)만 보낸다.
    const frozenHold = this.frozen && !(this.flushing && origin === "collab-autosave-meta");
    if (!this.helloReceived || !this.socket || this.socket.readyState !== 1 || frozenHold) {
      this.hasPendingLocalChanges = true;
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.sendOwnUpdate(encoding.toUint8Array(encoder), update);
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
    if (this.hasPendingLocalChanges || this.unacked.length > 0) return true;
    return Boolean(this.socket && this.socket.bufferedAmount > 0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.connectSeq += 1;
    this.clearRetry();
    this.stopRenew();
    if (this.freezeTimer) clearTimeout(this.freezeTimer);
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
