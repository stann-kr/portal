import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { DiggingPlaylist } from "@/lib/actions/digging-playlists";

let createRoot: typeof import("react-dom/client").createRoot;
let PlaylistSection: typeof import("@/components/digging/PlaylistSection").PlaylistSection;
let browser: Window;
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();

let createCalls: unknown[] = [];
let updateCalls: unknown[][] = [];
let deleteCalls: string[] = [];
let createImpl: (input: { url: string; title?: string | null; note?: string | null }) => Promise<unknown>;

mock.module("@/lib/actions/digging-playlists", {
  namedExports: {
    createDiggingPlaylist: async (input: { url: string; title?: string | null; note?: string | null }) => {
      createCalls.push(input);
      return createImpl(input);
    },
    updateDiggingPlaylist: async (id: string, input: { title: string | null; note: string | null }) => {
      updateCalls.push([id, input]);
      return { ok: true, playlist: { ...playlists()[0], ...input, id } };
    },
    deleteDiggingPlaylist: async (id: string) => {
      deleteCalls.push(id);
      return { ok: true };
    },
  },
});
// 외부 SoundCloud 위젯 대신 받은 props만 보이는 자리표시자.
mock.module("@/components/player/SoundCloudPlayer", {
  namedExports: {
    SoundCloudPlayer: ({ url, title, variant }: { url: string; title?: string; variant?: string }) =>
      React.createElement("div", { "data-player": url, "data-variant": variant, title }),
  },
});

function playlists(): DiggingPlaylist[] {
  const at = new Date("2026-10-20T00:00:00.000Z");
  return [
    { id: "sc-1", provider: "soundcloud", url: "https://soundcloud.com/stann/sets/warmup", title: "Warmup", note: "오프닝\n후보", createdAt: at, updatedAt: at },
    { id: "bp-1", provider: "beatport", url: "https://www.beatport.com/playlists/share/11018932", title: null, note: null, createdAt: at, updatedAt: at },
  ];
}

before(async () => {
  browser = new Window({ url: "https://portal.test/dashboard/student/digging" });
  const bindings = {
    window: browser,
    self: browser,
    document: browser.document,
    navigator: browser.navigator,
    HTMLElement: browser.HTMLElement,
    HTMLInputElement: browser.HTMLInputElement,
    HTMLTextAreaElement: browser.HTMLTextAreaElement,
    HTMLFormElement: browser.HTMLFormElement,
    FormData: browser.FormData,
    Node: browser.Node,
    Element: browser.Element,
    Event: browser.Event,
    MutationObserver: browser.MutationObserver,
    getComputedStyle: browser.getComputedStyle.bind(browser),
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  for (const [name, value] of Object.entries(bindings)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ PlaylistSection } = await import("@/components/digging/PlaylistSection"));
});

after(() => {
  browser.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  mock.restoreAll();
});

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

async function render(context: TestContext, element: React.ReactElement) {
  createCalls = [];
  updateCalls = [];
  deleteCalls = [];
  const container = browser.document.createElement("div");
  browser.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  context.after(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  await act(async () => root.render(element));
  await settle();
  return container;
}

function findButton(label: string) {
  return [...browser.document.querySelectorAll("button")].find((element) =>
    element.getAttribute("aria-label") === label || element.textContent?.trim() === label);
}

async function press(label: string) {
  const element = findButton(label);
  assert.ok(element, `button: ${label}`);
  await act(async () => { element.focus(); element.click(); });
  await settle();
}

function field(labelText: string) {
  const label = [...browser.document.querySelectorAll("label")]
    .find((element) => element.textContent?.trim().startsWith(labelText));
  assert.ok(label, `label: ${labelText}`);
  const control = browser.document.getElementById(label.getAttribute("for") ?? "");
  assert.ok(control, `control: ${labelText}`);
  return control as unknown as HTMLInputElement | HTMLTextAreaElement;
}

async function fill(labelText: string, value: string) {
  const control = field(labelText);
  const prototype = control instanceof browser.HTMLTextAreaElement
    ? browser.HTMLTextAreaElement.prototype
    : browser.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  assert.ok(setter);
  await act(async () => {
    setter.call(control, value);
    control.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as Event);
  });
}

