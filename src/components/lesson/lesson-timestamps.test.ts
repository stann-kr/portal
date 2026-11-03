import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { LessonTimestamp } from "@/components/editor/lesson-timestamp-extension";
import { insertLessonLine } from "./lesson-insert";
import {
  LESSON_TIMESTAMP_PATTERN,
  findLessonRecording,
  formatLessonClock,
  lessonTimestampText,
  parseLessonRecording,
  parseLessonTimestamp,
} from "./lesson-timestamps";

test("시점 표시는 분:초와 시:분:초를 읽고 같은 모양으로 쓴다", () => {
  const seconds = [..."[0:05] [12:34] [1:02:03] [12:60] [x:10]".matchAll(LESSON_TIMESTAMP_PATTERN)].map(parseLessonTimestamp);
  assert.deepEqual(seconds, [5, 754, 3723]);
  assert.equal(lessonTimestampText(754), "[12:34]");
  assert.equal(formatLessonClock(3723), "1:02:03");
  assert.equal(formatLessonClock(-3), "00:00");
});

test("YouTube·SoundCloud 링크를 녹음으로 읽고 시작 위치를 믹스 시작으로 더한다", () => {
  assert.deepEqual(parseLessonRecording("https://youtu.be/abcdefghijk?t=95"), {
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    offsetSeconds: 95,
  });
  assert.deepEqual(parseLessonRecording("https://www.youtube.com/watch?v=abcdefghijk&t=1m35s"), {
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    offsetSeconds: 95,
  });
  assert.equal(parseLessonRecording("https://www.youtube-nocookie.com/embed/abcdefghijk?start=10")?.offsetSeconds, 10);
  assert.deepEqual(parseLessonRecording("https://soundcloud.com/stann/lesson-1#t=2:05"), {
    url: "https://soundcloud.com/stann/lesson-1",
    offsetSeconds: 125,
  });
  assert.equal(parseLessonRecording("https://soundcloud.com/stann"), null);
  assert.equal(parseLessonRecording("https://example.com/watch?v=abcdefghijk"), null);
  assert.equal(parseLessonRecording("javascript:alert(1)"), null);
});

test("본문에서 첫 녹음 링크를 고른다", () => {
  const browserWindow = new Window({ url: "https://portal.test/note" });
  const root = browserWindow.document.createElement("div");
  root.innerHTML = '<p><a href="https://example.com">참고</a></p><p><a href="https://soundcloud.com/a/b">녹음</a></p><div data-youtube-video><iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk"></iframe></div>';
  assert.equal(findLessonRecording(root as unknown as ParentNode)?.url, "https://soundcloud.com/a/b");
});

test("편집기는 시점 글자를 눌러 재생할 수 있게 꾸미고, 수업 도구는 줄 단위로 시점·트랙을 넣는다", (context) => {
  const browserWindow = new Window({ url: "https://portal.test/note" });
  const previous = { window: globalThis.window, document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame };
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
  });
  const element = browserWindow.document.createElement("div");
  const editor = new Editor({
    element: element as unknown as HTMLElement,
    extensions: [StarterKit, LessonTimestamp],
    content: "<p>인트로 [01:05] 좋음</p>",
  });
  context.after(() => editor.destroy());
  context.after(() => Object.assign(globalThis, previous));

  const marked = () => [...element.querySelectorAll("[data-lesson-seconds]")].map((node) => [node.textContent, node.getAttribute("data-lesson-seconds")]);
  assert.deepEqual(marked(), [["[01:05]", "65"]]);
  // 저장 HTML에는 꾸밈이 남지 않는다.
  assert.equal(editor.getHTML(), "<p>인트로 [01:05] 좋음</p>");

  editor.commands.setTextSelection(3);
  insertLessonLine(editor, "▸ 트랙 2", { bold: true });
  insertLessonLine(editor, "[02:10]");
  editor.commands.insertContent("전환 빠름");
  assert.equal(
    editor.getHTML(),
    "<p>인트로 [01:05] 좋음</p><p><strong>▸ 트랙 2</strong></p><p>[02:10] 전환 빠름</p>",
  );
  assert.deepEqual(marked(), [["[01:05]", "65"], ["[02:10]", "130"]]);
});
