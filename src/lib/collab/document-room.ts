import {
  COLLAB_INTERNAL_HEADER_ISSUED,
  COLLAB_INTERNAL_HEADER_KEY,
  COLLAB_INTERNAL_HEADER_LEASE,
  COLLAB_INTERNAL_HEADER_LIFECYCLE,
  COLLAB_INTERNAL_HEADER_MODE,
  COLLAB_INTERNAL_HEADER_USER,
  COLLAB_SUBPROTOCOL,
} from "./protocol";
import { verifyCollabToken } from "./token";
import {
  normalizeCloseCode,
  RoomCore,
  type RoomSocket,
  type RoomSocketAttachment,
  type RoomStorage,
  type StoredRoomState,
} from "./room-core";

/**
 * 문서별 Durable Object. WebSocket Hibernation API로 연결을 받고 SQLite storage에 Yjs 상태를 둔다.
 * 연결은 worker(collab-worker-route.ts)가 토큰을 확인한 뒤에만 넘어온다.
 * `/reset`·`/restore-*`·`/close`·`/set-meta`·`/notify`는 같은 Worker의 server action이 binding으로만 부른다
 * (외부 요청은 worker가 항상 `/connect`로 바꾼다).
 */

/** Cloudflare 런타임 타입을 앱 tsconfig에 끌어오지 않도록 쓰는 부분만 좁게 선언한다. */
type SqlCursor = { toArray(): Record<string, unknown>[] };
type DurableObjectStateLike = {
  storage: {
    sql: { exec(query: string, ...bindings: unknown[]): SqlCursor };
    transactionSync<T>(callback: () => T): T;
    getAlarm?(): Promise<number | null>;
    setAlarm?(time: number): Promise<void>;
  };
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): WebSocket[];
};
type HibernatableWebSocket = WebSocket & {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

const SNAPSHOT_CHUNK_BYTES = 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
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

type WebSocketPairConstructor = new () => { 0: WebSocket; 1: WebSocket };

function createWebSocketPair(): [WebSocket, WebSocket] {
  const Pair = (globalThis as unknown as { WebSocketPair: WebSocketPairConstructor }).WebSocketPair;
  const pair = new Pair();
  return [pair[0], pair[1]];
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error("COLLAB_STORAGE_BAD_BLOB");
}

export function createSqlRoomStorage(state: DurableObjectStateLike): RoomStorage {
  const sql = state.storage.sql;
  sql.exec("CREATE TABLE IF NOT EXISTS room_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)");
  sql.exec("CREATE TABLE IF NOT EXISTS room_blob (key TEXT PRIMARY KEY, value BLOB NOT NULL)");
  sql.exec(
    "CREATE TABLE IF NOT EXISTS room_snapshot (seq INTEGER PRIMARY KEY, chunk BLOB NOT NULL)",
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS room_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)",
  );
  return {
    load(): StoredRoomState {
      // 세대는 'generation' key에 둔다(초기 개발판의 'epoch' 카운터와 섞이지 않게).
      const epochRow = sql.exec("SELECT value FROM room_meta WHERE key = 'generation'").toArray()[0];
      const seqRow = sql.exec("SELECT value FROM room_meta WHERE key = 'seq'").toArray()[0];
      const changedRow = sql.exec("SELECT value FROM room_meta WHERE key = 'changedAt'").toArray()[0];
      const savedRow = sql.exec("SELECT value FROM room_blob WHERE key = 'savedSv'").toArray()[0];
      const intentBaseRow = sql.exec("SELECT value FROM room_blob WHERE key = 'restoreBase'").toArray()[0];
      const intentMetaRow = sql.exec("SELECT value FROM room_blob WHERE key = 'restoreMeta'").toArray()[0];
      let restoreIntent: StoredRoomState["restoreIntent"] = null;
      if (intentBaseRow && intentMetaRow) {
        try {
          const meta = JSON.parse(new TextDecoder().decode(toBytes(intentMetaRow.value))) as { id?: unknown; at?: unknown };
          if (typeof meta.id === "string" && typeof meta.at === "number") {
            restoreIntent = { id: meta.id, at: meta.at, base: toBytes(intentBaseRow.value) };
          }
        } catch {
          restoreIntent = null;
        }
      }
      const chunks = sql
        .exec("SELECT chunk FROM room_snapshot ORDER BY seq")
        .toArray()
        .map((row) => toBytes(row.chunk));
      let snapshot: Uint8Array | null = null;
      if (chunks.length > 0) {
        const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        snapshot = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          snapshot.set(chunk, offset);
          offset += chunk.byteLength;
        }
      }
      const updates = sql
        .exec("SELECT data FROM room_updates ORDER BY id")
        .toArray()
        .map((row) => toBytes(row.data));
      return {
        epoch: Number(epochRow?.value ?? 0),
        snapshot,
        updates,
        seq: Number(seqRow?.value ?? 0),
        changedAt: Number(changedRow?.value ?? 0),
        savedSv: savedRow ? toBytes(savedRow.value) : null,
        restoreIntent,
      };
    },
    appendUpdate(update) {
      sql.exec("INSERT INTO room_updates (data) VALUES (?)", update);
    },
    replaceWithSnapshot(snapshot) {
      state.storage.transactionSync(() => {
        sql.exec("DELETE FROM room_snapshot");
        for (let offset = 0, seq = 0; offset < snapshot.byteLength; offset += SNAPSHOT_CHUNK_BYTES, seq += 1) {
          sql.exec(
            "INSERT INTO room_snapshot (seq, chunk) VALUES (?, ?)",
            seq,
            snapshot.subarray(offset, offset + SNAPSHOT_CHUNK_BYTES),
          );
        }
        sql.exec("DELETE FROM room_updates");
      });
    },
    reset(nextEpoch) {
      state.storage.transactionSync(() => {
        sql.exec("DELETE FROM room_snapshot");
        sql.exec("DELETE FROM room_updates");
        sql.exec("DELETE FROM room_blob WHERE key IN ('savedSv', 'restoreBase', 'restoreMeta')");
        sql.exec(
          "INSERT INTO room_meta (key, value) VALUES ('generation', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          nextEpoch,
        );
      });
    },
    setEpoch(epoch) {
      sql.exec(
        "INSERT INTO room_meta (key, value) VALUES ('generation', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        epoch,
      );
    },
    setRestoreIntent(intent) {
      state.storage.transactionSync(() => {
        if (!intent) {
          sql.exec("DELETE FROM room_blob WHERE key IN ('restoreBase', 'restoreMeta')");
          return;
        }
        const meta = new TextEncoder().encode(JSON.stringify({ id: intent.id, at: intent.at }));
        for (const [key, value] of [["restoreBase", intent.base], ["restoreMeta", meta]] as const) {
          sql.exec("INSERT INTO room_blob (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
        }
      });
    },
    transact(task) {
      return state.storage.transactionSync(task);
    },
    setSeq(seq, changedAt) {
      state.storage.transactionSync(() => {
        for (const [key, value] of [["seq", seq], ["changedAt", changedAt]] as const) {
          sql.exec("INSERT INTO room_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
        }
      });
    },
    setSavedSv(sv) {
      if (!sv) {
        sql.exec("DELETE FROM room_blob WHERE key = 'savedSv'");
        return;
      }
      sql.exec(
        "INSERT INTO room_blob (key, value) VALUES ('savedSv', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        sv,
      );
    },
  };
}

function wrapSocket(socket: HibernatableWebSocket): RoomSocket {
  return {
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(normalizeCloseCode(code), reason),
    getAttachment: () => (socket.deserializeAttachment() as RoomSocketAttachment | null) ?? null,
    setAttachment: (value) => socket.serializeAttachment(value),
  };
}

export class DocumentRoom {
  private readonly core: RoomCore;
  private readonly wrapped = new WeakMap<WebSocket, RoomSocket>();

  constructor(private readonly state: DurableObjectStateLike, env: unknown) {
    const secret = (env as { AUTH_SECRET?: string } | null)?.AUTH_SECRET ?? "";
    this.core = new RoomCore(
      createSqlRoomStorage(state),
      () => state.getWebSockets().map((socket) => this.socket(socket)),
      Date.now,
      secret ? (token, key) => verifyCollabToken(token, key, secret) : null,
      (deadline) => void this.scheduleAlarm(deadline),
    );
  }

  /** 가장 이른 lease 끝에 alarm을 맞춰 조용한 소켓도 제때 닫는다(휴면 중에도 깨어난다). */
  private async scheduleAlarm(deadline: number | null): Promise<void> {
    const storage = this.state.storage;
    if (deadline === null || !storage.setAlarm || !storage.getAlarm) return;
    const current = await storage.getAlarm();
    // lease 끝 직후에 깨운다. 닫힌 소켓이 목록에 잠시 남아도 alarm이 연달아 돌지 않게 하한을 둔다.
    const target = Math.max(deadline + 50, Date.now() + 1000);
    if (current === null || current > target || current < Date.now()) await storage.setAlarm(target);
  }

  async alarm(): Promise<void> {
    this.core.sweepExpired();
  }

  private async readJson(request: Request): Promise<Record<string, unknown>> {
    try {
      const body = (await request.json()) as unknown;
      return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private socket(socket: WebSocket): RoomSocket {
    let wrapped = this.wrapped.get(socket);
    if (!wrapped) {
      wrapped = wrapSocket(socket as HibernatableWebSocket);
      this.wrapped.set(socket, wrapped);
    }
    return wrapped;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/reset" && request.method === "POST") {
      const epoch = this.core.reset();
      return Response.json({ epoch });
    }
    if (url.pathname === "/epoch" && request.method === "GET") {
      return Response.json({ epoch: this.core.currentEpoch });
    }
    if (request.method === "POST" && url.pathname !== "/connect") {
      const body = await this.readJson(request);
      switch (url.pathname) {
        case "/restore-begin":
        case "/restore-hold":
        case "/restore-abort":
        case "/restore-apply": {
          const id = typeof body.id === "string" && body.id.length > 0 && body.id.length <= 200 ? body.id : "";
          if (!id) return new Response("Bad id", { status: 400 });
          if (url.pathname === "/restore-abort") {
            this.core.restoreAbort(id);
            return Response.json({ ok: true });
          }
          if (url.pathname === "/restore-begin") {
            const result = this.core.restoreBegin(id);
            return Response.json(result.ok ? { ...result, state: bytesToBase64(result.state) } : result);
          }
          if (url.pathname === "/restore-hold") {
            const result = this.core.restoreHold(id);
            return Response.json(
              result.ok ? { ...result, state: bytesToBase64(result.state), base: result.base ? bytesToBase64(result.base) : null } : result,
            );
          }
          const target = Number(body.target);
          const update = typeof body.update === "string" ? base64ToBytes(body.update) : null;
          if (!Number.isSafeInteger(target) || target < 0 || !update) return new Response("Bad restore", { status: 400 });
          const token = typeof body.token === "string" ? body.token : undefined;
          return Response.json(this.core.restoreApply(id, target, update, token));
        }
        case "/close":
          this.core.closeAll(body.keep === true);
          return Response.json({ ok: true });
        case "/set-meta": {
          if (typeof body.field !== "string" || typeof body.value !== "string") return new Response("Bad meta", { status: 400 });
          const epoch = typeof body.epoch === "number" && Number.isSafeInteger(body.epoch) ? body.epoch : undefined;
          const version = typeof body.version === "number" && Number.isSafeInteger(body.version) ? body.version : undefined;
          return Response.json({ ok: this.core.setMeta(body.field, body.value, epoch, version) });
        }
        case "/notify":
          return Response.json({ seq: this.core.notify() });
      }
    }
    if (url.pathname !== "/connect" || request.headers.get("Upgrade") !== "websocket") {
      return new Response("Not found", { status: 404 });
    }
    const userId = request.headers.get(COLLAB_INTERNAL_HEADER_USER);
    const mode = request.headers.get(COLLAB_INTERNAL_HEADER_MODE);
    const key = request.headers.get(COLLAB_INTERNAL_HEADER_KEY);
    const lease = Number(request.headers.get(COLLAB_INTERNAL_HEADER_LEASE));
    const issued = Number(request.headers.get(COLLAB_INTERNAL_HEADER_ISSUED));
    const lifecycleHeader = request.headers.get(COLLAB_INTERNAL_HEADER_LIFECYCLE);
    const lifecycle = lifecycleHeader === null ? null : Number(lifecycleHeader);
    if (
      !userId ||
      !key ||
      (mode !== "read" && mode !== "write") ||
      !Number.isFinite(lease) ||
      !Number.isFinite(issued) ||
      (lifecycle !== null && !Number.isSafeInteger(lifecycle))
    ) {
      return new Response("Forbidden", { status: 403 });
    }
    const [client, server] = createWebSocketPair();
    this.state.acceptWebSocket(server);
    this.core.connect(this.socket(server), { userId, mode, key, validUntil: lease * 1000, leaseIat: issued, lifecycle });
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": COLLAB_SUBPROTOCOL },
    } as ResponseInit);
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const bytes = typeof message === "string" ? new TextEncoder().encode(message) : new Uint8Array(message);
    this.core.message(this.socket(socket), bytes);
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    this.core.disconnect(this.socket(socket));
    try {
      socket.close(normalizeCloseCode(code), reason);
    } catch {
      // 이미 닫혔다.
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    this.core.disconnect(this.socket(socket));
  }
}
