import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { deriveCreationResourceId } from "@/lib/creation-operation";
import { COLLAB_MESSAGE_CONTROL, COLLAB_MESSAGE_SYNC } from "@/lib/collab/protocol";
import { RoomCore, type RoomSocket, type RoomSocketAttachment, type RoomStorage } from "@/lib/collab/room-core";

/**
 * 실시간 공동 편집 통합 테스트. 서버 room(RoomCore)을 같은 프로세스에 두고 가짜 WebSocket으로 이어,
 * 실제 provider·useCollabDocument·자동 저장 선출이 여러 "기기" 사이에서 수렴하는지 본다.
 * 편집기(Tiptap)는 happy-dom에서 돌리지 않고 Y.Doc 본문을 textarea로 보여 주는 stub으로 바꾼다.
 */

type EditorStubProps = { collaboration?: { doc: Y.Doc }; ariaLabel?: string; disabled?: boolean };

/** 화면에 마운트된 편집기 stub의 Y.Doc 목록(기기별로 본문을 직접 바꿀 때 쓴다). */
const mountedDocs: Y.Doc[] = [];
let editorMounts = 0;

function fragmentText(doc: Y.Doc): string {
  return doc
    .getXmlFragment("default")
    .toArray()
    .map((node) => (node instanceof Y.XmlElement ? node.toArray().map((child) => (child instanceof Y.XmlText ? child.toString() : "")).join("") : ""))
    .join("\n");
}

function setFragmentText(doc: Y.Doc, text: string): void {
  doc.transact(() => {
    const fragment = doc.getXmlFragment("default");
    if (fragment.length > 0) fragment.delete(0, fragment.length);
    const paragraph = new Y.XmlElement("paragraph");
    const run = new Y.XmlText();
    paragraph.insert(0, [run]);
    fragment.insert(0, [paragraph]);
    if (text) run.insert(0, text);
  });
}

function EditorStub({ collaboration, ariaLabel = "문서 내용", disabled = false }: EditorStubProps) {
  const doc = collaboration?.doc;
  const [value, setValue] = React.useState(() => (doc ? fragmentText(doc) : ""));
  React.useEffect(() => {
    editorMounts += 1;
    return undefined;
  }, []);
  React.useEffect(() => {
    if (!doc) return undefined;
    mountedDocs.push(doc);
    const sync = () => setValue(fragmentText(doc));
    doc.on("update", sync);
    sync();
    return () => {
      doc.off("update", sync);
      const index = mountedDocs.indexOf(doc);
      if (index >= 0) mountedDocs.splice(index, 1);
    };
  }, [doc]);
  return (
    <textarea
      aria-label={ariaLabel}
      data-editor-stub=""
      value={value}
      disabled={disabled}
      onChange={(event) => doc && setFragmentText(doc, event.currentTarget.value)}
    />
  );
}

const MockLink = React.forwardRef<HTMLAnchorElement, { href: string | { pathname?: string } } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">>(
  ({ href, ...props }, ref) => <a ref={ref} href={typeof href === "string" ? href : (href.pathname ?? "#")} {...props} />,
);
MockLink.displayName = "MockLink";

mock.module("@radix-ui/react-use-layout-effect", { namedExports: { useLayoutEffect: React.useLayoutEffect } });
mock.module("next/dynamic", { defaultExport: () => EditorStub });
mock.module("next/link", { defaultExport: MockLink });
let refreshCount = 0;
const testRouter = { push: () => undefined, refresh: () => { refreshCount += 1; }, replace: () => undefined };
mock.module("next/navigation", {
  namedExports: { useRouter: () => testRouter },
});
/** 연결된 기기가 시드할 때 읽는 서버 head(lifecycle 포함). 테스트가 노트별로 채운다. */
const seedHeads = new Map<string, { title: string; contentHtml: string; noteDate: Date | null; version: number; lifecycle?: number }>();
/** 0보다 크면 그 횟수만큼 head 조회가 실패한다(복원 뒤 조회 실패 재현). */
let seedFailuresLeft = 0;
mock.module("@/lib/actions/privateNotes", {
  namedExports: {
    getPrivateNote: async () => null,
    getPrivateNoteHead: async () => null,
    getPrivateNoteCollabSeed: async (id: string) => {
      if (seedFailuresLeft > 0) {
        seedFailuresLeft -= 1;
        throw new Error("network");
      }
      const head = seedHeads.get(id);
      return head ? { status: "ok", lifecycle: 0, ...head } : { status: "missing" };
    },
  },
});

let NoteEditorForm: typeof import("@/components/notes/NoteEditorForm").NoteEditorForm;
let LiveNoteArticle: typeof import("@/components/notes/LiveNoteArticle").LiveNoteArticle;
let CollabNotifyRefresh: typeof import("@/components/app-shell/CollabNotifyRefresh").CollabNotifyRefresh;
let buildCollabSeedUpdate: typeof import("@/lib/collab/client/seed").buildCollabSeedUpdate;
let collabSeedClientId: typeof import("@/lib/collab/client/seed").collabSeedClientId;
let collabDocHtml: typeof import("@/lib/collab/client/doc-html").collabDocHtml;
let createFullEditorExtensions: typeof import("@/components/editor/FullEditor").createFullEditorExtensions;
let buildCollabRestoreUpdate: typeof import("@/lib/collab/server-restore").buildCollabRestoreUpdate;

before(async () => {
  ({ NoteEditorForm } = await import("@/components/notes/NoteEditorForm"));
  ({ LiveNoteArticle } = await import("@/components/notes/LiveNoteArticle"));
  ({ CollabNotifyRefresh } = await import("@/components/app-shell/CollabNotifyRefresh"));
  ({ buildCollabSeedUpdate, collabSeedClientId } = await import("@/lib/collab/client/seed"));
  ({ collabDocHtml } = await import("@/lib/collab/client/doc-html"));
  ({ createFullEditorExtensions } = await import("@/components/editor/FullEditor"));
  ({ buildCollabRestoreUpdate } = await import("@/lib/collab/server-restore"));
});

after(() => {
  mock.restoreAll();
});

// ---------------------------------------------------------------------------
// 서버 room + 가짜 WebSocket
// ---------------------------------------------------------------------------

