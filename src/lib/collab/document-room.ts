import {
  COLLAB_INTERNAL_HEADER_KEY,
  COLLAB_INTERNAL_HEADER_MODE,
  COLLAB_INTERNAL_HEADER_USER,
  COLLAB_SUBPROTOCOL,
} from "./protocol";
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
 * `/reset`은 같은 Worker의 server action이 binding으로만 부른다(외부 요청은 항상 `/connect`로 바뀐다).
 */

/** Cloudflare 런타임 타입을 앱 tsconfig에 끌어오지 않도록 쓰는 부분만 좁게 선언한다. */
type SqlCursor = { toArray(): Record<string, unknown>[] };
type DurableObjectStateLike = {
  storage: {
    sql: { exec(query: string, ...bindings: unknown[]): SqlCursor };
    transactionSync<T>(callback: () => T): T;
  };
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): WebSocket[];
};
type HibernatableWebSocket = WebSocket & {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

const SNAPSHOT_CHUNK_BYTES = 1024 * 1024;

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
  sql.exec(
    "CREATE TABLE IF NOT EXISTS room_snapshot (seq INTEGER PRIMARY KEY, chunk BLOB NOT NULL)",
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS room_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)",
  );
  return {
    load(): StoredRoomState {
      const epochRow = sql.exec("SELECT value FROM room_meta WHERE key = 'epoch'").toArray()[0];
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
      return { epoch: Number(epochRow?.value ?? 0), snapshot, updates };
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
        sql.exec(
          "INSERT INTO room_meta (key, value) VALUES ('epoch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          nextEpoch,
        );
      });
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

  constructor(private readonly state: DurableObjectStateLike, _env: unknown) {
    void _env;
    this.core = new RoomCore(createSqlRoomStorage(state), () =>
      state.getWebSockets().map((socket) => this.socket(socket)),
    );
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
    if (url.pathname !== "/connect" || request.headers.get("Upgrade") !== "websocket") {
      return new Response("Not found", { status: 404 });
    }
    const userId = request.headers.get(COLLAB_INTERNAL_HEADER_USER);
    const mode = request.headers.get(COLLAB_INTERNAL_HEADER_MODE);
    if (!userId || !request.headers.get(COLLAB_INTERNAL_HEADER_KEY) || (mode !== "read" && mode !== "write")) {
      return new Response("Forbidden", { status: 403 });
    }
    const [client, server] = createWebSocketPair();
    this.state.acceptWebSocket(server);
    this.core.connect(this.socket(server), { userId, mode });
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
