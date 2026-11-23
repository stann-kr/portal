import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import { COLLAB_MESSAGE_CONTROL, COLLAB_MESSAGE_SYNC } from "../protocol";
import { CollabProvider } from "./provider";

/** 메시지 순서를 테스트가 직접 정하는 가짜 소켓. */
class ScriptedSocket {
  static last: ScriptedSocket | null = null;
  readyState = 1;
  binaryType = "arraybuffer";
  bufferedAmount = 0;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    ScriptedSocket.last = this;
  }
  sent: Uint8Array[] = [];
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  deliver(bytes: Uint8Array) {
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

const control = (message: unknown) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLAB_MESSAGE_CONTROL);
  encoding.writeVarString(encoder, JSON.stringify(message));
  return encoding.toUint8Array(encoder);
};
const sync = (kind: "update" | "step2", update: Uint8Array) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
  if (kind === "update") syncProtocol.writeUpdate(encoder, update);
  else syncProtocol.writeSyncStep2(encoder, (() => { const doc = new Y.Doc(); Y.applyUpdate(doc, update); return doc; })());
  return encoding.toUint8Array(encoder);
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

async function connected(provider: CollabProvider, epoch: number): Promise<ScriptedSocket> {
  for (let i = 0; i < 60 && !ScriptedSocket.last; i += 1) await tick();
  const socket = ScriptedSocket.last;
  assert.ok(socket, "연결 시도");
  ScriptedSocket.last = null;
  socket.deliver(control({ t: "hello", epoch, mode: "write" }));
  void provider;
  return socket;
}

function makeProvider(localEpoch: number) {
  const doc = new Y.Doc();
  const events: string[] = [];
  const provider = new CollabProvider(doc, {
    request: { key: "note:n1" },
    localEpoch,
    confirmed: new Y.Doc(),
    fetchImpl: async () => Response.json({ collab: true, key: "note:n1", mode: "write", token: "t", path: "/api/collab/ws/note%3An1", expiresIn: 60, userId: "u", displayName: "u" }),
    WebSocketImpl: ScriptedSocket as unknown as typeof WebSocket,
    location: { protocol: "https:", host: "portal.test" },
  });
  provider.on("restoring", (lifecycle, kind) => events.push(`restoring:${lifecycle}:${kind}`));
  provider.on("restoreApplied", (lifecycle) => events.push(`applied:${lifecycle}`));
  return { doc, provider, events };
}

const remoteUpdate = (text: string) => {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
};

test("복원 알림만 받고 update 전에 끊기면 세대를 올리지 않아, 다시 연결할 때 복원을 다시 처리한다", async (t) => {
  const { provider, events } = makeProvider(0);
  t.after(() => provider.destroy());
  const first = await connected(provider, 0);
  first.deliver(control({ t: "restored", id: "r", lifecycle: 3, base: "" }));
  first.drop();
  assert.equal(events.length, 0, "update 전이라 아직 처리하지 않는다");
  const second = await connected(provider, 3);
  second.deliver(sync("step2", remoteUpdate("restored")));
  assert.deepEqual(events, ["restoring:3:advanced", "applied:3"], "다시 연결하면 advanced로 처리");
  assert.equal(provider.epoch, 3);
  provider.destroy();
});

test("끊긴 사이 복원(advanced)은 복원과 무관한 다른 기기 update가 아니라 room 전체 상태(step2)에서 처리한다", async (t) => {
  const { provider, events } = makeProvider(0);
  t.after(() => provider.destroy());
  const socket = await connected(provider, 2);
  socket.deliver(sync("update", remoteUpdate("other device")));
  assert.equal(events.length, 0, "일반 update는 복원 처리를 소비하지 않는다");
  assert.equal(provider.epoch, 0, "step2 전에는 세대를 올리지 않는다");
  socket.deliver(sync("step2", remoteUpdate("restored state")));
  assert.deepEqual(events, ["restoring:2:advanced", "applied:2"]);
  assert.equal(provider.epoch, 2);
  provider.destroy();
});

test("시드 전 room의 복원(빈 update)은 세대만 맞추고 다음 update를 복원으로 오인하지 않는다", async (t) => {
  const { provider, events } = makeProvider(0);
  t.after(() => provider.destroy());
  const socket = await connected(provider, 0);
  socket.deliver(control({ t: "restored", id: "r", lifecycle: 4, base: "", empty: true }));
  assert.equal(provider.roomLifecycle, 4, "시드 대조가 새 세대를 본다");
  assert.equal(provider.epoch, 4);
  socket.deliver(sync("update", remoteUpdate("seed from another device")));
  assert.deepEqual(events, [], "복원 처리 없음");
});