class MemoryStorage implements RoomStorage {
  epoch = 0;
  snapshot: Uint8Array | null = null;
  updates: Uint8Array[] = [];
  load() {
    return { epoch: this.epoch, snapshot: this.snapshot, updates: [...this.updates] };
  }
  appendUpdate(update: Uint8Array) {
    this.updates.push(update);
  }
  replaceWithSnapshot(snapshot: Uint8Array) {
    this.snapshot = snapshot;
    this.updates = [];
  }
  reset(nextEpoch: number) {
    this.epoch = nextEpoch;
    this.snapshot = null;
    this.updates = [];
  }
  setEpoch(epoch: number) {
    this.epoch = epoch;
  }
  setRestoreIntent() {
    // 메모리 room은 기록을 RoomCore 안에만 둔다.
  }
  /** 저장된 상태를 Y.Doc으로 복원한다(서버가 받은 내용 확인용). */
  toDoc(): Y.Doc {
    const doc = new Y.Doc();
    if (this.snapshot) Y.applyUpdate(doc, this.snapshot);
    for (const update of this.updates) Y.applyUpdate(doc, update);
    return doc;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

type Room = { core: RoomCore; storage: MemoryStorage; sockets: Set<ServerSocket> };
const rooms = new Map<string, Room>();
const openSockets = new Set<FakeWebSocket>();

function roomFor(key: string): Room {
  let room = rooms.get(key);
  if (!room) {
    const storage = new MemoryStorage();
    const sockets = new Set<ServerSocket>();
    room = { core: new RoomCore(storage, () => [...sockets]), storage, sockets };
    rooms.set(key, room);
  }
  return room;
}

class ServerSocket implements RoomSocket {
  attachment: RoomSocketAttachment | null = null;
  controls: { t: string; code?: string }[] = [];
  constructor(private readonly client: FakeWebSocket) {}
  send(data: Uint8Array | string) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const decoder = decoding.createDecoder(bytes);
    if (decoding.readVarUint(decoder) === COLLAB_MESSAGE_CONTROL) {
      this.controls.push(JSON.parse(decoding.readVarString(decoder)) as { t: string; code?: string });
    }
    this.client.deliver(bytes);
  }
  close(code: number, reason: string) {
    this.client.closeFromServer(code, reason);
  }
  getAttachment() {
    return this.attachment;
  }
  setAttachment(value: RoomSocketAttachment) {
    this.attachment = value;
  }
}

/** 브라우저 WebSocket의 필요한 부분만 구현한 가짜. 메시지는 항상 비동기로 ArrayBuffer로 전달한다. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  binaryType = "blob";
  bufferedAmount = 0;
  protocol: string;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  readonly server: ServerSocket;
  private room: Room | null = null;
  private readonly key: string;

  constructor(url: string, protocols: string | string[]) {
    const list = Array.isArray(protocols) ? protocols : [protocols];
    assert.equal(list[0], "portal-collab", "첫 subprotocol은 portal-collab");
    this.protocol = list[0]!;
    const token = JSON.parse(list[1]!) as { key: string; mode: "read" | "write"; userId: string };
    this.key = decodeURIComponent(new URL(url.replace(/^ws/u, "http")).pathname.replace("/api/collab/ws/", ""));
    assert.equal(this.key, token.key);
    this.server = new ServerSocket(this);
    openSockets.add(this);
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = FakeWebSocket.OPEN;
      this.room = roomFor(this.key);
      this.room.sockets.add(this.server);
      this.room.core.connect(this.server, { userId: token.userId, mode: token.mode });
      this.onopen?.();
    }, 0);
  }

  deliver(bytes: Uint8Array) {
    const copy = toArrayBuffer(bytes);
    // 실제 WebSocket처럼 서버가 닫기 전에 보낸 메시지는 close보다 먼저 도착한다.
    setTimeout(() => {
      if (this.readyState === FakeWebSocket.OPEN || this.readyState === FakeWebSocket.CLOSING) this.onmessage?.({ data: copy });
    }, 0);
  }

  send(data: ArrayBuffer | Uint8Array) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("socket is not open");
    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data.slice(0));
    setTimeout(() => {
      if (this.readyState === FakeWebSocket.OPEN) this.room?.core.message(this.server, bytes);
    }, 0);
  }

  close(code = 1000, reason = "") {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.detach();
    setTimeout(() => this.onclose?.({ code, reason }), 0);
  }

  closeFromServer(code: number, reason: string) {
    if (this.readyState >= FakeWebSocket.CLOSING) return;
    this.readyState = FakeWebSocket.CLOSING;
    this.detach();
    setTimeout(() => {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ code, reason });
    }, 0);
  }

  private detach() {
    openSockets.delete(this);
    if (this.room) {
      this.room.core.disconnect(this.server);
      this.room.sockets.delete(this.server);
    }
  }
}

/** 다음 토큰 요청에 줄 응답 정책. 테스트가 바꿔 쓴다. */
let tokenPolicy: { collab: boolean; mode: "read" | "write"; userId: string; displayName: string } = {
  collab: true,
  mode: "write",
  userId: "student-1",
  displayName: "김학생",
};
const tokenRequests: unknown[] = [];
/** true면 토큰 요청이 네트워크 오류로 끝난다(오프라인). */
let tokenOffline = false;
/** true면 토큰 요청이 401(로그아웃)으로 끝난다. */
let tokenDenied = false;
/** true면 토큰 요청이 410(휴지통)으로 끝난다. */
let tokenTrashed = false;

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!String(input).endsWith("/api/collab/token")) return Promise.reject(new Error(`unexpected fetch ${String(input)}`));
  if (tokenOffline) return Promise.reject(new TypeError("Failed to fetch"));
  if (tokenDenied) return Promise.resolve(Response.json({ error: "UNAUTHORIZED" }, { status: 401 }));
  if (tokenTrashed) return Promise.resolve(Response.json({ error: "TRASHED" }, { status: 410 }));
  const body = JSON.parse(String(init?.body ?? "{}")) as { key?: string; createNote?: { operationId: string; studentId: string } };
  tokenRequests.push(body);
  const key =
    body.key ??
    `note:${deriveCreationResourceId(body.createNote!.operationId, JSON.stringify(["private-note", tokenPolicy.userId, body.createNote!.studentId]))}`;
  const { collab, mode, userId, displayName } = tokenPolicy;
  const payload = collab
    ? { collab: true, key, mode, userId, displayName, token: JSON.stringify({ key, mode, userId }), path: `/api/collab/ws/${encodeURIComponent(key)}`, expiresIn: 60 }
    : { collab: false, key, mode, userId, displayName };
  return Promise.resolve(Response.json(payload));
}

// ---------------------------------------------------------------------------
// 브라우저 환경
// ---------------------------------------------------------------------------

const GLOBAL_BINDINGS = [
  "window", "document", "navigator", "CustomEvent", "StorageEvent", "Event", "Node", "Element", "HTMLElement",
  "HTMLFormElement", "HTMLInputElement", "HTMLTextAreaElement", "FormData", "KeyboardEvent", "MutationObserver",
  "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT", "React", "fetch", "WebSocket",
] as const;

function installBrowser(browserWindow: Window): () => void {
  const bindings: Record<(typeof GLOBAL_BINDINGS)[number], unknown> = {
    window: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    CustomEvent: browserWindow.CustomEvent,
    StorageEvent: browserWindow.StorageEvent,
    Event: browserWindow.Event,
    Node: browserWindow.Node,
    Element: browserWindow.Element,
    HTMLElement: browserWindow.HTMLElement,
    HTMLFormElement: browserWindow.HTMLFormElement,
    HTMLInputElement: browserWindow.HTMLInputElement,
    HTMLTextAreaElement: browserWindow.HTMLTextAreaElement,
    FormData: browserWindow.FormData,
    KeyboardEvent: browserWindow.KeyboardEvent,
    MutationObserver: browserWindow.MutationObserver,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
    fetch: fakeFetch,
    WebSocket: FakeWebSocket,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of GLOBAL_BINDINGS) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: bindings[name] });
  }
  return () => {
    for (const name of [...GLOBAL_BINDINGS].reverse()) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
}

type Device = { container: HTMLElement; unmount: () => Promise<void>; rerender: (element: React.ReactElement) => Promise<void> };
type Env = { browserWindow: Window; mount: (element: React.ReactElement) => Promise<Device> };

