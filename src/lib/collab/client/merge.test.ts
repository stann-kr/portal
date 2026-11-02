import assert from "node:assert/strict";
import test from "node:test";
import { hasLocalChanges, mergeCollabDocuments, type PmDoc, type PmNode } from "./merge";

const p = (text: string): PmNode =>
  text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
const h = (level: number, text: string): PmNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const bold = (text: string): PmNode => ({
  type: "paragraph",
  content: [{ type: "text", text, marks: [{ type: "bold" }] }],
});
const doc = (...content: PmNode[]): PmDoc => ({ type: "doc", content });
const texts = (d: PmDoc) =>
  (d.content ?? []).map((node) => (node.content ?? []).map((c) => c.text ?? c.type).join(""));

test("로컬 변경이 없으면 theirs 그대로, changed=false", () => {
  const base = doc(p("a"), p("b"));
  const theirs = doc(p("a"), p("b 수정"), p("c"));
  const result = mergeCollabDocuments({ base, mine: structuredClone(base), theirs });
  assert.deepEqual(result.doc, theirs);
  assert.equal(result.changed, false);
  assert.equal(result.conflicts, 0);
});

test("content가 없는 문서도 빈 목록으로 본다", () => {
  const result = mergeCollabDocuments({ base: { type: "doc" }, mine: { type: "doc" }, theirs: { type: "doc" } });
  assert.deepEqual(result.doc, { type: "doc" });
  assert.equal(result.changed, false);
  const appended = mergeCollabDocuments({ base: { type: "doc" }, mine: doc(p("new")), theirs: { type: "doc" } });
  assert.deepEqual(texts(appended.doc), ["new"]);
  assert.equal(appended.changed, true);
});

test("mine은 문단 추가, theirs는 다른 문단 수정 → 둘 다 반영", () => {
  const base = doc(p("one"), p("two"));
  const mine = doc(p("one"), p("two"), p("three"));
  const theirs = doc(p("one 수정"), p("two"));
  const result = mergeCollabDocuments({ base, mine, theirs });
  assert.deepEqual(texts(result.doc), ["one 수정", "two", "three"]);
  assert.equal(result.changed, true);
  assert.equal(result.conflicts, 0);
});

test("인접한 두 문단을 각각 수정해도 둘 다 반영", () => {
  const base = doc(p("a"), p("b"));
  const result = mergeCollabDocuments({ base, mine: doc(p("A"), p("b")), theirs: doc(p("a"), p("B")) });
  assert.deepEqual(texts(result.doc), ["A", "B"]);
  assert.equal(result.conflicts, 0);
});

test("같은 문단의 다른 낱말을 수정 → 글자 단위 병합", () => {
  const base = doc(p("the quick brown fox"));
  const mine = doc(p("the slow brown fox"));
  const theirs = doc(p("the quick brown cat"));
  const result = mergeCollabDocuments({ base, mine, theirs });
  assert.deepEqual(texts(result.doc), ["the slow brown cat"]);
  assert.equal(result.conflicts, 0);
  assert.equal(result.changed, true);
});

test("같은 자리 삽입은 theirs 다음 mine", () => {
  const base = doc(p("ab"));
  const result = mergeCollabDocuments({ base, mine: doc(p("aMb")), theirs: doc(p("aTb")) });
  assert.deepEqual(texts(result.doc), ["aTMb"]);
  assert.equal(result.conflicts, 0);
});

test("속성이 같은 제목도 글자 병합, 속성이 다르면 충돌", () => {
  const base = doc(h(2, "hello world"));
  const merged = mergeCollabDocuments({ base, mine: doc(h(2, "Hello world")), theirs: doc(h(2, "hello world!")) });
  assert.deepEqual(merged.doc.content, [h(2, "Hello world!")]);
  const conflict = mergeCollabDocuments({ base, mine: doc(h(2, "Hello world")), theirs: doc(h(3, "hello world!")) });
  assert.equal(conflict.conflicts, 1);
  assert.deepEqual(conflict.doc.content, [h(3, "hello world!"), h(2, "Hello world")]);
});