function makeIdleProvider() {
  const doc = new Y.Doc();
  const statuses: string[] = [];
  let tokenRequests = 0;
  const provider = new CollabProvider(doc, {
    request: { key: "note:n1" },
    localEpoch: 0,
    confirmed: new Y.Doc(),
    fetchImpl: async () => {
      tokenRequests += 1;
      return Response.json({ collab: true, key: "note:n1", mode: "write", token: "t", path: "/api/collab/ws/note%3An1", expiresIn: 60, userId: "u", displayName: "u" });
    },
    WebSocketImpl: ScriptedSocket as unknown as typeof WebSocket,
    location: { protocol: "https:", host: "portal.test" },
    idlePause: { idleMs: 150, hiddenMs: 150 },
  });
  provider.on("status", (status) => statuses.push(status));
  return { doc, provider, statuses, tokenRequests: () => tokenRequests };
}

test("활동 없이 기준 시간이 지나면 연결을 놓고(쉬는 중), 이 기기 입력이 생기면 다시 붙어 그 입력을 보낸다", async (t) => {
  const { doc, provider, statuses, tokenRequests } = makeIdleProvider();
  t.after(() => provider.destroy());
  const socket = await connected(provider, 0);
  socket.deliver(sync("step2", remoteUpdate("room")));
  assert.equal(provider.status, "connected");
  const statusNow = () => provider.status as string;
  for (let i = 0; i < 20 && statusNow() !== "paused"; i += 1) await tick();
  assert.equal(statusNow(), "paused", "활동이 없으면 쉰다");
  assert.equal(socket.readyState, 3, "소켓을 닫는다");
  const requestsWhilePaused = tokenRequests();
  await tick();
  await tick();
  assert.equal(tokenRequests(), requestsWhilePaused, "쉬는 동안 토큰 갱신·재연결을 하지 않는다");
  doc.getText("t").insert(0, "typed");
  assert.equal(provider.hasUnsentChanges(), true, "쉬는 중 입력은 미전송으로 남는다");
  const again = await connected(provider, 0);
  assert.ok(again, "입력하면 다시 연결한다");
  assert.ok(statuses.includes("paused") && statuses.at(-1) !== "paused");
});

function addPeer(provider: CollabProvider, userId: string) {
  const peer = new awarenessProtocol.Awareness(new Y.Doc());
  peer.setLocalStateField("user", { userId, name: userId, colorIndex: 0 });
  awarenessProtocol.applyAwarenessUpdate(provider.awareness, awarenessProtocol.encodeAwarenessUpdate(peer, [peer.clientID]), provider);
  peer.destroy();
}

test("다른 사람이 같은 문서를 함께 보고 있으면 입력이 없어도 쉬지 않는다", async (t) => {
  const { provider } = makeIdleProvider();
  t.after(() => provider.destroy());
  const socket = await connected(provider, 0);
  socket.deliver(sync("step2", remoteUpdate("room")));
  addPeer(provider, "student");
  for (let i = 0; i < 20; i += 1) await tick();
  assert.equal(provider.status, "connected", "함께 있는 사람이 있으면 연결을 유지한다");
});

test("같은 계정의 다른 탭만 있으면 기준대로 쉰다", async (t) => {
  const { provider } = makeIdleProvider();
  t.after(() => provider.destroy());
  const socket = await connected(provider, 0);
  socket.deliver(sync("step2", remoteUpdate("room")));
  addPeer(provider, "u");
  for (let i = 0; i < 20 && provider.status !== "paused"; i += 1) await tick();
  assert.equal(provider.status, "paused");
});

test("보내지 못한 입력이 있으면 쉬지 않는다", async (t) => {
  const { doc, provider } = makeIdleProvider();
  t.after(() => provider.destroy());
  const socket = await connected(provider, 0);
  socket.deliver(sync("step2", remoteUpdate("room")));
  socket.bufferedAmount = 10;
  doc.getText("t").insert(0, "unacked");
  for (let i = 0; i < 8; i += 1) await tick();
  assert.equal(provider.status, "connected", "ack 전 입력이 있으면 연결을 유지한다");
});

test("쉬는 중 reconnect 요청은 바로 다시 연결한다", async (t) => {
  const { provider } = makeIdleProvider();
  t.after(() => provider.destroy());
  const socket = await connected(provider, 0);
  socket.deliver(sync("step2", remoteUpdate("room")));
  for (let i = 0; i < 20 && provider.status !== "paused"; i += 1) await tick();
  assert.equal(provider.status, "paused");
  provider.reconnect();
  const again = await connected(provider, 0);
  assert.ok(again);
  assert.equal(provider.isPaused, false);
});