/** 브라우저 창 하나와 그 안에 "기기"(마운트된 화면)를 여러 개 붙이는 환경. 끝나면 소켓·room을 모두 정리한다. */
function setupBrowser(context: TestContext): Env {
  const browserWindow = new Window({ url: "https://portal.test/dashboard/notes/note-1" });
  const restore = installBrowser(browserWindow);
  mountedDocs.length = 0;
  editorMounts = 0;
  tokenRequests.length = 0;
  tokenOffline = false;
  tokenDenied = false;
  tokenTrashed = false;
  seedFailuresLeft = 0;
  refreshCount = 0;
  seedHeads.clear();
  tokenPolicy = { collab: true, mode: "write", userId: "student-1", displayName: "김학생" };
  const devices: Device[] = [];
  context.after(async () => {
    for (const device of devices) await device.unmount();
    for (const socket of [...openSockets]) socket.close(1000, "test-end");
    for (const room of rooms.values()) room.core.destroy();
    rooms.clear();
    await new Promise((resolve) => setTimeout(resolve, 10));
    browserWindow.close();
    restore();
  });
  return {
    browserWindow,
    async mount(element) {
      const container = browserWindow.document.createElement("div");
      browserWindow.document.body.append(container);
      const root = createRoot(container as unknown as Element);
      let mounted = true;
      const device: Device = {
        container: container as unknown as HTMLElement,
        unmount: async () => {
          if (!mounted) return;
          mounted = false;
          await act(async () => root.unmount());
        },
        rerender: (next) => act(async () => root.render(next)),
      };
      devices.push(device);
      await act(async () => root.render(element));
      return device;
    },
  };
}

async function waitUntil(condition: () => boolean, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
  assert.fail(message);
}

function typeInto(env: Env, element: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(env.browserWindow.HTMLTextAreaElement.prototype, "value")?.set;
  assert.ok(setter);
  element.focus();
  setter.call(element, value);
  element.dispatchEvent(new env.browserWindow.Event("input", { bubbles: true, cancelable: true }) as unknown as Event);
  element.dispatchEvent(new env.browserWindow.Event("change", { bubbles: true }) as unknown as Event);
  element.dispatchEvent(new env.browserWindow.KeyboardEvent("keyup", { bubbles: true }) as unknown as Event);
}

const titleOf = (device: Device) => device.container.querySelector<HTMLTextAreaElement>('textarea[name="title"]')!;
const bodyOf = (device: Device) => device.container.querySelector<HTMLTextAreaElement>("textarea[data-editor-stub]");
const formOf = (device: Device) => device.container.querySelector<HTMLFormElement>("form")!;
const FORBIDDEN_CHOOSER_TEXT = /계정 초안|더 최신 서버|서버 최신본 사용|현재 초안으로 계속|이 기기 초안/u;

function assertNoChooser(device: Device, when: string): void {
  assert.doesNotMatch(device.container.textContent ?? "", FORBIDDEN_CHOOSER_TEXT, `${when}: 선택창 문구가 보이면 안 됩니다.`);
}

async function waitReady(device: Device): Promise<void> {
  await waitUntil(
    () => formOf(device).getAttribute("aria-busy") !== "true" && Boolean(bodyOf(device)) && !titleOf(device).disabled,
    4000,
    "노트 편집기가 열려야 합니다.",
  );
}

// ---------------------------------------------------------------------------
// 1. 두 기기 수렴 + 저장 담당 한 명 + 충돌 재시도
// ---------------------------------------------------------------------------

type SaveCall = { device: "A" | "B"; data: Record<string, FormDataEntryValue> };

test("같은 노트를 연 두 기기는 제목·본문이 수렴하고 한 기기만 병합본을 저장하며, 버전 충돌은 선택창 없이 한 번 다시 저장한다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  const calls: SaveCall[] = [];
  let respond: (call: SaveCall) => import("@/lib/actions/privateNotes").UpdateNoteState = () => ({});
  const makeAction = (device: "A" | "B") => async (_previous: object, formData: FormData) => {
    const call = { device, data: Object.fromEntries(formData) };
    calls.push(call);
    return respond(call);
  };
  const note = { id: "note-1", title: "원래 제목", contentHtml: "<p>원본 본문</p>", noteDate: null, version: 1 };
  seedHeads.set(note.id, note);
  const okAt = (version: number, call: SaveCall): import("@/lib/actions/privateNotes").UpdateNoteState => ({
    success: true,
    note: { id: "note-1", title: String(call.data.title), contentHtml: String(call.data.contentHtml), noteDate: null, version },
  });

  const deviceA = await env.mount(<NoteEditorForm actorId="student-1" note={note} action={makeAction("A")} />);
  await waitReady(deviceA);
  const deviceB = await env.mount(<NoteEditorForm actorId="student-1" note={note} action={makeAction("B")} />);
  await waitReady(deviceB);
  assert.equal(titleOf(deviceA).value, "원래 제목");
  assert.equal(titleOf(deviceB).value, "원래 제목");
  assert.equal(bodyOf(deviceA)!.value, "원본 본문");
  assert.equal(bodyOf(deviceB)!.value, "원본 본문", "두 번째 기기는 시드를 다시 넣지 않아 본문이 겹쳐 쌓이지 않는다");

  // 연결·저장 담당 선출: 정확히 한 기기만 저장 담당이다.
  await waitUntil(
    () => [deviceA, deviceB].every((device) => formOf(device).dataset.collabStatus === "connected") &&
      [deviceA, deviceB].filter((device) => formOf(device).dataset.collabSaver === "true").length === 1,
    4000,
    "두 기기가 연결되고 저장 담당이 한 명으로 정해져야 합니다.",
  );
  assert.equal(calls.length, 0, "고치기 전에는 저장하지 않는다");

  // A에서 제목을 고치면 B에 나타난다.
  await act(async () => typeInto(env, titleOf(deviceA), "함께 고친 제목"));
  await waitUntil(() => titleOf(deviceB).value === "함께 고친 제목", 3000, "제목이 다른 기기에 나타나야 합니다.");

  // B가 본문을 고치면(Y.Doc 변경) A에 나타난다. 두 기기의 doc은 서로 다른 Y.Doc이다.
  assert.equal(mountedDocs.length, 2);
  const [docA, docB] = mountedDocs as [Y.Doc, Y.Doc];
  assert.notEqual(docA.clientID, docB.clientID);
  await act(async () => setFragmentText(docB, "함께 쓴 본문"));
  await waitUntil(() => bodyOf(deviceA)!.value === "함께 쓴 본문" && bodyOf(deviceB)!.value === "함께 쓴 본문", 3000, "본문이 두 기기에서 같아져야 합니다.");
  assertNoChooser(deviceA, "수렴 직후");
  assertNoChooser(deviceB, "수렴 직후");

  // 자동 저장(1.5초 쉼): 저장 담당 한 기기만 병합본을 기준 revision과 함께 한 번 저장한다.
  respond = (call) => okAt(2, call);
  await waitUntil(() => calls.length >= 1, 5000, "자동 저장이 한 번 일어나야 합니다.");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  assert.equal(calls.length, 1, "두 기기가 모두 저장하면 안 됩니다");
  assert.equal(calls[0]!.data.title, "함께 고친 제목");
  assert.equal(calls[0]!.data.contentHtml, "<p>함께 쓴 본문</p>");
  assert.equal(calls[0]!.data.baseRevision, "1");
  const saver = calls[0]!.device;
  const saverDevice = saver === "A" ? deviceA : deviceB;
  const otherDevice = saver === "A" ? deviceB : deviceA;
  await waitUntil(() => /저장됨/u.test(saverDevice.container.textContent ?? ""), 3000, "저장 담당에 저장됨이 보여야 합니다.");

  // 저장하지 않는 기기가 고쳐도 저장 담당이 이어서 저장하고, 기준 revision은 방금 저장된 version을 따라간다.
  // 이번에는 첫 시도가 버전 충돌이다: 선택창 없이 서버 최신 version(5)으로 한 번 더 저장한다.
  let attempts = 0;
  respond = (call) => {
    attempts += 1;
    if (attempts === 1) {
      return {
        error: "다른 곳에서 먼저 저장되었습니다.",
        conflictKind: "VERSION_CONFLICT",
        currentRevision: 5,
        conflictNote: { id: "note-1", title: "서버 제목", contentHtml: "<p>서버 본문</p>", noteDate: null, version: 5 },
      };
    }
    return okAt(6, call);
  };
  await act(async () => typeInto(env, titleOf(otherDevice), "충돌 뒤에도 남는 제목"));
  await waitUntil(() => calls.length >= 3, 6000, "충돌 응답 뒤 다시 저장해야 합니다.");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  assert.equal(calls.length, 3, "충돌은 한 번만 다시 시도한다");
  assert.deepEqual(calls.slice(1).map((call) => call.device), [saver, saver], "저장 담당이 바뀌지 않는다");
  assert.equal(calls[1]!.data.baseRevision, "2", "방금 저장된 version이 다음 저장의 기준이다");
  assert.equal(calls[2]!.data.baseRevision, "5", "충돌 응답의 최신 version으로 다시 저장한다");
  assert.equal(calls[2]!.data.title, "충돌 뒤에도 남는 제목", "내 입력을 서버 최신본으로 덮지 않는다");
  assert.equal(titleOf(saverDevice).value, "충돌 뒤에도 남는 제목");
  assert.equal(titleOf(otherDevice).value, "충돌 뒤에도 남는 제목");
  assertNoChooser(deviceA, "충돌 재시도 뒤");
  assertNoChooser(deviceB, "충돌 재시도 뒤");
  await waitUntil(() => /저장됨/u.test(saverDevice.container.textContent ?? ""), 3000, "재시도가 성공하면 저장됨이 보여야 합니다.");
});