test("같은 낱말을 다르게 수정 → 충돌, 두 블록 모두 유지", () => {
  const base = doc(p("intro"), p("the cat sat"), p("outro"));
  const mine = doc(p("intro"), p("the dog sat"), p("outro"));
  const theirs = doc(p("intro"), p("the cow sat"), p("outro"));
  const result = mergeCollabDocuments({ base, mine, theirs });
  assert.deepEqual(texts(result.doc), ["intro", "the cow sat", "the dog sat", "outro"]);
  assert.equal(result.conflicts, 1);
  assert.equal(result.changed, true);
});

test("반복되는 같은 문단 사이 삽입도 LCS로 정확히 정렬", () => {
  const base = doc(p("x"), p("x"), p("x"));
  const mine = doc(p("x"), p("x"), p("mine"), p("x"));
  const theirs = doc(p("x"), p("theirs"), p("x"), p("x"));
  const result = mergeCollabDocuments({ base, mine, theirs });
  assert.deepEqual(texts(result.doc), ["x", "theirs", "x", "mine", "x"]);
  assert.equal(result.conflicts, 0);
});

test("반복 문단 하나를 theirs가 지우고 mine이 끝에 추가", () => {
  const base = doc(p(""), p("a"), p(""), p("a"));
  const mine = doc(p(""), p("a"), p(""), p("a"), p("b"));
  const theirs = doc(p(""), p("a"), p("a"));
  const result = mergeCollabDocuments({ base, mine, theirs });
  assert.deepEqual(texts(result.doc), ["", "a", "a", "b"]);
  assert.equal(result.conflicts, 0);
});

test("mine이 바뀌지 않은 블록을 지움 → 지운 결과 반영", () => {
  const base = doc(p("a"), p("b"), p("c"));
  const mine = doc(p("a"), p("c"));
  const theirs = doc(p("a 수정"), p("b"), p("c"));
  const result = mergeCollabDocuments({ base, mine, theirs });
  assert.deepEqual(texts(result.doc), ["a 수정", "c"]);
  assert.equal(result.conflicts, 0);
});

test("theirs가 지운 블록을 mine이 수정 → 충돌, mine 블록 유지", () => {
  const base = doc(p("a"), p("b"), p("c"));
  const mine = doc(p("a"), p("b 수정"), p("c"));
  const theirs = doc(p("a"), p("c"));
  const result = mergeCollabDocuments({ base, mine, theirs });
  assert.deepEqual(texts(result.doc), ["a", "b 수정", "c"]);
  assert.equal(result.conflicts, 1);
  assert.equal(result.changed, true);
});

test("같은 병합을 두 번 해도 중복되지 않음(멱등)", () => {
  const cases: { base: PmDoc; mine: PmDoc; theirs: PmDoc }[] = [
    { base: doc(p("one"), p("two")), mine: doc(p("one"), p("two"), p("three")), theirs: doc(p("one!"), p("two")) },
    { base: doc(p("the quick brown fox")), mine: doc(p("the slow brown fox")), theirs: doc(p("the quick brown cat")) },
    { base: doc(p("ab")), mine: doc(p("aMb")), theirs: doc(p("aTb")) },
    { base: doc(p("the cat sat")), mine: doc(p("the dog sat")), theirs: doc(p("the cow sat")) },
    { base: doc(p("a"), p("b")), mine: doc(p("a"), p("b!")), theirs: doc(p("a")) },
    { base: doc(p("x")), mine: doc(p("x"), p("m")), theirs: doc(p("x"), p("t")) },
    { base: doc(p("abcd")), mine: doc(p("acd")), theirs: doc(p("abd")) },
  ];
  for (const { base, mine, theirs } of cases) {
    const first = mergeCollabDocuments({ base, mine, theirs, baseFields: { t: "a" }, mineFields: { t: "b" }, theirsFields: { t: "a" } });
    assert.equal(first.changed, true);
    const second = mergeCollabDocuments({
      base,
      mine,
      theirs: first.doc,
      baseFields: { t: "a" },
      mineFields: { t: "b" },
      theirsFields: first.fields,
    });
    assert.equal(second.changed, false, JSON.stringify(texts(first.doc)));
    assert.deepEqual(second.doc, first.doc);
    assert.equal(second.conflicts, 0);
  }
});