async function submit(form: unknown) {
  assert.ok(form instanceof browser.HTMLFormElement);
  await act(async () => {
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

test("관리자 보기는 편집 없이 Beatport 새 탭 링크와 SoundCloud 재생 토글만 보인다", { concurrency: false }, async (context) => {
  const container = await render(context, <PlaylistSection initialPlaylists={playlists()} readonly />);

  assert.equal(container.querySelector("h2")?.textContent, "플레이리스트2");
  assert.equal(findButton("플레이리스트 추가"), undefined);
  assert.equal(findButton("‘Warmup’ 수정"), undefined);
  assert.equal(findButton("‘Beatport 플레이리스트’ 삭제"), undefined);

  const beatport = container.querySelector('a[href="https://www.beatport.com/playlists/share/11018932"]');
  assert.ok(beatport);
  assert.equal(beatport.getAttribute("target"), "_blank");
  assert.equal(beatport.getAttribute("rel"), "noopener noreferrer");
  assert.match(beatport.textContent ?? "", /Beatport 플레이리스트/u);
  assert.match(container.textContent ?? "", /오프닝\n후보/u);

  const play = [...container.querySelectorAll("button")].find((element) => element.textContent?.startsWith("재생"));
  assert.ok(play);
  assert.equal(play.getAttribute("aria-expanded"), "false");
  assert.equal(container.querySelector("[data-player]"), null);
  await act(async () => { play.click(); });
  await settle();
  assert.equal(play.getAttribute("aria-expanded"), "true");
  const player = container.querySelector("[data-player]");
  assert.equal(player?.getAttribute("data-player"), "https://soundcloud.com/stann/sets/warmup");
  assert.equal(player?.getAttribute("data-variant"), "playlist");
  assert.equal(player?.parentElement?.id, play.getAttribute("aria-controls"));
  await act(async () => { play.click(); });
  await settle();
  assert.equal(container.querySelector("[data-player]"), null);
});

test("학생 추가 폼은 단축 링크를 서버 요청 없이 안내하고 정규화한 링크로 등록한다", { concurrency: false }, async (context) => {
  createImpl = async (input) => ({
    ok: true,
    playlist: { id: "new-1", provider: "beatport", url: input.url, title: input.title ?? null, note: input.note ?? null, createdAt: new Date(), updatedAt: new Date() },
  });
  const container = await render(context, <PlaylistSection initialPlaylists={[]} />);
  assert.match(container.textContent ?? "", /아직 등록한 플레이리스트가 없습니다/u);

  await press("플레이리스트 추가");
  const form = container.querySelector('form[aria-label="플레이리스트 추가"]');
  assert.ok(form);
  assert.equal(browser.document.activeElement?.id, field("플레이리스트 링크").id);

  await fill("플레이리스트 링크", "https://on.soundcloud.com/AbCdE");
  await submit(form);
  assert.equal(createCalls.length, 0);
  assert.equal(field("플레이리스트 링크").getAttribute("aria-invalid"), "true");
  assert.match(container.textContent ?? "", /단축 링크/u);

  await fill("플레이리스트 링크", "https://beatport.com/playlists/share/11018932/?utm=x");
  assert.match(container.textContent ?? "", /비워 두면 ‘Beatport 플레이리스트’/u);
  await fill("메모", "  피크 타임  ");
  await submit(form);
  assert.deepEqual(createCalls, [{ url: "https://www.beatport.com/playlists/share/11018932", title: null, note: "피크 타임" }]);
  assert.equal(container.querySelector('form[aria-label="플레이리스트 추가"]'), null);
  assert.ok(container.querySelector('a[href="https://www.beatport.com/playlists/share/11018932"]'));
  assert.equal(browser.document.activeElement?.textContent?.trim(), "플레이리스트 추가");
});

test("서버가 돌려준 중복 오류를 폼에 보이고, 수정·삭제 확인을 거쳐 목록을 갱신한다", { concurrency: false }, async (context) => {
  createImpl = async () => ({ ok: false, error: "이미 등록한 플레이리스트입니다." });
  const container = await render(context, <PlaylistSection initialPlaylists={playlists()} />);

  await press("플레이리스트 추가");
  await fill("플레이리스트 링크", "https://soundcloud.com/stann/sets/warmup");
  await submit(container.querySelector('form[aria-label="플레이리스트 추가"]')!);
  assert.equal(container.querySelector('[role="alert"]')?.textContent, "이미 등록한 플레이리스트입니다.");
  await press("취소");

  await press("‘Warmup’ 수정");
  const editForm = container.querySelector('form[aria-label="‘Warmup’ 수정"]');
  assert.ok(editForm);
  await fill("제목", " Warmup v2 ");
  await submit(editForm);
  assert.deepEqual(updateCalls, [["sc-1", { title: "Warmup v2", note: "오프닝\n후보" }]]);
  assert.ok(findButton("‘Warmup v2’ 수정"));

  await press("‘Beatport 플레이리스트’ 삭제");
  assert.match(container.textContent ?? "", /원래 플레이리스트는 그대로 남습니다/u);
  assert.equal(deleteCalls.length, 0);
  await press("플레이리스트 삭제");
  assert.deepEqual(deleteCalls, ["bp-1"]);
  assert.equal(container.querySelector('a[href="https://www.beatport.com/playlists/share/11018932"]'), null);
  assert.equal(container.querySelector("h2")?.textContent, "플레이리스트1");
});
