import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  buildGuideNoteQuoteHtml,
  describeGuideQuote,
  guideQuoteNoteTitle,
  planGuideQuoteOpen,
} from "./guide-note-quote";
import { collectGuideQuoteSelection } from "./guide-note-quote-selection";
import { guideQuoteNoteHref, stashGuideQuote, takeGuideQuote } from "./guide-note-quote-handoff";
import { sanitizeHtml } from "./sanitize-html";

test("인용 HTML: 문단·제목·항목·행을 blockquote에 넣고 마지막 줄에 가이드 링크, 아래 빈 문단", () => {
  const html = buildGuideNoteQuoteHtml({
    pageId: "guide-abc",
    pageTitle: "2. 장비 이해",
    blockId: "b1",
    blocks: [
      { kind: "heading", text: "헤드폰 큐" },
      { kind: "text", text: "  플로어에는\n나가지 않는 소리  " },
      { kind: "item", text: "페이더 확인" },
      { kind: "row", text: "CUE · 헤드폰" },
      { kind: "text", text: "   " },
    ],
    skippedImages: 1,
  });
  assert.equal(
    html,
    "<blockquote><p><strong>헤드폰 큐</strong></p><p>플로어에는 나가지 않는 소리</p><p>• 페이더 확인</p><p>CUE · 헤드폰</p>" +
      '<p><a href="/dashboard/guide/guide-abc#b1">가이드 · 2. 장비 이해</a></p></blockquote><p></p>',
  );
});

test("인용 HTML: 글을 escape하고, 잘못된 블록 식별자는 링크에서 뺀다. 담을 글이 없으면 null", () => {
  const html = buildGuideNoteQuoteHtml({
    pageId: "guide-abc",
    pageTitle: "<b>제목</b>",
    blockId: "bad id\"><script>",
    blocks: [{ kind: "text", text: '<img src=x onerror="alert(1)"> & "따옴표"' }],
    skippedImages: 0,
  });
  assert.ok(html);
  assert.match(html, /href="\/dashboard\/guide\/guide-abc"/u);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &quot;따옴표&quot;/u);
  assert.match(html, /가이드 · &lt;b&gt;제목&lt;\/b&gt;/u);
  assert.equal(
    buildGuideNoteQuoteHtml({ pageId: "guide-abc", pageTitle: "x", blockId: null, blocks: [{ kind: "text", text: " " }], skippedImages: 0 }),
    null,
  );
});

test("인용 HTML은 sanitize를 거쳐도 그대로다(노트 저장 경로)", () => {
  const html = buildGuideNoteQuoteHtml({
    pageId: "guide-abc",
    pageTitle: "제목 & 부제",
    blockId: "b_1-x",
    blocks: [{ kind: "text", text: "a < b" }, { kind: "item", text: "항목" }],
    skippedImages: 0,
  })!;
  assert.equal(sanitizeHtml(html), html);
});

test("인용 HTML에는 길이 제한이 없다", () => {
  const long = "가".repeat(20_000);
  const html = buildGuideNoteQuoteHtml({ pageId: "guide-abc", pageTitle: "t", blockId: null, blocks: [{ kind: "text", text: long }], skippedImages: 0 });
  assert.ok(html?.includes(long));
});

test("패널 한 줄 설명과 새 노트 제목", () => {
  assert.equal(
    describeGuideQuote({ pageTitle: "2. 장비 이해", blocks: [{ kind: "text", text: "a" }, { kind: "text", text: "b" }, { kind: "text", text: "c" }], skippedImages: 1 }),
    "2. 장비 이해 · 3문단 · 사진 1장은 빠짐",
  );
  assert.equal(describeGuideQuote({ pageTitle: "개요", blocks: [{ kind: "text", text: "a" }], skippedImages: 0 }), "개요 · 1문단");
  assert.equal(guideQuoteNoteTitle(" 2. 장비 이해 "), "가이드: 2. 장비 이해");
});

test("페이지 열기 계획: 전체는 그대로, 선택은 더하기(이미 있으면 그대로), 닫힘은 옛 선택을 비우고 이 페이지만", () => {
  assert.deepEqual(planGuideQuoteOpen({ setting: "ALL", pageIds: [] }, "p1"), { kind: "none" });
  assert.deepEqual(planGuideQuoteOpen({ setting: "SELECTED", pageIds: ["p1"] }, "p1"), { kind: "none" });
  assert.deepEqual(planGuideQuoteOpen({ setting: "SELECTED", pageIds: ["p2"] }, "p1"), { kind: "add-page" });
  assert.deepEqual(planGuideQuoteOpen({ setting: "CLOSED", pageIds: ["p2", "p1", "p3"] }, "p1"), {
    kind: "select-only",
    clearPageIds: ["p2", "p3"],
  });
  assert.deepEqual(planGuideQuoteOpen({ setting: "CLOSED", pageIds: [] }, "p1"), { kind: "select-only", clearPageIds: [] });
});

function guideDom(html: string) {
  const window = new Window({ url: "https://portal.test/dashboard/guide/guide-abc" });
  const document = window.document;
  const content = document.createElement("div");
  content.innerHTML = html;
  document.body.appendChild(content);
  return { document, content: content as unknown as Element };
}