// ---------------------------------------------------------------------------
// 2. 읽기 전용 연결
// ---------------------------------------------------------------------------

function messageUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

test("읽기 연결은 room 내용을 바꿀 수 없고, 읽기 화면은 작성자의 입력을 실시간으로 보여 준다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  const note = { id: "note-1", title: "수업 노트", contentHtml: "<p>처음 본문</p>", noteDate: null, version: 1 };
  seedHeads.set(note.id, note);

  // 쓰기 기기(작성자)가 room을 시드한다.
  const writer = await env.mount(<NoteEditorForm actorId="admin-1" note={note} action={async () => ({})} />);
  await waitReady(writer);
  await waitUntil(() => formOf(writer).dataset.collabStatus === "connected", 3000, "작성자 연결");
  const writerDoc = mountedDocs[0]!;
  await waitUntil(() => roomFor("note:note-1").storage.updates.length > 0, 3000, "시드가 room에 저장돼야 합니다.");

  // 읽기 토큰으로 직접 붙은 연결이 update를 보내도 room은 받아들이지 않는다.
  tokenPolicy = { ...tokenPolicy, mode: "read", userId: "student-9", displayName: "열람자" };
  const intruder = new FakeWebSocket("ws://portal.test/api/collab/ws/note%3Anote-1", ["portal-collab", JSON.stringify({ key: "note:note-1", mode: "read", userId: "student-9" })]);
  await waitUntil(() => intruder.server.controls.some((message) => message.t === "hello"), 2000, "읽기 연결에도 hello가 온다");
  const room = roomFor("note:note-1");
  const storedBefore = room.storage.updates.length;
  const forged = new Y.Doc();
  forged.getXmlFragment("default").insert(0, [new Y.XmlElement("paragraph")]);
  forged.getMap("meta").set("title", "읽기 연결이 쓴 제목");
  intruder.send(messageUpdate(Y.encodeStateAsUpdate(forged)));
  await waitUntil(() => intruder.server.controls.some((message) => message.t === "error" && message.code === "read-only"), 2000, "room이 읽기 연결의 쓰기를 거부해야 합니다.");
  assert.equal(room.storage.updates.length, storedBefore, "거부된 update는 저장되지 않는다");
  assert.notEqual(writerDoc.getMap("meta").get("title"), "읽기 연결이 쓴 제목", "다른 연결에 전달되지 않는다");
  intruder.close(1000, "done");
  forged.destroy();

  // 읽기 화면(LiveNoteArticle)은 작성자 입력을 실시간으로 보여 준다.
  const reader = await env.mount(
    <LiveNoteArticle
      note={{ ...note, createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-01T00:00:00Z") }}
      authorName="Stann"
      now={Date.parse("2026-11-01T01:00:00Z")}
      parent={{ href: "/dashboard/student", label: "노트", backLabel: "노트 목록으로" }}
      historyHref="/dashboard/notes/note-1/history"
    />,
  );
  await waitUntil(() => bodyOf(reader)?.value === "처음 본문", 4000, "읽기 화면이 room의 본문을 보여야 합니다.");
  assert.equal(bodyOf(reader)!.disabled, true, "읽기 화면의 편집기는 잠겨 있다");
  assert.match(reader.container.textContent ?? "", /읽기 전용/u);

  await act(async () => {
    writerDoc.transact(() => writerDoc.getMap("meta").set("title", "실시간으로 바뀐 제목"));
    setFragmentText(writerDoc, "작성자가 방금 쓴 글");
  });
  await waitUntil(
    () => bodyOf(reader)?.value === "작성자가 방금 쓴 글" && (reader.container.textContent ?? "").includes("실시간으로 바뀐 제목"),
    4000,
    "읽기 화면에 작성자의 제목·본문이 실시간으로 나타나야 합니다.",
  );
  assert.equal(tokenRequests.length >= 2, true);
  // 읽기 화면은 서버에 어떤 update도 보내지 않았다: room 내용은 작성자 쪽 변경만 반영한다.
  const stored = room.storage.toDoc();
  assert.equal(fragmentText(stored), "작성자가 방금 쓴 글");
  stored.destroy();
});

// ---------------------------------------------------------------------------
// 3. 혼자 모드(공동 편집 binding 없음)에서 새 노트 만들기
// ---------------------------------------------------------------------------

test("혼자 모드 새 노트는 제목·본문이 갖춰지면 생성 action을 한 번 부르고, 같은 편집기가 수정 저장으로 이어진다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  tokenPolicy = { collab: false, mode: "write", userId: "student-1", displayName: "김학생" };
  type CreateResult = import("@/lib/actions/privateNotes").CreateNoteState;
  type UpdateResult = import("@/lib/actions/privateNotes").UpdateNoteState;
  const created: Record<string, FormDataEntryValue>[] = [];
  const updated: { noteId: string; data: Record<string, FormDataEntryValue> }[] = [];
  const createAction = async (_previous: object, formData: FormData): Promise<CreateResult> => {
    const data = Object.fromEntries(formData);
    created.push(data);
    // 서버는 operationId에서 결정적으로 나온 id를 쓴다(room key와 같은 id).
    const id = deriveCreationResourceId(String(data.operationId), JSON.stringify(["private-note", "student-1", "student-1"]));
    return { success: true, note: { id, title: String(data.title), contentHtml: String(data.contentHtml), noteDate: null, createdAt: new Date(), version: 1 } };
  };
  const updateAction = async (noteId: string, _previous: object, formData: FormData): Promise<UpdateResult> => {
    const data = Object.fromEntries(formData);
    updated.push({ noteId, data });
    return { success: true, note: { id: noteId, title: String(data.title), contentHtml: String(data.contentHtml), noteDate: null, version: 2 } };
  };

  const device = await env.mount(
    <NoteEditorForm
      actorId="student-1"
      create={{ studentId: "student-1", action: createAction, updateAction, returnTo: "/dashboard/student/notes" }}
    />,
  );
  await waitReady(device);
  assert.equal(formOf(device).dataset.collabStatus, "solo");
  assert.equal(formOf(device).dataset.collabSaver, "true", "혼자 모드는 이 탭이 저장한다");
  assert.equal(openSockets.size, 0, "혼자 모드는 WebSocket을 열지 않는다");
  const titleBefore = titleOf(device);
  const bodyBefore = bodyOf(device)!;
  const mountsBefore = editorMounts;

  // 제목만 있으면 만들지 않는다.
  await act(async () => typeInto(env, titleOf(device), "새로 쓰는 노트"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1900)); });
  assert.equal(created.length, 0, "본문이 비어 있으면 만들지 않는다");

  // 본문까지 갖춰지면 쉼 뒤 한 번 만든다.
  await act(async () => typeInto(env, bodyOf(device)!, "첫 문장"));
  await waitUntil(() => created.length === 1, 5000, "제목과 본문이 있으면 생성 action을 불러야 합니다.");
  assert.equal(created[0]!.title, "새로 쓰는 노트");
  assert.equal(created[0]!.contentHtml, "<p>첫 문장</p>");
  assert.ok(created[0]!.operationId, "생성 요청 id를 보낸다");
  assert.equal("baseRevision" in created[0]!, false, "생성에는 기준 revision이 없다");

  // 생성 뒤: 주소만 문서 주소로 바뀌고 편집기·제목 칸은 그대로(remount 없음).
  await waitUntil(() => env.browserWindow.location.pathname.startsWith("/dashboard/notes/"), 3000, "주소가 문서 주소로 바뀌어야 합니다.");
  const createdId = env.browserWindow.location.pathname.split("/").pop()!;
  assert.equal(createdId, deriveCreationResourceId(String(created[0]!.operationId), JSON.stringify(["private-note", "student-1", "student-1"])));
  assert.equal(new URL(env.browserWindow.location.href).searchParams.get("returnTo"), "/dashboard/student/notes");
  assert.equal(titleOf(device), titleBefore, "제목 칸 노드가 그대로");
  assert.equal(bodyOf(device), bodyBefore, "편집기 노드가 그대로");
  assert.equal(editorMounts, mountsBefore, "편집기를 다시 mount하지 않는다");
  assert.match(device.container.textContent ?? "", /저장됨/u);

  // 이어 쓰면 수정 action으로 저장한다(생성은 다시 부르지 않는다).
  await act(async () => typeInto(env, bodyOf(device)!, "첫 문장 이어 쓴 문장"));
  await waitUntil(() => updated.length === 1, 5000, "생성 뒤에는 수정 action으로 저장해야 합니다.");
  assert.equal(updated[0]!.noteId, createdId);
  assert.equal(updated[0]!.data.contentHtml, "<p>첫 문장 이어 쓴 문장</p>");
  assert.equal(updated[0]!.data.baseRevision, "1", "생성 응답의 version을 기준으로 한다");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  assert.equal(created.length, 1);
  assert.equal(updated.length, 1);
  assert.equal(titleOf(device), titleBefore);
  assert.equal(bodyOf(device), bodyBefore);
  assert.equal(editorMounts, mountsBefore);
  assertNoChooser(device, "생성 뒤");
  assert.deepEqual(tokenRequests.length, 1, "생성 전후 같은 room을 쓰므로 토큰은 다시 받지 않는다");
});