function makeWatchedProvider(mode: "read" | "write" = "write", tokenMode: () => "read" | "write" = () => mode) {
  // 앞 테스트가 다시 붙으며 만든 소켓을 이 provider 것으로 착각하지 않게 비운다.
  ScriptedSocket.last = null;
  const doc = new Y.Doc();
  const requests: unknown[] = [];
  const provider = new CollabProvider(doc, {
    request: { key: "note:n1" },
    localEpoch: 0,
    confirmed: new Y.Doc(),
    fetchImpl: async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ collab: true, key: "note:n1", mode: tokenMode(), token: "t", path: "/api/collab/ws/note%3An1", expiresIn: 60, userId: "u", displayName: "u" });
    },
    WebSocketImpl: ScriptedSocket as unknown as typeof WebSocket,
    location: { protocol: "https:", host: "portal.test" },
    idlePause: false,
    watchdog: { helloMs: 120, ackStallMs: 120, ackCheckMs: 40 },
  });
  return { doc, provider, requests };
}

const syncMessages = (socket: ScriptedSocket) =>
  socket.sent.filter((bytes) => bytes[0] === COLLAB_MESSAGE_SYNC && bytes[1] === syncProtocol.messageYjsUpdate);

test("이 기기 입력은 짧게 묶어 한 메시지로 보내고, ack가 오면 보낼 것이 없다", async (t) => {
  const { doc, provider } = makeWatchedProvider();
  t.after(() => provider.destroy());
  const socket = await connected(provider, 0);
  socket.deliver(sync("step2", remoteUpdate("")));
  socket.sent = [];
  doc.getText("t").insert(0, "a");
  doc.getText("t").insert(1, "b");
  doc.getText("t").insert(2, "c");
  assert.equal(syncMessages(socket).length, 0, "바로 보내지 않는다");
  assert.equal(provider.hasUnsentChanges(), true, "묶어 둔 입력도 보내지 않은 것으로 본다");
  await tick();
  assert.equal(syncMessages(socket).length, 1, "세 번 친 것을 한 메시지로");
  socket.deliver(control({ t: "ack", n: 1 }));
  assert.equal(provider.hasUnsentChanges(), false);
});

test("hello가 오지 않거나 보낸 입력의 ack가 멈추면 소켓을 버리고 다시 붙는다", async (t) => {
  const { doc, provider } = makeWatchedProvider();
  t.after(() => provider.destroy());
  for (let i = 0; i < 60 && !ScriptedSocket.last; i += 1) await tick();
  const silent = ScriptedSocket.last!;
  ScriptedSocket.last = null;
  for (let i = 0; i < 60 && !ScriptedSocket.last; i += 1) await tick();
  assert.equal(silent.readyState, 3, "hello 없는 소켓은 닫는다");
  const live = await connected(provider, 0);
  live.deliver(sync("step2", remoteUpdate("")));
  doc.getText("t").insert(0, "x");
  for (let i = 0; i < 60 && !ScriptedSocket.last; i += 1) await tick();
  assert.equal(live.readyState, 3, "ack가 오지 않는 소켓은 닫는다");
  assert.equal(provider.hasUnsentChanges(), true, "보내지 못한 입력은 다음 연결이 다시 보낸다");
});

test("화면을 닫으면 묶어 둔 마지막 입력을 보내고, 큰 입력을 올리는 동안에는 ack 감시가 소켓을 버리지 않는다", async (t) => {
  const { doc, provider } = makeWatchedProvider();
  let destroyed = false;
  t.after(() => {
    if (!destroyed) provider.destroy();
  });
  const socket = await connected(provider, 0);
  socket.deliver(sync("step2", remoteUpdate("")));
  socket.bufferedAmount = 1;
  doc.getText("t").insert(0, "큰 입력");
  await tick();
  for (let i = 0; i < 6; i += 1) await tick();
  assert.equal(socket.readyState, 1, "올리는 중에는 닫지 않는다");
  socket.bufferedAmount = 0;
  socket.deliver(control({ t: "ack", n: 1 }));
  socket.sent = [];
  doc.getText("t").insert(0, "끝");
  provider.destroy();
  destroyed = true;
  assert.equal(syncMessages(socket).length, 1, "닫기 전에 보낸다");
});

test("관리자가 편집을 다시 열어 refresh가 오면 새 토큰(쓰기)으로 다시 붙는다", async (t) => {
  let tokenMode: "read" | "write" = "read";
  const { provider, requests } = makeWatchedProvider("read", () => tokenMode);
  t.after(() => provider.destroy());
  for (let i = 0; i < 60 && !ScriptedSocket.last; i += 1) await tick();
  const first = ScriptedSocket.last!;
  ScriptedSocket.last = null;
  first.deliver(control({ t: "hello", epoch: 0, mode: "read" }));
  assert.equal(provider.mode, "read");
  tokenMode = "write";
  first.deliver(control({ t: "refresh" }));
  for (let i = 0; i < 60 && !ScriptedSocket.last; i += 1) await tick();
  assert.equal(first.readyState, 3, "읽기 연결을 닫고");
  assert.ok(ScriptedSocket.last, "새로 붙는다");
  assert.deepEqual(requests[1], { key: "note:n1", renew: true }, "갱신 요청은 room 점검을 건너뛴다");
  const second = await connected(provider, 0);
  void second;
  assert.equal(provider.mode, "write");
});