test("mine의 변경이 이미 theirs에 있으면 그대로", () => {
  const base = doc(p("hello"));
  const mine = doc(p("hello world"));
  const theirs = doc(p("hello world"), p("extra"));
  const result = mergeCollabDocuments({ base, mine, theirs });
  assert.deepEqual(result.doc, theirs);
  assert.equal(result.changed, false);
});

test("서식이 있는 블록: 전체가 같은 서식이면 글자 병합, 섞이면 충돌", () => {
  const sameMarks = mergeCollabDocuments({
    base: doc(bold("one two three")),
    mine: doc(bold("ONE two three")),
    theirs: doc(bold("one two THREE")),
  });
  assert.deepEqual(sameMarks.doc.content, [bold("ONE two THREE")]);
  assert.equal(sameMarks.conflicts, 0);

  const mixed: PmNode = {
    type: "paragraph",
    content: [
      { type: "text", text: "one ", marks: [{ type: "bold" }] },
      { type: "text", text: "two three" },
    ],
  };
  const mixedMine: PmNode = {
    type: "paragraph",
    content: [
      { type: "text", text: "ONE ", marks: [{ type: "bold" }] },
      { type: "text", text: "two three" },
    ],
  };
  const result = mergeCollabDocuments({ base: doc(mixed), mine: doc(mixedMine), theirs: doc(p("one two THREE")) });
  assert.equal(result.conflicts, 1);
  assert.deepEqual(result.doc.content, [p("one two THREE"), mixedMine]);

  const markAdded = mergeCollabDocuments({ base: doc(p("one two")), mine: doc(bold("one two")), theirs: doc(p("one two!")) });
  assert.equal(markAdded.conflicts, 1);
  assert.deepEqual(markAdded.doc.content, [p("one two!"), bold("one two")]);
});

test("목록·표(글자 전용이 아닌 블록)는 mine만 바꾸면 그대로 반영, 양쪽이면 충돌", () => {
  const list = (...items: string[]): PmNode => ({
    type: "bulletList",
    content: items.map((item) => ({ type: "listItem", content: [p(item)] })),
  });
  const table = (cell: string): PmNode => ({
    type: "table",
    content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1 }, content: [p(cell)] }] }],
  });
  const base = doc(p("intro"), list("a", "b"), table("x"));
  const mine = doc(p("intro"), list("a", "b", "c"), table("y"));
  const theirs = doc(p("intro 수정"), list("a", "b"), table("x"));
  const result = mergeCollabDocuments({ base, mine, theirs });
  assert.deepEqual(result.doc.content, [p("intro 수정"), list("a", "b", "c"), table("y")]);
  assert.equal(result.conflicts, 0);

  const both = mergeCollabDocuments({ base, mine, theirs: doc(p("intro"), list("a", "z"), table("x")) });
  assert.equal(both.conflicts, 1);
  // mine의 목록·표 변경은 한 구간이라, theirs 구간(목록 z + 표 x) 뒤에 mine 구간을 이어 넣는다.
  assert.deepEqual(both.doc.content, [p("intro"), list("a", "z"), table("x"), list("a", "b", "c"), table("y")]);
});