// ---------------------------------------------------------------------------
// 4. 결정적 시드
// ---------------------------------------------------------------------------

test("같은 head로 만든 시드는 몇 번을 합쳐도 본문이 겹치지 않고, 내용이 다르면 서로 다른 시드가 된다", { concurrency: false }, async (context) => {
  setupBrowser(context);
  const extensions = createFullEditorExtensions();
  const input = { key: "note:note-1", version: 3, html: "<p>안녕하세요</p><p>둘째 줄</p>", fields: { title: "제목", noteDate: "2026-11-01" } };

  const first = buildCollabSeedUpdate(input, extensions);
  const second = buildCollabSeedUpdate(input, extensions);
  assert.deepEqual(Array.from(first), Array.from(second), "같은 입력은 같은 바이트");
  assert.equal(collabSeedClientId(input), collabSeedClientId({ ...input }));
  // version만 다르고 내용이 같은 head는 같은 시드다(다른 version으로 시드해도 본문이 겹치지 않는다).
  assert.equal(collabSeedClientId(input), collabSeedClientId({ ...input, version: 4 }));
  assert.deepEqual(Array.from(buildCollabSeedUpdate({ ...input, version: 4 }, extensions)), Array.from(first));
  assert.notEqual(collabSeedClientId(input), collabSeedClientId({ ...input, html: "<p>다름</p>" }));

  // 같은 시드를 두 번 적용해도 한 번만 들어간다.
  const doc = new Y.Doc();
  Y.applyUpdate(doc, first);
  Y.applyUpdate(doc, second);
  Y.applyUpdate(doc, first);
  assert.equal(collabDocHtml(doc, extensions), "<p>안녕하세요</p><p>둘째 줄</p>");
  assert.equal(doc.getMap("meta").get("title"), "제목");
  assert.equal(doc.getMap("meta").get("seeded"), true);

  // 두 기기가 따로 시드한 뒤 서로 합쳐도 겹치지 않는다(어느 쪽이 먼저든).
  const deviceA = new Y.Doc();
  const deviceB = new Y.Doc();
  Y.applyUpdate(deviceA, buildCollabSeedUpdate(input, extensions));
  Y.applyUpdate(deviceB, buildCollabSeedUpdate(input, extensions));
  Y.applyUpdate(deviceA, Y.encodeStateAsUpdate(deviceB));
  Y.applyUpdate(deviceB, Y.encodeStateAsUpdate(deviceA));
  assert.equal(collabDocHtml(deviceA, extensions), "<p>안녕하세요</p><p>둘째 줄</p>");
  assert.equal(collabDocHtml(deviceB, extensions), "<p>안녕하세요</p><p>둘째 줄</p>");
  assert.deepEqual(Array.from(Y.encodeStateVector(deviceA)), Array.from(Y.encodeStateVector(deviceB)));

  // 제목만 다른 head로 따로 시드해도 본문은 겹치지 않고 제목은 하나로 수렴한다.
  const titleA = new Y.Doc();
  const titleB = new Y.Doc();
  Y.applyUpdate(titleA, buildCollabSeedUpdate({ ...input, fields: { ...input.fields, title: "A 제목" } }, extensions));
  Y.applyUpdate(titleB, buildCollabSeedUpdate({ ...input, fields: { ...input.fields, title: "B 제목" } }, extensions));
  Y.applyUpdate(titleA, Y.encodeStateAsUpdate(titleB));
  Y.applyUpdate(titleB, Y.encodeStateAsUpdate(titleA));
  assert.equal(collabDocHtml(titleA, extensions), "<p>안녕하세요</p><p>둘째 줄</p>");
  assert.equal(titleA.getMap("meta").get("title"), titleB.getMap("meta").get("title"));
  titleA.destroy();
  titleB.destroy();

  // 빈 head는 빈 문단 하나로 시작하고 시드 표시만 남는다.
  const empty = new Y.Doc();
  Y.applyUpdate(empty, buildCollabSeedUpdate({ key: "note:empty", version: 0, html: "" }, extensions));
  assert.equal(collabDocHtml(empty, extensions), "<p></p>");
  assert.equal(empty.getMap("meta").get("seeded"), true);
  for (const target of [doc, deviceA, deviceB, empty]) target.destroy();
});

