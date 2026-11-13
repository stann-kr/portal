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

test("같은 병합을 그 결과 위에 다시 해도 바뀌지 않는 경우들(보장은 아니다: 아래 한계 테스트)", () => {
  const cases: { base: PmDoc; mine: PmDoc; theirs: PmDoc }[] = [
    { base: doc(p("one"), p("two")), mine: doc(p("one"), p("two"), p("three")), theirs: doc(p("one!"), p("two")) },
    { base: doc(p("the quick brown fox")), mine: doc(p("the slow brown fox")), theirs: doc(p("the quick brown cat")) },
    { base: doc(p("ab")), mine: doc(p("aMb")), theirs: doc(p("aTb")) },
    { base: doc(p("the cat sat")), mine: doc(p("the dog sat")), theirs: doc(p("the cow sat")) },
    { base: doc(p("a"), p("b")), mine: doc(p("a"), p("b!")), theirs: doc(p("a")) },
    { base: doc(p("x")), mine: doc(p("x"), p("m")), theirs: doc(p("x"), p("t")) },
    { base: doc(p("abcd")), mine: doc(p("acd")), theirs: doc(p("abd")) },
    // 내가 앞에 넣고 상대가 바로 뒤 블록을 고침.
    { base: doc(p("가")), mine: doc(p("새 줄"), p("가")), theirs: doc(p("가 수정")) },
    // 내가 앞·뒤에 넣고 상대가 그 사이 블록을 다른 종류로 바꿈.
    { base: doc(p("가")), mine: doc(p("앞"), p("가"), p("뒤")), theirs: doc(h(2, "가")) },
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

test("내가 넣은 블록 옆을 고친 문서 위에 다시 병합해도 그 블록이 한 번 더 생기지 않는다", () => {
  const base = doc(p("가"));
  const mine = doc(p("새 줄"), p("가"));
  // 내 삽입이 들어간 뒤 누군가 옆 문단을 고친 문서.
  const theirs = doc(p("새 줄"), p("가 수정"));
  const result = mergeCollabDocuments({ base, mine, theirs });
  assert.deepEqual(texts(result.doc), ["새 줄", "가 수정"]);
  assert.equal(result.changed, false);
  assert.equal(result.conflicts, 0);

  // 여러 블록을 넣었으면 그 묶음이 그대로 이어져 있을 때만 이미 들어간 것으로 본다.
  const pair = mergeCollabDocuments({
    base,
    mine: doc(p("하나"), p("둘"), p("가")),
    theirs: doc(p("하나"), p("둘"), p("가 수정")),
  });
  assert.equal(pair.changed, false);
});

test("이미 들어갔는지는 넣은 자리 옆 구간에서만 본다: 멀리 있는 같은 블록이나 그대로인 이웃 블록은 치지 않는다", () => {
  // 상대가 문서 끝에 같은 글을 넣었어도 내 삽입 자리 양옆이 그대로면 내 블록을 넣는다.
  const far = mergeCollabDocuments({
    base: doc(p("a"), p("b"), p("c")),
    mine: doc(p("a"), p("같은 글"), p("b"), p("c")),
    theirs: doc(p("a"), p("b"), p("c 수정"), p("같은 글")),
  });
  assert.deepEqual(texts(far.doc), ["a", "같은 글", "b", "c 수정", "같은 글"]);

  // 블록을 복제한 것은 옆 블록이 고쳐져도 남는다(복제 원본은 양쪽에 그대로 있는 블록이라 옆 구간에 들지 않는다).
  const duplicated = mergeCollabDocuments({
    base: doc(p("x"), p("가")),
    mine: doc(p("x"), p("x"), p("가")),
    theirs: doc(p("x"), p("가 수정")),
  });
  assert.deepEqual(texts(duplicated.doc), ["x", "x", "가 수정"]);
  const plain = mergeCollabDocuments({ base: doc(p("x")), mine: doc(p("x"), p("x")), theirs: doc(p("x")) });
  assert.deepEqual(texts(plain.doc), ["x", "x"]);
});

test("겹친 구간의 내 블록이 맞닿은 상대 변경 구간에 이미 있으면 다시 붙이지 않는다", () => {
  const result = mergeCollabDocuments({
    base: doc(p("a"), p("b"), p("c")),
    mine: doc(p("a"), p("M")),
    theirs: doc(p("a"), p("M"), p("b"), p("c 수정")),
  });
  assert.deepEqual(texts(result.doc), ["a", "M", "b", "c 수정"]);
  assert.equal(result.changed, false);
});

test("글자: 내가 넣은 글 바로 앞에 이어 쓴 문서 위에 다시 병합해도 그 글이 한 번 더 붙지 않는다", () => {
  const base = doc(p("p1"));
  const mine = doc(p("p1 e2"));
  // 내 " e2"가 들어간 뒤 그 앞에 " e5"를 더 쓴 문서. mine → theirs만 견주면 " e"가 겹쳐 내 구간을 건드린 것처럼 보인다.
  const theirs = doc(p("p1 e5 e2"));
  const result = mergeCollabDocuments({ base, mine, theirs });
  assert.deepEqual(texts(result.doc), ["p1 e5 e2"]);
  assert.equal(result.changed, false);

  // 같은 구간을 바꾼 것도 같다: 내가 바꿔 넣은 글이 상대 글의 끝에 그대로 있다.
  const replaced = mergeCollabDocuments({ base: doc(p("p1 x")), mine: doc(p("p1 e2")), theirs: doc(p("p1 e5 e2")) });
  assert.deepEqual(texts(replaced.doc), ["p1 e5 e2"]);
  assert.equal(replaced.conflicts, 0);
});

test("글자: 내가 지우기만 한 구간을 상대가 다른 글로 바꿨으면 이미 반영된 것으로 보지 않고 둘 다 남긴다", () => {
  const result = mergeCollabDocuments({ base: doc(p("문단35891")), mine: doc(p("문단3589")), theirs: doc(p("문단35893")) });
  assert.deepEqual(texts(result.doc), ["문단35893", "문단3589"]);
  assert.equal(result.conflicts, 1);
});

test("한계: 넣은 뒤 지우거나 고친 것은 처음부터 달랐던 것과 구분하지 못한다(다시 병합하면 되살아나므로 호출하는 쪽이 이미 넣은 작업을 표시한다)", () => {
  // 내가 고친 블록을 넣은 뒤 지운 문서 = 상대가 그 블록을 지운 문서. 3-way는 내 블록을 지키는 쪽을 고른다.
  const revived = mergeCollabDocuments({
    base: doc(p("p0"), p("p1")),
    mine: doc(p("p0"), p("p1 고침")),
    theirs: doc(p("p0")),
  });
  assert.deepEqual(texts(revived.doc), ["p0", "p1 고침"]);
  assert.equal(revived.conflicts, 1);

  // 내가 넣은 블록을 고친 문서 = 상대가 같은 자리에 다른 블록을 넣은 문서.
  const again = mergeCollabDocuments({
    base: doc(p("a")),
    mine: doc(p("a"), p("넣은 글")),
    theirs: doc(p("a"), p("넣은 글을 고침")),
  });
  assert.deepEqual(texts(again.doc), ["a", "넣은 글을 고침", "넣은 글"]);

  // 내가 넣은 블록을 지운 문서 = 아직 넣지 않은 문서.
  const inserted = mergeCollabDocuments({ base: doc(p("a")), mine: doc(p("a"), p("넣은 글")), theirs: doc(p("a")) });
  assert.deepEqual(texts(inserted.doc), ["a", "넣은 글"]);
});

test("무작위(중복 블록·빈 문단·이동 포함): 내가 새로 넣은 블록과 상대가 새로 넣은 블록은 결과에 적어도 한 번 남는다", () => {
  let seed = 20261113;
  const next = (n: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return Math.floor((seed / 0x100000000) * n);
  };
  // 글자 병합이 끼지 않게 글자 전용이 아닌 블록만 쓴다.
  const block = (name: string): PmNode => ({ type: "image", attrs: { src: name } });
  const pool = ["가", "나", "다", "가", "", "나"];
  let fresh = 0;
  const make = () => (next(2) === 0 ? block(`새${fresh++}`) : block(pool[next(pool.length)]));
  const mutate = (blocks: PmNode[], count: number) => {
    const out = [...blocks];
    for (let k = 0; k < count; k += 1) {
      const kind = next(5);
      if (kind < 2 || out.length === 0) out.splice(next(out.length + 1), 0, make());
      else if (kind === 2) out.splice(next(out.length), 1);
      else if (kind === 3) out.splice(next(out.length + 1), 0, out.splice(next(out.length), 1)[0]);
      else out[next(out.length)] = make();
    }
    return out;
  };
  const key = (node: PmNode) => String(node.attrs?.src);
  for (let n = 0; n < 4_000; n += 1) {
    const base = Array.from({ length: 1 + next(6) }, make);
    const mine = mutate(base, 1 + next(3));
    const theirs = mutate(base, next(4));
    const result = mergeCollabDocuments({ base: doc(...base), mine: doc(...mine), theirs: doc(...theirs) });
    const baseKeys = new Set(base.map(key));
    const resultKeys = new Set((result.doc.content ?? []).map(key));
    for (const side of [mine, theirs]) {
      for (const node of side) {
        if (baseKeys.has(key(node))) continue;
        assert.ok(
          resultKeys.has(key(node)),
          `${key(node)} 유실: base ${base.map(key)} / mine ${mine.map(key)} / theirs ${theirs.map(key)} → ${[...(result.doc.content ?? [])].map(key)}`,
        );
      }
    }
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
