import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getPrivateNotePreview, PrivateNoteList } from "./PrivateNoteList";
import { getNoteSearchQuery, searchPrivateNotes } from "./NoteSearch";

const note = {
  id: "old-note", title: "2020 레슨", contentHtml: "", authorName: "강사",
  createdAt: new Date("2020-01-01"), updatedAt: new Date("2020-01-01"), noteDate: null,
};

test("노트 검색은 오래된 본문 끝, 서식 사이 단어와 HTML entity를 찾고 일치 부분을 보여 준다", () => {
  const source = { ...note, contentHtml: `<p>${"다른 연습 ".repeat(1000)}</p><p>비트<strong>매칭</strong> &amp; ＥＱ 조절</p>` };
  const results = searchPrivateNotes([source], "2020 비트매칭 & eq");
  assert.equal(results.length, 1);
  assert.match(results[0].searchPreview ?? "", /비트매칭 & EQ 조절/u);
  assert.equal(searchPrivateNotes([source], "2020 없는단어").length, 0);
  assert.equal(source.contentHtml.includes("<strong>"), true);
  const expandedCase = searchPrivateNotes([{ ...note, contentHtml: `<p>${"İstanbul ".repeat(100)}target EQ</p>` }], "target");
  assert.match(expandedCase[0].searchPreview ?? "", /target EQ/u);
});

test("노트 검색은 숨겨진 코드·HTML 속성을 본문으로 오인하지 않고 빈 검색은 전체 목록을 유지한다", () => {
  const notes = [{ ...note, contentHtml: '<p>레슨 내용</p><a href="https://example.test/hidden-url">링크</a><script>secret-code</script><style>secret-style</style><!-- secret-comment -->' }];
  for (const query of ["hidden-url", "secret-code", "secret-style", "secret-comment"]) {
    assert.equal(searchPrivateNotes(notes, query).length, 0);
  }
  assert.deepEqual(searchPrivateNotes(notes, "  "), notes);
  assert.equal(getNoteSearchQuery(["잘못된", "중복"]), "");
  assert.equal(getNoteSearchQuery("  비트  "), "비트");
  assert.equal(getNoteSearchQuery("a".repeat(300)).length, 120);
  const boundaryQuery = getNoteSearchQuery(`${"a".repeat(119)}😀`);
  assert.equal(boundaryQuery, "a".repeat(119));
  assert.doesNotThrow(() => encodeURIComponent(boundaryQuery));
  assert.equal(getNoteSearchQuery("😀".repeat(61)), "😀".repeat(60));
});

test("노트 목록 preview는 HTML을 렌더하지 않는 짧은 평문이다", () => {
  const preview = getPrivateNotePreview("<p>첫 문장 &amp; <strong>둘째</strong></p><script>alert('x')</script>");
  assert.equal(preview, "첫 문장 & 둘째");
  assert.equal(preview.includes("alert"), false);
  assert.equal(preview.includes("<"), false);
});

test("노트 목록은 노트마다 행 전체가 하나의 링크이고 제목·미리보기·날짜·작성자를 담는다", (context) => {
  // unit runner는 classic JSX로 변환하므로 integration harness처럼 React global을 둔다.
  const globals = globalThis as { React?: typeof React };
  const previousReact = globals.React;
  globals.React = React;
  context.after(() => {
    globals.React = previousReact;
  });
  const markup = renderToStaticMarkup(createElement(PrivateNoteList, {
    returnTo: "/dashboard/student/notes?q=비트",
    notes: [
      { ...note, id: "note-a", title: "비트 매칭", contentHtml: "<p>템포를 맞춘다</p>", noteDate: new Date("2026-10-20T03:00:00Z") },
      { ...note, id: "note-b", title: "EQ", contentHtml: "<p>저음 정리</p>", authorName: null },
    ],
  }));
  const links = [...markup.matchAll(/<a [^>]*href="([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(links, [
    "/dashboard/notes/note-a?returnTo=%2Fdashboard%2Fstudent%2Fnotes%3Fq%3D%EB%B9%84%ED%8A%B8",
    "/dashboard/notes/note-b?returnTo=%2Fdashboard%2Fstudent%2Fnotes%3Fq%3D%EB%B9%84%ED%8A%B8",
  ]);
  assert.match(markup, /비트 매칭[\s\S]*템포를 맞춘다[\s\S]*2026년 10월 20일[\s\S]*강사/u);
  assert.equal(markup.includes("노트 열기"), false);
  assert.match(renderToStaticMarkup(createElement(PrivateNoteList, { notes: [], returnTo: "/x", emptyMessage: "비어 있음" })), /비어 있음/u);
});