// ---------------------------------------------------------------------------
// 남은 한계(L1~L8) 클라이언트 흐름
// ---------------------------------------------------------------------------

function recoveredKeys(env: Env): string[] {
  const storage = env.browserWindow.localStorage;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith("portal-collab-recovered:")) keys.push(key);
  }
  return keys;
}

const retryButtonOf = (device: Device) =>
  [...device.container.querySelectorAll("button")].find((button) => button.textContent === "다시 시도") as HTMLButtonElement | undefined;

/**
 * 서버 복원 action이 하는 일(준비 → D1 commit → 보관 → 서버가 만든 한 update 적용)을 메모리 room에 그대로 한다.
 * `beforeApply`는 room이 보관하는 동안(서버가 복원 update를 만드는 사이) 일어나는 일이다. 그 입력은 room이 아직 받지 않았다.
 */
async function restoreRoom(
  key: string,
  target: number,
  revision: { html: string; fields: Record<string, string> },
  beforeApply?: () => Promise<void>,
): Promise<void> {
  const core = roomFor(key).core;
  const id = `restore-${target}`;
  const begun = core.restoreBegin(id);
  assert.equal(begun.ok, true, "복원 준비");
  const held = core.restoreHold(id);
  assert.ok(held.ok, "복원 보관");
  const update = buildCollabRestoreUpdate({ base: held.base, current: held.state, html: revision.html, fields: revision.fields, lifecycle: target });
  if (beforeApply) {
    await beforeApply();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  }
  await act(async () => {
    assert.deepEqual(core.restoreApply(id, target, update), { ok: true, applied: true, lifecycle: target });
  });
}

const choiceOf = (device: Device) => device.container.querySelector<HTMLElement>("[data-restore-choice]");
const buttonOf = (device: Device, label: string) =>
  [...device.container.querySelectorAll("button")].find((button) => button.textContent === label) as HTMLButtonElement | undefined;

test("처음 열 때 최신 head 조회가 실패하면 화면의 옛 내용으로 시드하지 않고 재시도 안내·버튼을 보이며, 조회되면 그 head로 연다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  const note = { id: "note-1", title: "화면 제목", contentHtml: "<p>화면 본문</p>", noteDate: null, version: 1 };
  seedFailuresLeft = 1000;
  const device = await env.mount(<NoteEditorForm actorId="student-1" note={note} action={async () => ({})} />);
  await waitUntil(() => Boolean(retryButtonOf(device)), 8000, `조회 실패 안내: ${device.container.textContent}`);
  assert.match(device.container.textContent ?? "", /최신 내용을 불러오지 못했습니다/u);
  assert.equal(fragmentText(rooms.get("note:note-1")!.storage.toDoc()), "", "room에 옛 내용을 시드하지 않는다");
  seedFailuresLeft = 0;
  seedHeads.set(note.id, { title: "서버 제목", contentHtml: "<p>서버 본문</p>", noteDate: null, version: 3, lifecycle: 0 });
  await act(async () => retryButtonOf(device)?.click());
  await waitUntil(() => bodyOf(device)?.value === "서버 본문", 8000, "최신 head로 열려야 합니다.");
  assert.equal(titleOf(device).value, "서버 제목");
});

test("복원은 같은 문서의 한 편집: 두 기기 모두 편집기를 다시 만들지 않고 잠기지 않은 채 복원본을 받고, 겹친 입력이 없으면 선택 안내 없이 이어서 입력한다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  const note = { id: "note-1", title: "원래 제목", contentHtml: "<p>원래 본문</p>", noteDate: null, version: 1 };
  seedHeads.set(note.id, note);
  const okAction = async (_previous: unknown, formData: FormData) => ({
    success: true,
    note: { id: "note-1", title: String(formData.get("title")), contentHtml: String(formData.get("contentHtml")), noteDate: null, version: 2 },
  });
  const deviceA = await env.mount(<NoteEditorForm actorId="student-1" note={note} action={okAction} />);
  await waitReady(deviceA);
  const deviceB = await env.mount(<NoteEditorForm actorId="student-1" note={note} action={okAction} />);
  await waitReady(deviceB);
  await waitUntil(() => [deviceA, deviceB].every((device) => formOf(device).dataset.collabStatus === "connected"), 4000, "두 기기 연결");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  const mounts = editorMounts;
  const tokens = tokenRequests.length;
  let lockedSeen = false;
  const watch = setInterval(() => {
    if ([deviceA, deviceB].some((device) => titleOf(device).disabled || bodyOf(device)?.disabled || !bodyOf(device))) lockedSeen = true;
  }, 5);
  try {
    await restoreRoom("note:note-1", 5, { html: "<p>복원한 본문</p>", fields: { title: "복원한 제목", noteDate: "" } });
    await waitUntil(
      () => [deviceA, deviceB].every((device) => bodyOf(device)?.value === "복원한 본문" && titleOf(device).value === "복원한 제목"),
      4000,
      `두 기기 모두 복원본: ${bodyOf(deviceA)?.value} / ${bodyOf(deviceB)?.value}`,
    );
  } finally {
    clearInterval(watch);
  }
  assert.equal(editorMounts, mounts, "편집기를 다시 만들지 않는다(remount 0)");
  assert.equal(lockedSeen, false, "복원 중 입력이 잠기거나 '불러오는 중'으로 바뀌지 않는다");
  assert.equal(tokenRequests.length, tokens, "다시 연결하지 않는다");
  assert.equal(choiceOf(deviceA), null, "겹친 입력이 없으면 선택 안내가 없다");
  assert.equal(choiceOf(deviceB), null);
  // 복원 뒤 바로 이어서 입력하면 다른 기기에 그대로 간다.
  const docA = mountedDocs.find((doc) => doc === mountedDocs[0])!;
  await act(async () => setFragmentText(docA, "복원한 본문 이어 쓰기"));
  await waitUntil(() => bodyOf(deviceB)?.value === "복원한 본문 이어 쓰기", 3000, "복원 뒤 입력이 다른 기기에 간다");
  assert.deepEqual(recoveredKeys(env), [], "복구본을 남기지 않는다");
});

