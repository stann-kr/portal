"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/core";
import { lessonTargetEditor } from "./lesson-insert";
import { EMPTY_LESSON_STRUCTURE, readLessonStructure, type LessonStructure } from "./lesson-structure";

/** 노트 편집기는 패널보다 늦게(공동 편집 연결 뒤) 생기거나 바뀌므로 DOM 변화로 다시 찾는다. */
function subscribeNoteEditor(onChange: () => void): () => void {
  let frame = 0;
  const observer = new MutationObserver(() => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      onChange();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["contenteditable"] });
  return () => {
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
  };
}

const readNoteEditor = () => lessonTargetEditor(document, "note");
const readNoEditor = () => null;

/** 화면의 노트 편집기(수업 도구가 세트 구조를 넣을 곳). 아직 없거나 읽기 전용이면 null. */
export function useLessonNoteEditor(): Editor | null {
  return useSyncExternalStore(subscribeNoteEditor, readNoteEditor, readNoEditor);
}

/** 노트 본문의 세트 구조. 공동 편집으로 들어온 변경도 transaction으로 따라간다(같은 문서는 같은 값). */
export function useLessonNoteStructure(editor: Editor | null): LessonStructure {
  const subscribe = useCallback((onChange: () => void) => {
    if (!editor) return () => {};
    editor.on("transaction", onChange);
    return () => {
      editor.off("transaction", onChange);
    };
  }, [editor]);
  const read = useCallback(
    () => (editor && !editor.isDestroyed ? readLessonStructure(editor.state.doc) : EMPTY_LESSON_STRUCTURE),
    [editor],
  );
  return useSyncExternalStore(subscribe, read, () => EMPTY_LESSON_STRUCTURE);
}
