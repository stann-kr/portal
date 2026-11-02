import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  COLLAB_CLOSE_EXPIRED,
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
} from "../protocol";
import type { CollabTokenResponse } from "../token-handler";

/**
 * 브라우저 공동 편집 연결. 연결마다 새 토큰을 받아 room에 붙고, 끊기면 다시 붙는다.
 * - `connecting`·`connected`(서버와 동기화 끝)·`offline`(재시도 대기)
 * - `solo`: 공동 편집 binding이 없는 환경(next dev). 기기 보관만 하고 이 탭이 저장한다.
 * - `denied`: 권한 없음·문서 없음. `too-large`: room 상한 초과.
 * - `trashed`: 휴지통에 있다. 같은 doc을 들고 기다리다(주기·화면 복귀·online) 되살리면 다시 붙는다.
 */
export type CollabConnectionStatus = "connecting" | "connected" | "offline" | "solo" | "denied" | "trashed" | "too-large";

export type CollabTokenRequest = { key: string } | { createNote: { operationId: string; studentId: string } };

export type CollabProviderEvents = {
  status: (status: CollabConnectionStatus) => void;
  mode: (mode: CollabMode) => void;
  /**
   * 이 기기 상태를 room에 바로 합치면 안 된다(오프라인 첫 열기 선시드·room 계보가 바뀜). provider는 room 상태를
   * live doc에 적용하지 않고 `roomState`로 넘긴다. 받은 쪽이 같은 doc에 제자리로 합친 뒤 `completeStaging()`을 부른다.
   */
  hold: (roomState: Uint8Array, epoch: number) => void;
  /**
   * 바로 다음에 복원(같은 문서에 적용하는 한 편집)이 들어온다. 지금 confirmed는 복원 기준 C와 같다(이 기기의 ack되지 않은
   * update·미전송 입력만 C 밖). `advanced`면 연결이 끊긴 사이에 복원됐다(다음 동기화가 복원을 가져온다).
   */
  restoring: (lifecycle: number, reason: "restored" | "advanced") => void;
  /** 복원이 이 doc과 confirmed에 들어왔다(이 기기 입력은 아직 confirmed 밖). */
  restoreApplied: (lifecycle: number) => void;
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
/** 휴지통 문서가 되살아났는지 다시 묻는 간격(늘어나다 이 값에서 멈춘다). */
const TRASHED_RETRY_MS = [5_000, 10_000, 30_000];

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
  /** 이번 연결에서 보낸 update 개수와 아직 ack되지 않은 것(확인분 갱신용). */
  private sentCount = 0;
  private unacked: Array<{ n: number; update: Uint8Array }> = [];
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  /** room 상태를 live doc 대신 받는 중(제자리 rebase 준비). */
  private staging: { epoch: number } | null = null;
  /** 복원 알림을 받았고 그 update(또는 끊긴 사이 복원을 가져올 동기화)를 기다린다. */
  private pendingRestore: number | null = null;
  private stagingWaiter: ((update: Uint8Array | null) => void) | null = null;
  /** room 계보가 바뀌었다(reset). 다음 hello는 제자리 rebase로 합친다. */
  private lineageChanged = false;
  private readonly syncWaiters = new Set<() => void>();
  private readonly ackWaiters = new Set<() => void>();
  private socket: WebSocket | null = null;
  private destroyed = false;
  /** 진행 중인 연결 시도 번호. 겹친 시도(online·화면 복귀)의 늦은 응답은 버린다. */
  private connectSeq = 0;
  private connecting = false;
  private attempts = 0;
  private trashedAttempts = 0;
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
    // 다시 묻는 동안 안내가 깜빡이지 않게 오프라인·휴지통 상태는 결과가 나올 때까지 유지한다.
    this.setStatus(this.status === "offline" || this.status === "trashed" ? this.status : "connecting");
    let token: CollabTokenResponse;
    try {
      const response = await this.fetchImpl(COLLAB_TOKEN_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.options.request),
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 410) {
        this.waitWhileTrashed();
        return;
      }
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

  /** hello 전(staging)에도 보낼 수 있는 room 상태 요청. */
  private sendRaw(data: Uint8Array): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return;
    try {
      socket.send(data);
    } catch {
      // close에서 다시 연결한다.
    }
  }

  /** staging 중 room 상태를 한 번 더 받는다(잠금을 얻은 뒤 다른 탭이 방금 합친 내용까지 보이게). */
  fetchStagingState(timeoutMs = 3000): Promise<Uint8Array | null> {
    if (!this.staging || !this.socket || this.socket.readyState !== 1) return Promise.resolve(null);
    this.stagingWaiter?.(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.stagingWaiter === done) this.stagingWaiter = null;
        resolve(null);
      }, timeoutMs);
      const done = (update: Uint8Array | null) => {
        clearTimeout(timer);
        resolve(update);
      };
      this.stagingWaiter = done;
      const empty = new Y.Doc();
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, empty);
      empty.destroy();
      this.sendRaw(encoding.toUint8Array(encoder));
    });
  }

  /** 지금 staging 중인지(제자리 rebase를 기다리는 중). */
  get isStaging(): boolean {
    return this.staging !== null;
  }

  /**
   * 제자리 rebase를 마쳤다(room 상태를 같은 doc에 합침). 이제 일반 동기화를 시작한다: 이 doc의 상태를 보내고
   * room 상태를 받는다(이미 합친 부분은 room이 무시한다).
   */
  completeStaging(): void {
    const staging = this.staging;
    if (!staging || this.destroyed) return;
    this.staging = null;
    this.lineageChanged = false;
    this.beginSync(staging.epoch);
    this.sendFullState();
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
    if (response.status === 410) {
      this.socket = null;
      this.handleClose(socket, COLLAB_CLOSE_GONE, true);
      try {
        socket.close(1000, "trashed");
      } catch {
        // 이미 닫혔다.
      }
      this.waitWhileTrashed();
      return;
    }
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

  private handleMessage(socket: WebSocket, data: unknown): void {
    if (socket !== this.socket || this.destroyed) return;
    if (!(data instanceof ArrayBuffer)) return;
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(decoder);
    if (type === COLLAB_MESSAGE_CONTROL) {
      this.handleControl(JSON.parse(decoding.readVarString(decoder)) as CollabControlMessage);
      return;
    }
    if (type === COLLAB_MESSAGE_SYNC && this.staging) {
      // 제자리 rebase 준비: room이 보낸 전체 상태(step2)만 받아 넘기고 live doc에는 적용하지 않는다.
      const messageType = decoding.readVarUint(decoder);
      if (messageType === syncProtocol.messageYjsSyncStep2) {
        const update = decoding.readVarUint8Array(decoder);
        const waiter = this.stagingWaiter;
        if (waiter) {
          this.stagingWaiter = null;
          waiter(update);
          return;
        }
        const { epoch } = this.staging;
        this.emit("hold", update, epoch);
      }
      return;
    }
    if (!this.helloReceived) return;
    if (type === COLLAB_MESSAGE_SYNC) {
      // room에서 온 상태는 room이 이미 가진 것이므로 바로 확인분이다. live doc에 이미 있어 이벤트가 없는 update도 넣는다.
      const confirmed = this.options.confirmed;
      if (confirmed && !confirmed.isDestroyed) {
        const peek = decoding.createDecoder(new Uint8Array(data as ArrayBuffer));
        decoding.readVarUint(peek);
        const peekType = decoding.readVarUint(peek);
        if (peekType === syncProtocol.messageYjsSyncStep2 || peekType === syncProtocol.messageYjsUpdate) {
          Y.applyUpdate(confirmed, decoding.readVarUint8Array(peek), this);
        }
      }
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
      if (this.pendingRestore !== null && (messageType === syncProtocol.messageYjsUpdate || messageType === syncProtocol.messageYjsSyncStep2)) {
        const lifecycle = this.pendingRestore;
        this.pendingRestore = null;
        this.emit("restoreApplied", lifecycle);
      }
      return;
    }
    if (type === COLLAB_MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
    }
  }

  private beginSync(epoch: number): void {
    this.helloReceived = true;
    this.everConnected = true;
    this.trashedAttempts = 0;
    this.epoch = epoch;
    this.knownEpoch = epoch;
    this.startRenew();
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
    if (this.awareness.getLocalState() !== null) {
      this.sendAwareness([this.doc.clientID]);
    }
  }

  private handleControl(message: CollabControlMessage): void {
    if (message.t === "hello") {
      this.setMode(message.mode);
      const lineageChanged = this.lineageChanged || (this.knownEpoch !== null && message.epoch < this.knownEpoch);
      if (lineageChanged || (message.mode === "write" && this.options.shouldHold?.())) {
        // 이 기기 상태를 바로 보내지 않는다. room 상태를 staging으로 받아 같은 doc에 제자리로 합친 뒤 이어서 동기화한다.
        this.staging = { epoch: message.epoch };
        const empty = new Y.Doc();
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(encoder, empty);
        empty.destroy();
        this.sendRaw(encoding.toUint8Array(encoder));
        return;
      }
      if (this.knownEpoch !== null && message.epoch > this.knownEpoch) {
        // 연결이 끊긴 사이 복원됐다. 같은 문서이므로 이어서 동기화하면 복원이 들어온다(이 기기 입력은 그 위에 다시 맞춘다).
        this.pendingRestore = message.epoch;
        this.emit("restoring", message.epoch, "advanced");
      }
      if (typeof message.seq === "number") this.emit("seq", message.seq, "hello", message.changedAt);
      this.beginSync(message.epoch);
      return;
    }
    if (message.t === "reset") {
      // room 상태가 비워졌다(가이드 초기화 등). 다음 연결에서 제자리 rebase로 합친다.
      this.lineageChanged = true;
      return;
    }
    if (message.t === "restored") {
      this.pendingRestore = message.lifecycle;
      this.emit("restoring", message.lifecycle, "restored");
      this.epoch = message.lifecycle;
      this.knownEpoch = message.lifecycle;
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
    this.staging = null;
    this.stagingWaiter?.(null);
    this.stagingWaiter = null;
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

  /** 휴지통: 연결 없이 doc을 그대로 두고, 되살아났는지 점점 드물게 다시 묻는다. */
  private waitWhileTrashed(): void {
    if (this.destroyed) return;
    this.setStatus("trashed");
    this.clearRetry();
    const delay = TRASHED_RETRY_MS[Math.min(this.trashedAttempts, TRASHED_RETRY_MS.length - 1)];
    this.trashedAttempts += 1;
    this.retryTimer = setTimeout(() => void this.connect(), delay);
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
    if (this.destroyed || (this.status !== "offline" && this.status !== "trashed") || this.connecting) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    this.attempts = 0;
    this.trashedAttempts = 0;
    void this.connect();
  };

  private readonly handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    // room에서 온 상태는 handleMessage가 confirmed에 이미 넣었다.
    if (origin === this) return;
    if (this.mode === "read") {
      // 읽기로 바뀐 뒤의 입력은 보낼 곳이 없다. 미전송으로 남겨 이탈 보호·복구본이 지키게 한다.
      if (!(origin && typeof origin === "object" && "whenSynced" in origin)) this.hasPendingLocalChanges = true;
      return;
    }
    // 기기 보관(IndexedDB)에서 읽어 온 상태는 새 입력이 아니다. 서버와는 다음 동기화(step2)에서 맞춘다.
    if (origin && typeof origin === "object" && "whenSynced" in origin) return;
    // hello 뒤에는 동기화가 끝나기 전이라도 바로 보낸다(room은 빠진 앞부분을 step2가 오면 이어 붙인다).
    if (!this.helloReceived || !this.socket || this.socket.readyState !== 1) {
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
    if (this.status === "solo") return false;
    if (this.hasPendingLocalChanges || this.unacked.length > 0) return true;
    return Boolean(this.socket && this.socket.bufferedAmount > 0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.connectSeq += 1;
    this.clearRetry();
    this.stopRenew();
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