test("칸: 칸별 3-way", () => {
  const result = mergeCollabDocuments({
    base: doc(),
    mine: doc(),
    theirs: doc(),
    baseFields: { title: "t", tag: "x", score: 1, gone: "g", same: "s" },
    mineFields: { title: "mine", tag: "mine-tag", score: 1, same: "both", added: null },
    theirsFields: { title: "t", tag: "their-tag", score: 2, gone: "g", same: "both" },
  });
  assert.deepEqual(result.fields, { title: "mine", tag: "their-tag", score: 2, same: "both", added: null });
  assert.equal(result.conflicts, 1);
  assert.equal(result.changed, true);

  const noop = mergeCollabDocuments({
    base: doc(),
    mine: doc(),
    theirs: doc(),
    baseFields: { title: "t" },
    mineFields: { title: "t" },
    theirsFields: { title: "server" },
  });
  assert.deepEqual(noop.fields, { title: "server" });
  assert.equal(noop.changed, false);
});

test("hasLocalChanges", () => {
  const base = doc(p("a"));
  assert.equal(hasLocalChanges(base, doc(p("a"))), false);
  assert.equal(hasLocalChanges(base, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }], attrs: {} }] }), false);
  assert.equal(hasLocalChanges({ type: "doc" }, doc()), false);
  assert.equal(hasLocalChanges(base, doc(p("b"))), true);
  assert.equal(hasLocalChanges(base, doc(p("a")), { title: "t" }, { title: "t" }), false);
  assert.equal(hasLocalChanges(base, doc(p("a")), { title: "t" }, { title: "u" }), true);
  assert.equal(hasLocalChanges(base, doc(p("a")), {}, { extra: null }), true);
});

test("아주 긴 문서끼리 크게 달라도 LCS 표를 만들지 않고 병합하며 바뀌지 않은 블록과 내 변경을 지킨다", () => {
  const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const base = { type: "doc" as const, content: Array.from({ length: 3000 }, (_, i) => paragraph(`b${i}`)) };
  const theirs = { type: "doc" as const, content: [paragraph("새 머리"), ...Array.from({ length: 3000 }, (_, i) => paragraph(i % 2 === 0 ? `b${i}` : `t${i}`)), paragraph("끝")] };
  const mine = { type: "doc" as const, content: [...base.content.slice(0, 1500), paragraph("내 입력"), ...base.content.slice(1500)] };
  const result = mergeCollabDocuments({ base, mine, theirs });
  const texts = (result.doc.content ?? []).map((node) => node.content?.[0]?.text);
  assert.ok(texts.includes("내 입력"), "내 입력이 남는다");
  assert.equal(texts.filter((text) => text === "b0").length, 1, "같은 블록을 중복하지 않는다");
  assert.ok(texts.includes("새 머리") && texts.includes("끝"));
});

test("큰 문서 병합(선형 메모리 LCS)도 표 기반과 같은 정렬이라 같은 병합을 다시 해도 중복되지 않는다", () => {
  const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const head = Array.from({ length: 1500 }, (_, i) => paragraph(`h${i}`));
  const tail = ["b0", "b1", "b2", "b3", "b4", "b5"].map(paragraph);
  const base = { type: "doc" as const, content: [...head, ...tail] };
  const mine = { type: "doc" as const, content: [...head, paragraph("b0"), paragraph("b1LOCAL"), paragraph("b2"), paragraph("b3"), paragraph("NEW"), paragraph("b4"), paragraph("b5")] };
  const theirs = {
    type: "doc" as const,
    content: [...Array.from({ length: 1500 }, (_, i) => paragraph(`r${i}`)), ...["Rb0", "b2", "b3", "b4", "b1", "b5R"].map(paragraph)],
  };
  const once = mergeCollabDocuments({ base, mine, theirs });
  const twice = mergeCollabDocuments({ base, mine, theirs: once.doc });
  const count = (doc: { content?: { content?: { text?: string }[] }[] }, text: string) =>
    (doc.content ?? []).filter((node) => node.content?.[0]?.text === text).length;
  assert.equal(count(once.doc, "NEW"), 1);
  assert.equal(count(twice.doc, "NEW"), 1, "다시 병합해도 한 번");
  assert.equal(count(twice.doc, "b1LOCAL"), count(once.doc, "b1LOCAL"), "다시 병합해도 늘지 않는다");
});
