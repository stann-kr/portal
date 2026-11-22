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
// 모든 쓰기 action이 받은 대상 학생 id. 화면이 넘긴 studentId가 그대로 가야 한다.
let targetCalls: string[] = [];
let createImpl: (input: { url: string; title?: string | null; note?: string | null }) => Promise<unknown>;

mock.module("@/lib/actions/digging-playlists", {
  namedExports: {
    createDiggingPlaylist: async (studentId: string, input: { url: string; title?: string | null; note?: string | null }) => {
      targetCalls.push(studentId);
      createCalls.push(input);
      return createImpl(input);
    },
    updateDiggingPlaylist: async (studentId: string, id: string, input: { url?: string; title: string | null; note: string | null }) => {
      targetCalls.push(studentId);
      updateCalls.push([id, input]);
      return { ok: true, playlist: { ...playlists()[0], ...input, id } };
    },
    deleteDiggingPlaylist: async (studentId: string, id: string) => {
      targetCalls.push(studentId);
      deleteCalls.push(id);
      return { ok: true };
    },
  },
});
type ImportItem = { title: string; artist: string; linkUrl: string | null };
let importCalls: ImportItem[][] = [];
let soundReads: string[] = [];
let soundsImpl: (url: string) => Promise<unknown[]> = async () => [];
mock.module("@/lib/actions/digging", {
  namedExports: {
    importDiggingTracks: async (items: ImportItem[]) => {
      importCalls.push(items);
      return {
        ok: true,
        created: items.map((item, index) => ({ id: `new-${index}`, createdAt: new Date(), linkUrl: item.linkUrl, values: { title: item.title } })),
        skipped: 0,
      };
    },
  },
});
// 외부 SoundCloud 위젯 대신 정해 둔 곡 정보를 돌려준다.
mock.module("@/components/digging/soundcloud-playlist-sounds", {
  namedExports: {
    readSoundCloudPlaylistSounds: async (url: string) => {
      soundReads.push(url);
      return soundsImpl(url);
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
  targetCalls = [];
  importCalls = [];
  soundReads = [];
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

async function pressEscape() {
  const target = browser.document.activeElement;
  assert.ok(target);
  await act(async () => {
    target.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await settle();
}

async function submit(form: unknown) {
  assert.ok(form instanceof browser.HTMLFormElement);
  await act(async () => {
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

test("관리자 보기도 추가·수정·삭제를 보이고 Beatport 새 탭 링크와 SoundCloud 재생 토글을 둔다", { concurrency: false }, async (context) => {
  const container = await render(context, <PlaylistSection studentId="student-1" initialPlaylists={playlists()} viewer="admin" />);

  assert.equal(container.querySelector("h2")?.textContent, "플레이리스트2");
  assert.ok(findButton("플레이리스트 추가"));
  assert.ok(findButton("‘Warmup’ 수정"));
  assert.ok(findButton("‘Beatport 플레이리스트’ 삭제"));
  assert.equal(
    [...container.querySelectorAll("button")].some((element) => element.textContent?.startsWith("트랙 가져오기")),
    false,
    "트랙 보드는 학생 본인만 바꾸므로 관리자 보기에는 가져오기가 없다",
  );

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

  // 삭제는 화면이 받은 대상 학생 id와 함께 보낸다.
  await press("‘Beatport 플레이리스트’ 삭제");
  await press("플레이리스트 삭제");
  assert.deepEqual(deleteCalls, ["bp-1"]);
  assert.deepEqual(targetCalls, ["student-1"]);
});

test("관리자 보기의 빈 목록은 학생에게 하는 말 대신 추가할 수 있다고 안내한다", { concurrency: false }, async (context) => {
  const container = await render(context, <PlaylistSection studentId="student-9" initialPlaylists={[]} viewer="admin" />);
  assert.match(container.textContent ?? "", /학생과 함께 들을/u);
  assert.doesNotMatch(container.textContent ?? "", /Stann과 함께/u);
  assert.ok(findButton("플레이리스트 추가"));
});

test("학생 추가 폼은 단축 링크를 서버 요청 없이 안내하고 정규화한 링크로 등록한다", { concurrency: false }, async (context) => {
  createImpl = async (input) => ({
    ok: true,
    playlist: { id: "new-1", provider: "beatport", url: input.url, title: input.title ?? null, note: input.note ?? null, createdAt: new Date(), updatedAt: new Date() },
  });
  const container = await render(context, <PlaylistSection studentId="student-1" initialPlaylists={[]} />);
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
  const container = await render(context, <PlaylistSection studentId="student-1" initialPlaylists={playlists()} />);

  await press("플레이리스트 추가");
  await fill("플레이리스트 링크", "https://soundcloud.com/stann/sets/warmup");
  await submit(container.querySelector('form[aria-label="플레이리스트 추가"]')!);
  assert.equal(container.querySelector('[role="alert"]')?.textContent, "이미 등록한 플레이리스트입니다.");
  await press("취소");
  await press("저장하지 않고 닫기");

  await press("‘Warmup’ 수정");
  const editForm = container.querySelector('form[aria-label="‘Warmup’ 수정"]');
  assert.ok(editForm);
  assert.equal(editForm.hasAttribute("novalidate"), true);
  // 링크 칸은 현재 링크로 시작하고 첫 초점을 받는다. 링크 변경을 막는 안내는 없다.
  assert.equal(field("플레이리스트 링크").value, "https://soundcloud.com/stann/sets/warmup");
  assert.equal(browser.document.activeElement?.id, field("플레이리스트 링크").id);
  assert.doesNotMatch(container.textContent ?? "", /삭제한 뒤 다시 추가/u);
  await fill("제목", " Warmup v2 ");
  await submit(editForm);
  assert.deepEqual(updateCalls, [["sc-1", { url: "https://soundcloud.com/stann/sets/warmup", title: "Warmup v2", note: "오프닝\n후보", expectedUpdatedAt: Date.parse("2026-10-20T00:00:00.000Z") }]]);
  assert.ok(findButton("‘Warmup v2’ 수정"));

  await press("‘Beatport 플레이리스트’ 삭제");
  assert.match(container.textContent ?? "", /원래 플레이리스트는 그대로 남습니다/u);
  assert.equal(deleteCalls.length, 0);
  await press("플레이리스트 삭제");
  assert.deepEqual(deleteCalls, ["bp-1"]);
  assert.deepEqual(targetCalls, ["student-1", "student-1", "student-1"]);
  assert.equal(container.querySelector('a[href="https://www.beatport.com/playlists/share/11018932"]'), null);
  assert.equal(container.querySelector("h2")?.textContent, "플레이리스트1");
  // 지운 행의 버튼 대신 추가 버튼으로 초점이 간다.
  assert.equal(browser.document.activeElement?.textContent?.trim(), "플레이리스트 추가");
});

test("수정 폼에서 링크를 바꾸면 provider 안내가 바뀌고, 잘못된 링크는 서버 요청 없이 칸에 안내한다", { concurrency: false }, async (context) => {
  const container = await render(context, <PlaylistSection studentId="student-1" initialPlaylists={playlists()} />);
  await press("‘Beatport 플레이리스트’ 수정");
  const editForm = container.querySelector('form[aria-label="‘Beatport 플레이리스트’ 수정"]');
  assert.ok(editForm);

  await fill("플레이리스트 링크", "https://soundcloud.com:443/stann/sets/peak");
  await submit(editForm);
  assert.equal(updateCalls.length, 0);
  assert.equal(field("플레이리스트 링크").getAttribute("aria-invalid"), "true");
  assert.match(container.textContent ?? "", /https로 시작하는 공유 링크/u);

  await fill("플레이리스트 링크", "https://m.soundcloud.com/stann/sets/peak?si=1");
  assert.match(editForm.textContent ?? "", /SoundCloud/u);
  assert.match(container.textContent ?? "", /비워 두면 SoundCloud에서 제목을 가져옵니다/u);
  await submit(editForm);
  assert.deepEqual(updateCalls, [["bp-1", { url: "https://soundcloud.com/stann/sets/peak", title: null, note: null, expectedUpdatedAt: Date.parse("2026-10-20T00:00:00.000Z") }]]);
});

test("바뀐 내용이 있는 폼은 Esc·취소에 버림 확인을 거치고, 바뀐 내용이 없으면 바로 닫는다", { concurrency: false }, async (context) => {
  const container = await render(context, <PlaylistSection studentId="student-1" initialPlaylists={playlists()} />);

  await press("플레이리스트 추가");
  assert.equal(container.querySelector('form[aria-label="플레이리스트 추가"]')?.hasAttribute("novalidate"), true);
  await pressEscape();
  assert.equal(container.querySelector('form[aria-label="플레이리스트 추가"]'), null, "빈 추가 폼은 Esc로 바로 닫힌다");

  await press("플레이리스트 추가");
  await fill("메모", "적던 메모");
  field("메모").focus();
  await pressEscape();
  assert.ok(container.querySelector('form[aria-label="플레이리스트 추가"]'), "입력이 있으면 Esc로 닫지 않는다");
  assert.match(container.textContent ?? "", /작성 중인 내용이 있습니다/u);
  assert.equal(browser.document.activeElement?.textContent?.trim(), "취소");
  // 확인의 취소(초점 위치)는 확인만 닫고 내용을 남긴다.
  await act(async () => { (browser.document.activeElement as unknown as HTMLButtonElement).click(); });
  await settle();
  assert.doesNotMatch(container.textContent ?? "", /작성 중인 내용이 있습니다/u);
  assert.equal(field("메모").value, "적던 메모");
  await press("취소");
  await press("저장하지 않고 닫기");
  assert.equal(container.querySelector('form[aria-label="플레이리스트 추가"]'), null);

  await press("‘Warmup’ 수정");
  await press("취소");
  assert.equal(container.querySelector('form[aria-label="‘Warmup’ 수정"]'), null, "바뀐 내용이 없으면 바로 닫는다");
  await press("‘Warmup’ 수정");
  await fill("플레이리스트 링크", "https://www.beatport.com/playlists/share/5");
  await pressEscape();
  assert.ok(container.querySelector('form[aria-label="‘Warmup’ 수정"]'));
  await press("저장하지 않고 닫기");
  assert.equal(container.querySelector('form[aria-label="‘Warmup’ 수정"]'), null);
  assert.equal(updateCalls.length, 0);
});

type Container = Awaited<ReturnType<typeof render>>;

function importToggle(container: Container, playlistName: string) {
  const row = [...container.querySelectorAll("li")].find((element) => element.textContent?.includes(playlistName));
  const toggle = row && [...row.querySelectorAll("button")].find((element) => element.textContent?.startsWith("트랙 가져오기"));
  assert.ok(toggle, `트랙 가져오기: ${playlistName}`);
  return toggle;
}

function importRows(container: Container) {
  return [...container.querySelectorAll('[data-import-list] input[type="checkbox"]')].map((input) => {
    const box = input as unknown as HTMLInputElement;
    return { text: box.closest("label")?.textContent ?? "", checked: box.checked, disabled: box.disabled };
  });
}

const BOARD_COLUMNS = [
  { id: "c-title", name: "트랙명", columnType: "text" as const },
  { id: "c-artist", name: "아티스트", columnType: "text" as const },
  { id: "c-link", name: "링크", columnType: "link" as const },
];

test("학생은 SoundCloud 앞 곡을 읽어 고르고, 보드에 있는 곡은 고를 수 없으며, 붙여 넣은 곡과 함께 보드에 넣는다", { concurrency: false }, async (context) => {
  soundsImpl = async () => [
    { title: "Lane 8 - Midnight Drive", permalink_url: "https://soundcloud.com/lane8/midnight-drive", user: { username: "Label" } },
    { title: "Overtime", permalink_url: "https://soundcloud.com/kerri/overtime", user: { username: "Kerri Chandler" } },
    { title: "Sun Tunnels", permalink_url: "https://soundcloud.com/lord/sun", user: { username: "Lord of the Isles" } },
    ...Array.from({ length: 26 }, (_, index) => ({ id: index, kind: "track" })),
  ];
  const imported: unknown[][] = [];
  const container = await render(context, (
    <PlaylistSection
      studentId="student-1"
      initialPlaylists={playlists()}
      trackImport={{
        columns: BOARD_COLUMNS,
        tracks: [{ linkUrl: "https://soundcloud.com/kerri/overtime", values: {} }],
        onImported: (created) => imported.push(created),
      }}
    />
  ));
  const toggle = importToggle(container, "Warmup");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await act(async () => { toggle.click(); });
  await settle();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.deepEqual(soundReads, ["https://soundcloud.com/stann/sets/warmup"]);
  assert.match(container.textContent ?? "", /29곡 중 앞 3곡을 불러왔습니다\. 나머지 26곡은 아래에 목록을 붙여 넣어 더할 수 있습니다\./u);
  assert.deepEqual(importRows(container), [
    { text: "Midnight Drive · Lane 8", checked: true, disabled: false },
    { text: "Overtime · Kerri Chandler보드에 있음", checked: false, disabled: true },
    { text: "Sun Tunnels · Lord of the Isles", checked: true, disabled: false },
  ]);

  await fill("나머지 곡 목록 붙여넣기(선택)", "Moderat - Cold Water\nLane 8 - Midnight Drive\n");
  assert.deepEqual(importRows(container).map((row) => row.text), [
    "Midnight Drive · Lane 8",
    "Overtime · Kerri Chandler보드에 있음",
    "Sun Tunnels · Lord of the Isles",
    "Cold Water · Moderat",
  ], "위 목록과 같은 트랙명·아티스트인 붙여 넣은 줄은 한 번만 보인다");

  const sun = [...container.querySelectorAll('[data-import-list] label')].find((label) => label.textContent?.startsWith("Sun Tunnels"));
  await act(async () => { (sun?.querySelector("input") as unknown as HTMLInputElement).click(); });
  await settle();
  await press("고른 2곡 디깅 보드에 추가");
  assert.deepEqual(importCalls, [[
    { title: "Midnight Drive", artist: "Lane 8", linkUrl: "https://soundcloud.com/lane8/midnight-drive" },
    { title: "Cold Water", artist: "Moderat", linkUrl: null },
  ]]);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].length, 2);
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /2곡을 디깅 보드에 넣었습니다/u);

  await press("닫기");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(container.querySelector("[data-import-list]"), null);
  assert.equal(browser.document.activeElement, toggle);
});

test("SoundCloud를 읽지 못하면 붙여넣기로 안내하고, Beatport는 처음부터 붙여넣기만 받는다", { concurrency: false }, async (context) => {
  soundsImpl = async () => { throw new Error("blocked"); };
  const container = await render(context, (
    <PlaylistSection studentId="student-1" initialPlaylists={playlists()} trackImport={{ columns: BOARD_COLUMNS, tracks: [], onImported: () => undefined }} />
  ));
  await act(async () => { importToggle(container, "Warmup").click(); });
  await settle();
  assert.match(container.textContent ?? "", /SoundCloud에서 곡 목록을 읽지 못했습니다/u);
  await press("닫기");

  await act(async () => { importToggle(container, "Beatport 플레이리스트").click(); });
  await settle();
  assert.equal(soundReads.length, 1, "Beatport는 외부에서 읽지 않는다");
  assert.match(container.textContent ?? "", /Beatport 곡 목록은 자동으로 읽을 수 없습니다/u);
  const add = findButton("고른 0곡 디깅 보드에 추가");
  assert.ok(add?.disabled, "고른 곡이 없으면 추가를 막는다");
  await fill("곡 목록 붙여넣기", "Rival Consoles - Glass Floor\nModerat - Cold Water\nFloorplan - Never Grow Old");
  assert.deepEqual(importRows(container).map((row) => row.text), [
    "Glass Floor · Rival Consoles",
    "Cold Water · Moderat",
    "Never Grow Old · Floorplan",
  ]);
  assert.match(container.textContent ?? "", /붙여 넣은 곡에는 링크가 없습니다\. 보드에서 링크 칸으로 더할 수 있습니다\./u);
  await press("고른 3곡 디깅 보드에 추가");
  assert.equal(importCalls[0].length, 3);
});

test("붙여 넣은 글이 있으면 가져오기 칸을 닫거나 다른 줄을 열기 전에 버림 확인을 거친다", { concurrency: false }, async (context) => {
  soundsImpl = async () => [];
  const container = await render(context, (
    <PlaylistSection studentId="student-1" initialPlaylists={playlists()} trackImport={{ columns: BOARD_COLUMNS, tracks: [], onImported: () => undefined }} />
  ));
  const beatport = importToggle(container, "Beatport 플레이리스트");
  await act(async () => { beatport.click(); });
  await settle();
  await fill("곡 목록 붙여넣기", "Rival Consoles - Glass Floor");

  // 닫기 → 확인(초점은 취소). 취소하면 글이 남는다.
  await press("닫기");
  assert.equal(beatport.getAttribute("aria-expanded"), "true", "붙여 넣은 글이 있으면 바로 닫지 않는다");
  assert.match(container.textContent ?? "", /작성 중인 내용이 있습니다/u);
  assert.equal(browser.document.activeElement?.textContent?.trim(), "취소");
  await act(async () => { (browser.document.activeElement as unknown as HTMLButtonElement).click(); });
  await settle();
  assert.doesNotMatch(container.textContent ?? "", /작성 중인 내용이 있습니다/u);
  assert.equal(field("곡 목록 붙여넣기").value, "Rival Consoles - Glass Floor");

  // 줄의 토글과 칸 안의 Esc도 같은 확인을 거친다.
  await act(async () => { beatport.click(); });
  await settle();
  assert.match(container.textContent ?? "", /작성 중인 내용이 있습니다/u);
  await press("취소");
  field("곡 목록 붙여넣기").focus();
  await pressEscape();
  assert.match(container.textContent ?? "", /작성 중인 내용이 있습니다/u);
  await press("취소");

  // 다른 줄의 가져오기를 열려고 해도 묻고, 버리면 그 줄이 열린다.
  const warmup = importToggle(container, "Warmup");
  await act(async () => { warmup.click(); });
  await settle();
  assert.equal(warmup.getAttribute("aria-expanded"), "false");
  assert.match(container.textContent ?? "", /작성 중인 내용이 있습니다/u);
  await press("저장하지 않고 닫기");
  assert.equal(beatport.getAttribute("aria-expanded"), "false");
  assert.equal(warmup.getAttribute("aria-expanded"), "true");
  assert.doesNotMatch(container.textContent ?? "", /작성 중인 내용이 있습니다/u, "새로 연 줄에 확인이 남지 않는다");

  // 같은 줄을 고치려 해도 묻고, 버리면 수정 폼이 열린다.
  await fill("나머지 곡 목록 붙여넣기(선택)", "Moderat - Cold Water");
  await press("‘Warmup’ 수정");
  assert.equal(container.querySelector('form[aria-label="‘Warmup’ 수정"]'), null, "붙여 넣은 글이 있으면 바로 수정 폼을 열지 않는다");
  assert.match(container.textContent ?? "", /작성 중인 내용이 있습니다/u);
  await press("저장하지 않고 닫기");
  assert.ok(container.querySelector('form[aria-label="‘Warmup’ 수정"]'));
  assert.equal(warmup.isConnected, false, "수정 폼이 줄을 대신한다");
  assert.doesNotMatch(container.textContent ?? "", /작성 중인 내용이 있습니다/u);
  await press("취소");
  const reopened = importToggle(container, "Warmup");
  assert.equal(reopened.getAttribute("aria-expanded"), "false", "수정을 닫아도 버린 가져오기 칸은 다시 열리지 않는다");
  await act(async () => { reopened.click(); });
  await settle();

  // 붙여 넣은 글이 없으면 묻지 않고 닫는다.
  await press("닫기");
  assert.equal(reopened.getAttribute("aria-expanded"), "false");
  assert.doesNotMatch(container.textContent ?? "", /작성 중인 내용이 있습니다/u);
});