function textNode(element: Element | null): Text {
  const node = element?.firstChild;
  assert.ok(node && node.nodeType === 3, "text node");
  return node as Text;
}

test("선택 읽기: 여러 문단에 걸친 구간은 첫·끝 문단을 고른 곳까지만, 링크는 첫 문단", () => {
  const { document, content } = guideDom(
    '<h2 data-block-id="h">헤드폰 큐</h2><p data-block-id="a">첫째 문단입니다</p>' +
      '<img data-block-id="i" src="/x.png"><ul data-block-id="u"><li data-block-id="l"><p data-block-id="lp">목록 항목</p></li></ul>' +
      '<p data-block-id="b">마지막 문단입니다</p><p data-block-id="c">밖</p>',
  );
  const range = document.createRange() as unknown as Range;
  range.setStart(textNode(content.querySelector('[data-block-id="a"]')), 3);
  range.setEnd(textNode(content.querySelector('[data-block-id="b"]')), 3);
  assert.deepEqual(collectGuideQuoteSelection(content, range), {
    blockId: "a",
    blocks: [
      { kind: "text", text: "문단입니다" },
      { kind: "item", text: "목록 항목" },
      { kind: "text", text: "마지막" },
    ],
    skippedImages: 1,
  });
});

test("선택 읽기: 표는 행마다 칸 글을 잇고, 제목은 heading", () => {
  const { document, content } = guideDom(
    '<h3 data-block-id="h">표 제목</h3><table data-block-id="t"><tbody><tr><th><p data-block-id="p1">CUE</p></th><td><p data-block-id="p2">헤드폰</p></td></tr>' +
      '<tr><td><p data-block-id="p3">MIX</p></td><td><p data-block-id="p4">비율</p></td></tr></tbody></table>',
  );
  const range = document.createRange() as unknown as Range;
  range.setStart(textNode(content.querySelector('[data-block-id="h"]')), 0);
  range.setEnd(textNode(content.querySelector('[data-block-id="p3"]')), 3);
  assert.deepEqual(collectGuideQuoteSelection(content, range)?.blocks, [
    { kind: "heading", text: "표 제목" },
    { kind: "row", text: "CUE · 헤드폰" },
    { kind: "row", text: "MIX" },
  ]);
});

test("선택 읽기: 본문 밖·빈 구간은 null", () => {
  const { document, content } = guideDom('<p data-block-id="a">글</p>');
  const outside = document.createElement("p");
  outside.textContent = "밖";
  document.body.appendChild(outside);
  const range = document.createRange() as unknown as Range;
  range.selectNodeContents(outside as unknown as Node);
  assert.equal(collectGuideQuoteSelection(content, range), null);
  const empty = document.createRange() as unknown as Range;
  empty.setStart(textNode(content.querySelector("p")), 0);
  assert.equal(collectGuideQuoteSelection(content, empty), null);
});

test("인용 넘기기: token으로 한 번만 꺼내고, 오래된 보관·잘못된 token은 비어 있다", () => {
  const store = new Map<string, string>();
  const fakeWindow = {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = fakeWindow;
  try {
    const now = 1_000_000_000;
    const token = stashGuideQuote("<blockquote><p>a</p></blockquote><p></p>", now);
    assert.ok(token);
    assert.equal(takeGuideQuote(token, now + 1000), "<blockquote><p>a</p></blockquote><p></p>");
    assert.equal(takeGuideQuote(token, now + 2000), null, "두 번째는 비어 있다");
    const old = stashGuideQuote("<p>old</p>", now)!;
    assert.equal(takeGuideQuote(old, now + 31 * 60 * 1000), null);
    assert.equal(store.size, 0, "꺼내면 보관을 지운다");
    assert.equal(takeGuideQuote("../x", now), null);
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
});

test("넣고 노트 열기 주소: 있는 노트·학생 새 노트·관리자 그룹 새 노트", () => {
  assert.equal(
    guideQuoteNoteHref({ token: "tok-12345678", returnTo: "/dashboard/guide/guide-abc", target: { kind: "note", noteId: "n1" } }),
    "/dashboard/notes/n1?guideQuote=tok-12345678&returnTo=%2Fdashboard%2Fguide%2Fguide-abc",
  );
  assert.equal(
    guideQuoteNoteHref({
      token: "tok-12345678",
      returnTo: "/dashboard/guide/g",
      target: { kind: "new", studentId: "s1", asAdmin: false, group: false, title: "가이드: 개요" },
    }),
    "/dashboard/student/notes/new?title=%EA%B0%80%EC%9D%B4%EB%93%9C%3A+%EA%B0%9C%EC%9A%94&guideQuote=tok-12345678&returnTo=%2Fdashboard%2Fguide%2Fg",
  );
  assert.match(
    guideQuoteNoteHref({
      token: "tok-12345678",
      returnTo: "/dashboard/guide/g",
      target: { kind: "new", studentId: "s 1", asAdmin: true, group: true, title: "t" },
    }),
    /^\/dashboard\/admin\/students\/s%201\/notes\/new\?title=t&space=group&guideQuote=/u,
  );
});