test("복원과 겹친 이 기기 입력(room이 받기 전): 문서에 남고 비차단 선택 안내가 뜨며, 제거·되돌리기가 되고 고르지 않아도 입력이 이어진다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  const note = { id: "note-1", title: "제목", contentHtml: "<p>첫 문단</p>", noteDate: null, version: 1 };
  seedHeads.set(note.id, note);
  const device = await env.mount(<NoteEditorForm actorId="student-1" note={note} action={async () => ({ success: true })} />);
  await waitReady(device);
  await waitUntil(() => formOf(device).dataset.collabStatus === "connected", 3000, "연결");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  const mounts = editorMounts;
  const doc = mountedDocs[0]!;
  // room이 복원 update를 만드는 사이(보관 중) 이 기기가 입력한다: room은 아직 받지 않았다(ack 전).
  await restoreRoom("note:note-1", 7, { html: "<p>되돌린 문단</p>", fields: { title: "제목", noteDate: "" } }, async () => {
    await act(async () => setFragmentText(doc, "첫 문단 내 입력"));
  });
  await waitUntil(() => choiceOf(device)?.dataset.restoreChoice === "offer", 6000, `선택 안내가 떠야 합니다: ${device.container.textContent}`);
  const kept = bodyOf(device)!.value;
  assert.match(kept, /되돌린 문단/u, "복원본이 들어간다");
  assert.match(kept, /내 입력/u, `내 입력이 문서에 남는다: ${kept}`);
  assert.equal(titleOf(device).disabled, false, "선택을 기다리는 동안에도 입력할 수 있다(모달 아님)");
  assert.equal(editorMounts, mounts, "remount 없음");
  assert.equal(choiceOf(device)?.getAttribute("role"), "status");
  await act(async () => buttonOf(device, "내 입력 제거")!.click());
  await waitUntil(() => choiceOf(device)?.dataset.restoreChoice === "removed", 3000, "제거 상태");
  assert.equal(bodyOf(device)!.value, "되돌린 문단", "제거하면 복원본 그대로");
  await waitUntil(() => fragmentText(rooms.get("note:note-1")!.storage.toDoc()) === "되돌린 문단", 3000, "제거가 room에도 간다");
  await act(async () => buttonOf(device, "되돌리기")!.click());
  await waitUntil(() => /내 입력/u.test(bodyOf(device)!.value), 3000, "되돌리기로 내 입력이 돌아온다");
  assert.equal(choiceOf(device)?.dataset.restoreChoice, "offer");
  await act(async () => buttonOf(device, "내 입력 유지")!.click());
  assert.equal(choiceOf(device), null, "유지하면 안내를 닫는다");
  assert.equal(editorMounts, mounts);
});

test("오프라인 중 다른 기기가 복원해도 다시 연결하면 같은 편집기에서 복원본 위에 오프라인 입력이 남고 선택할 수 있다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  const note = { id: "note-1", title: "제목", contentHtml: "<p>처음</p>", noteDate: null, version: 1 };
  seedHeads.set(note.id, note);
  const device = await env.mount(<NoteEditorForm actorId="student-1" note={note} action={async () => ({ success: true })} />);
  await waitReady(device);
  await waitUntil(() => formOf(device).dataset.collabStatus === "connected", 3000, "연결");
  const mounts = editorMounts;
  await goOffline(env, device);
  assert.equal(titleOf(device).disabled, false, "오프라인에서도 입력할 수 있다");
  await act(async () => typeInto(env, titleOf(device), "오프라인 제목"));
  await act(async () => setFragmentText(mountedDocs[0]!, "처음 오프라인 입력"));
  await restoreRoom("note:note-1", 4, { html: "<p>복원본</p>", fields: { title: "제목", noteDate: "" } });
  tokenOffline = false;
  await act(async () => { env.browserWindow.dispatchEvent(new env.browserWindow.Event("online")); });
  await waitUntil(() => choiceOf(device)?.dataset.restoreChoice === "offer", 8000, `선택 안내: ${device.container.textContent} ${bodyOf(device)?.value}`);
  assert.match(bodyOf(device)!.value, /복원본/u);
  assert.match(bodyOf(device)!.value, /오프라인 입력/u, "오프라인 입력이 문서에 남는다");
  assert.equal(titleOf(device).value, "오프라인 제목", "칸 입력도 남는다");
  assert.equal(editorMounts, mounts, "remount 없음");
  await waitUntil(() => /오프라인 입력/u.test(fragmentText(rooms.get("note:note-1")!.storage.toDoc())), 3000, "연결 뒤 room으로 전송된다");
});

test("L1: 복원 commit 뒤 room 반영 전 저장은 옛 lifecycle이라 거부되고 다시 연결하지 않으며, 반영 뒤 새 lifecycle로 저장된다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  const note = { id: "note-1", title: "제목", contentHtml: "<p>본문</p>", noteDate: null, version: 1 };
  seedHeads.set(note.id, { ...note, lifecycle: 0 });
  let d1Lifecycle = 0;
  const saves: Record<string, FormDataEntryValue>[] = [];
  const action = async (_previous: unknown, formData: FormData) => {
    const data = Object.fromEntries(formData);
    saves.push(data);
    if (Number(data.collabEpoch ?? 0) !== d1Lifecycle) return { error: "stale", collabStale: true, conflictKind: "COLLAB_STALE" as const };
    return { success: true, note: { id: "note-1", title: String(data.title), contentHtml: String(data.contentHtml), noteDate: null, version: saves.length + 1 } };
  };
  const device = await env.mount(<NoteEditorForm actorId="student-1" note={note} action={action} />);
  await waitReady(device);
  await waitUntil(() => formOf(device).dataset.collabStatus === "connected" && formOf(device).dataset.collabSaver === "true", 3000, "연결·저장 담당");
  const tokens = tokenRequests.length;
  d1Lifecycle = 3; // 다른 화면의 복원 commit(room 반영 전)
  await act(async () => typeInto(env, titleOf(device), "복원 사이 입력"));
  await waitUntil(() => saves.some((save) => save.title === "복원 사이 입력"), 4000, "저장 시도");
  const stale = saves.find((save) => save.title === "복원 사이 입력")!;
  assert.equal(String(stale.collabEpoch ?? "0"), "0", "옛 스냅샷은 옛 lifecycle을 싣는다");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  assert.equal(tokenRequests.length, tokens, "거부돼도 다시 연결하지 않는다");
  assert.notEqual(formOf(device).dataset.autosave, "error", "오류가 아니라 복원 반영 대기");
  assert.equal(titleOf(device).disabled, false, "입력은 계속 받는다");
  await restoreRoom("note:note-1", 3, { html: "<p>본문</p>", fields: { title: "제목", noteDate: "" } });
  await waitUntil(() => saves.some((save) => String(save.collabEpoch) === "3"), 6000, `반영 뒤 새 lifecycle로 저장: ${JSON.stringify(saves.map((save) => save.collabEpoch))}`);
});

test("휴지통으로 옮기면 같은 편집기가 그 자리에서 잠기고 안내하며, 되살리면 다시 연결해 같은 편집기로 이어진다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  const note = { id: "note-1", title: "제목", contentHtml: "<p>본문</p>", noteDate: null, version: 1 };
  seedHeads.set(note.id, note);
  const device = await env.mount(<NoteEditorForm actorId="student-1" note={note} action={async () => ({ success: true })} />);
  await waitReady(device);
  await waitUntil(() => formOf(device).dataset.collabStatus === "connected", 3000, "연결");
  const mounts = editorMounts;
  tokenTrashed = true;
  await act(async () => { rooms.get("note:note-1")!.core.closeAll(true); });
  await waitUntil(() => formOf(device).dataset.collabStatus === "trashed", 4000, `휴지통 상태: ${formOf(device).dataset.collabStatus}`);
  assert.equal(titleOf(device).disabled, true, "휴지통 문서는 입력을 받지 않는다");
  assert.equal(bodyOf(device)?.disabled, true);
  assert.match(device.container.textContent ?? "", /휴지통/u);
  assert.equal(editorMounts, mounts, "편집기를 내리지 않는다");
  tokenTrashed = false;
  await act(async () => { env.browserWindow.dispatchEvent(new env.browserWindow.Event("online")); });
  await waitUntil(() => formOf(device).dataset.collabStatus === "connected" && !titleOf(device).disabled, 4000, "되살리면 다시 편집");
  assert.equal(bodyOf(device)?.value, "본문", "같은 문서로 이어진다");
  assert.equal(editorMounts, mounts, "remount 없음");
});

