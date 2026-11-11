import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { LessonTimestamp } from "@/components/editor/lesson-timestamp-extension";
import {
  focusLessonTrack,
  insertLessonTag,
  insertNextTrack,
  insertSongFeedback,
  insertTransitionNote,
  markLessonBlocksHtml,
  nextTrackNumber,
  readLessonStructure,
} from "./lesson-structure";

function createEditor(context: TestContext, content: string) {
  const browserWindow = new Window({ url: "https://portal.test/note" });
  const previous = { window: globalThis.window, document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame };
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
  });
  const element = browserWindow.document.createElement("div");
  browserWindow.document.body.appendChild(element);
  const editor = new Editor({ element: element as unknown as HTMLElement, extensions: [StarterKit, LessonTimestamp], content });
  context.after(() => editor.destroy());
  context.after(() => Object.assign(globalThis, previous));
  return { editor, element };
}

// StarterKit의 TrailingNode가 문서 끝에 빈 문단을 하나 둔다.
/** 커서 자리에 글자를 쳐서 커서가 어디 있는지 HTML로 확인한다. */
function typeHere(editor: Editor, value: string) {
  editor.commands.insertContent(value);
}

test("옛 형식 `▸ 트랙 N` 문단과 새 제목을 함께 트랙으로 읽고 곡 피드백·전환 칸을 센다", (context) => {
  const { editor } = createEditor(
    context,
    [
      "<p>수업 녹음</p>",
      "<p><strong>▸ 트랙 1</strong></p>",
      "<p><strong>▸ 트랙 2</strong></p>",
      "<p>Arp Lead 가 1번 트랙과 잘 안어울리는 느낌</p>",
      "<p><strong>▸ 트랙 5 surface control</strong></p>",
      "<h3>트랙 06 · Kallait [31:20]</h3>",
      "<ul><li><p>비트매칭 반박</p></li><li><p>볼륨</p></li><li><p></p></li></ul>",
      "<blockquote><p>⇄ 전환 06 → 07</p><p>EQ 커브</p></blockquote>",
      "<p></p>",
    ].join(""),
  );
  const structure = readLessonStructure(editor.state.doc);
  assert.deepEqual(
    structure.tracks.map((track) => [track.number, track.title, track.songCount, track.transition?.hasNotes ?? null]),
    [
      [1, "", 0, null],
      [2, "", 1, null],
      [5, "surface control", 0, null],
      [6, "Kallait", 2, true],
    ],
  );
  assert.equal(nextTrackNumber(structure), 7);
  // 같은 문서는 같은 결과(화면 snapshot이 바뀌지 않는다)
  assert.equal(readLessonStructure(editor.state.doc), structure);
});

test("▸ 없는 일반 문단 \"트랙 3번이 좋았다\"는 트랙이 아니다", (context) => {
  const { editor } = createEditor(context, "<p>트랙 3번이 좋았다</p>");
  assert.equal(readLessonStructure(editor.state.doc).tracks.length, 0);
  assert.equal(insertTransitionNote(editor), false, "트랙이 없으면 전환 칸을 만들지 않는다");
});

test("다음 곡으로: 지금 트랙 끝에 전환 칸과 다음 트랙 제목을 넣고 커서는 전환 칸에 둔다", (context) => {
  const { editor } = createEditor(context, "<p>수업 녹음</p><p></p>");

  assert.equal(insertNextTrack(editor), 1);
  typeHere(editor, "첫 곡 메모");
  assert.equal(editor.getHTML(), "<p>수업 녹음</p><h3>트랙 01</h3><p>첫 곡 메모</p><p></p>");

  assert.equal(insertNextTrack(editor, { title: "  one   for ", timestamp: "[03:10]" }), 2);
  typeHere(editor, "루프 exit 준비");
  assert.equal(
    editor.getHTML(),
    "<p>수업 녹음</p><h3>트랙 01</h3><p>첫 곡 메모</p>"
      + "<blockquote><p>⇄ 전환 01 → 02 [03:10]</p><p>루프 exit 준비</p></blockquote>"
      + "<h3>트랙 02 · one for [03:10]</h3><p></p>",
  );
  const tracks = readLessonStructure(editor.state.doc).tracks;
  assert.deepEqual(tracks.map((track) => [track.number, track.title, track.songCount]), [[1, "", 1], [2, "one for", 0]]);
  assert.equal(tracks[0].transition?.hasNotes, true);
});

test("곡 피드백은 전환 칸 앞 목록 끝에, 전환 메모는 전환 칸에 줄을 연다(커서 위치와 무관)", (context) => {
  const { editor } = createEditor(context, "<h3>트랙 01</h3><ul><li><p>킥 늦음</p></li></ul><blockquote><p>⇄ 전환 01 → 02</p><p>커브</p></blockquote>");
  editor.commands.setTextSelection(2); // 트랙 제목 안

  insertSongFeedback(editor);
  typeHere(editor, "베이스 겹침");
  insertTransitionNote(editor);
  typeHere(editor, "프레이즈");
  assert.equal(
    editor.getHTML(),
    "<h3>트랙 01</h3><ul><li><p>킥 늦음</p></li><li><p>베이스 겹침</p></li></ul>"
      + "<blockquote><p>⇄ 전환 01 → 02</p><p>커브</p><p>프레이즈</p></blockquote><p></p>",
  );
});

test("전환 메모는 전환 칸이 없으면 만들고, 그 뒤 다음 곡으로는 제목만 더한다", (context) => {
  const { editor } = createEditor(context, "<h3>트랙 03 · Kallait</h3><p>반박 밀림</p>");
  assert.equal(insertTransitionNote(editor, { timestamp: "[34:48]" }), true);
  typeHere(editor, "잔음");
  insertNextTrack(editor);
  typeHere(editor, " 정리");
  insertSongFeedback(editor);
  typeHere(editor, "새 곡 피드백");
  assert.equal(
    editor.getHTML(),
    "<h3>트랙 03 · Kallait</h3><p>반박 밀림</p>"
      + "<blockquote><p>⇄ 전환 03 → 04 [34:48]</p><p>잔음</p><p> 정리</p></blockquote>"
      + "<h3>트랙 04</h3><ul><li><p>새 곡 피드백</p></li></ul><p></p>",
  );
});

test("빠른 태그는 초점이 없으면 새 곡 피드백 줄 앞에 굵은 라벨로 붙고, 세트 목록은 트랙 제목으로 이동한다", (context) => {
  const { editor } = createEditor(context, "<h3>트랙 01</h3><ul><li><p>킥 늦음</p></li></ul><h3>트랙 02</h3>");
  insertLessonTag(editor, "비트매칭");
  typeHere(editor, "반박");
  assert.equal(
    editor.getHTML(),
    "<h3>트랙 01</h3><ul><li><p>킥 늦음</p></li></ul><h3>트랙 02</h3><ul><li><p><strong>비트매칭</strong> 반박</p></li></ul><p></p>",
  );
  focusLessonTrack(editor, 1);
  typeHere(editor, " · intro");
  assert.equal(readLessonStructure(editor.state.doc).tracks[0].title, "intro");
});

test("읽기 화면 HTML에도 트랙 제목·전환 칸 class를 붙인다", () => {
  assert.equal(
    markLessonBlocksHtml('<h3 data-indent="1">트랙 01 · intro</h3><p><strong>▸ 트랙 2</strong></p><p>트랙 3번 좋음</p><blockquote><p>⇄ 전환 01 → 02</p></blockquote><blockquote><p>인용</p></blockquote>'),
    '<h3 class="lesson-track" data-indent="1">트랙 01 · intro</h3><p class="lesson-track"><strong>▸ 트랙 2</strong></p><p>트랙 3번 좋음</p><blockquote class="lesson-transition"><p>⇄ 전환 01 → 02</p></blockquote><blockquote><p>인용</p></blockquote>',
  );
});