test("처음 연 문서를 오프라인에서 편집한 뒤 다른 기기가 본문을 바꿔도, 다시 연결하면 본문이 겹치지 않고 오프라인 입력이 반영된다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  // 서버는 이미 새 본문(v2)이다. 온라인 기기 B가 room을 그 head로 시드했다.
  seedHeads.set("note-1", { title: "제목", contentHtml: "<p>서버 최신 본문</p>", noteDate: null, version: 2 });
  const deviceB = await env.mount(
    <NoteEditorForm actorId="student-1" note={{ id: "note-1", title: "제목", contentHtml: "<p>서버 최신 본문</p>", noteDate: null, version: 2 }} action={async () => ({})} />,
  );
  await waitReady(deviceB);
  await waitUntil(() => formOf(deviceB).dataset.collabStatus === "connected", 3000, "B가 연결돼야 합니다.");

  // 다른 기기 A(따로 보관하는 기기)는 옛 화면(v1)을 오프라인으로 처음 열어 그 head로 기기 안에서 시드하고 입력한다.
  tokenOffline = true;
  const deviceA = await env.mount(
    <NoteEditorForm actorId="student-1-device-a" note={{ id: "note-1", title: "제목", contentHtml: "<p>옛 본문</p>", noteDate: null, version: 1 }} action={async () => ({})} />,
  );
  await waitUntil(() => bodyOf(deviceA)?.value === "옛 본문", 8000, `A가 오프라인에서 열려야 합니다: ${deviceA.container.textContent} ${formOf(deviceA).dataset.collabStatus}`);
  const mountsAfterOffline = editorMounts;
  const docA = mountedDocs.find((doc) => fragmentText(doc) === "옛 본문")!;
  await act(async () => setFragmentText(docA, "옛 본문 오프라인 입력"));

  // 다시 연결.
  tokenOffline = false;
  await act(async () => { env.browserWindow.dispatchEvent(new env.browserWindow.Event("online")); });
  await waitUntil(
    () => [deviceA, deviceB].every((device) => bodyOf(device)?.value === "서버 최신 본문 오프라인 입력"),
    10_000,
    "두 기기 모두 서버 본문 위에 오프라인 입력이 한 번만 반영돼야 합니다.",
  );
  const roomText = fragmentText(rooms.get("note:note-1")!.storage.toDoc());
  assert.equal(roomText, "서버 최신 본문 오프라인 입력");
  assert.doesNotMatch(roomText, /옛 본문/u, "옛 시드가 겹치지 않는다");
  assert.match(deviceA.container.textContent ?? "", /다시 반영했습니다/u);
  assert.equal(editorMounts, mountsAfterOffline, "다시 연결해도 A의 편집기를 다시 만들지 않는다");
  assert.ok(mountedDocs.includes(docA), "같은 Y.Doc");
  assert.deepEqual(recoveredKeys(env), [], "반영되면 안전 사본을 지운다");
});

test("알림 room: 답글·최근 노트 알림이 오면 화면을 다시 받고, 입력 중이면 멈출 때까지 미루며, 다시 연결하면 놓친 알림을 따라잡는다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  tokenPolicy = { collab: true, mode: "read", userId: "student-1", displayName: "김학생" };
  const device = await env.mount(
    <div>
      <CollabNotifyRefresh topic="qna" id="thread-1" since={Date.now()} />
      <input aria-label="답글" />
    </div>,
  );
  await waitUntil(() => Boolean(rooms.get("notify:qna:thread-1")?.sockets.size), 3000, "알림 room에 붙어야 합니다.");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  const core = rooms.get("notify:qna:thread-1")!.core;
  assert.equal(refreshCount, 0, "첫 연결에서는 다시 받지 않는다");
  await act(async () => { core.notify(); });
  await waitUntil(() => refreshCount === 1, 3000, "알림이 오면 다시 받아야 합니다.");

  // 입력 중에는 미룬다.
  const input = device.container.querySelector("input")!;
  await act(async () => input.focus());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1600)); core.notify(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  assert.equal(refreshCount, 1, "입력 중이면 미룬다");
  await act(async () => input.blur());
  await waitUntil(() => refreshCount === 2, 4000, "입력이 멈추면 미룬 새로 받기를 한다");

  // 연결이 끊긴 사이의 알림은 다시 연결할 때 순번으로 따라잡는다.
  const socket = [...openSockets].find((candidate) => candidate.server.attachment?.key === "notify:qna:thread-1" || candidate.server.attachment !== null)!;
  await act(async () => { socket.closeFromServer(1006, "network"); });
  await act(async () => { core.notify(); });
  await waitUntil(() => refreshCount === 3, 8000, "다시 연결하면 놓친 알림을 따라잡아야 합니다.");
});

async function goOffline(env: Env, device: Device): Promise<void> {
  tokenOffline = true;
  for (const socket of [...openSockets]) socket.closeFromServer(1006, "network");
  await waitUntil(() => formOf(device).dataset.collabStatus === "offline", 4000, "오프라인이 돼야 합니다.");
  void env;
}

test("다시 연결했을 때 읽기 권한으로 바뀌면 같은 편집기가 그 자리에서 읽기 전용이 되고, 보내지 못한 오프라인 입력은 보관함 사본으로 남는다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  const note = { id: "note-1", title: "제목", contentHtml: "<p>처음</p>", noteDate: null, version: 1 };
  seedHeads.set(note.id, note);
  const device = await env.mount(<NoteEditorForm actorId="student-1" note={note} action={async () => ({})} />);
  await waitReady(device);
  await waitUntil(() => formOf(device).dataset.collabStatus === "connected", 3000, "연결돼야 합니다.");
  const mounts = editorMounts;
  await goOffline(env, device);
  await act(async () => setFragmentText(mountedDocs[0]!, "처음 권한 회수 전 입력"));
  tokenPolicy = { ...tokenPolicy, mode: "read" };
  tokenOffline = false;
  await act(async () => { env.browserWindow.dispatchEvent(new env.browserWindow.Event("online")); });
  await waitUntil(() => recoveredKeys(env).length > 0, 8000, "사본을 남겨야 합니다.");
  await waitUntil(() => titleOf(device).disabled && bodyOf(device)?.disabled === true, 4000, "읽기 전용으로 잠긴다");
  assert.equal(editorMounts, mounts, "편집기를 다시 만들지 않는다");
  assert.doesNotMatch(device.container.textContent ?? "", /노트를 불러오는 중/u, "로딩 화면으로 바뀌지 않는다");
  assert.doesNotMatch(fragmentText(rooms.get("note:note-1")!.storage.toDoc()), /권한 회수 전 입력/u, "읽기 연결은 room을 바꾸지 못한다");
});

test("권한이 없어지면(로그아웃·회수) 편집기와 칸이 입력을 받지 않고 다시 로그인 안내를 보인다", { concurrency: false }, async (context) => {
  const env = setupBrowser(context);
  const note = { id: "note-1", title: "제목", contentHtml: "<p>본문</p>", noteDate: null, version: 1 };
  seedHeads.set(note.id, note);
  const device = await env.mount(<NoteEditorForm actorId="student-1" note={note} action={async () => ({})} />);
  await waitReady(device);
  await waitUntil(() => formOf(device).dataset.collabStatus === "connected", 3000, "연결돼야 합니다.");
  tokenDenied = true;
  for (const socket of [...openSockets]) socket.closeFromServer(1006, "network");
  await waitUntil(() => formOf(device).dataset.collabStatus === "denied", 6000, "거부 상태가 돼야 합니다.");
  assert.equal(titleOf(device).disabled, true);
  assert.equal(bodyOf(device)?.disabled, true, "편집기도 잠긴다");
  assert.match(device.container.textContent ?? "", /다시 로그인/u);
});
