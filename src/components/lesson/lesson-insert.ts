/**
 * @file src/components/lesson/lesson-insert.ts
 * @description 수업 도구가 시점·트랙 줄을 넣을 편집기를 고르고 넣는다. 편집기 DOM은 Tiptap이 `editor`를 붙여 두므로
 * 별도 ref 연결 없이 마지막으로 초점을 둔 편집기(노트 또는 메모)를 쓴다.
 */
import type { Editor } from "@tiptap/core";

type EditorElement = HTMLElement & { editor?: Editor };

/** 수업 도구가 넣을 수 있는 영역. 바깥 요소에 `data-lesson-target`을 붙인다. */
export type LessonInsertTarget = "note" | "memo";

export function lessonTargetEditor(root: ParentNode, target: LessonInsertTarget): Editor | null {
  const element = root.querySelector<EditorElement>(`[data-lesson-target="${target}"] .ProseMirror`);
  const editor = element?.editor ?? null;
  return editor && !editor.isDestroyed && editor.isEditable ? editor : null;
}

export function lessonTargetOf(element: Element | null): LessonInsertTarget | null {
  const value = element?.closest<HTMLElement>("[data-lesson-target]")?.dataset.lessonTarget;
  return value === "note" || value === "memo" ? value : null;
}

/**
 * 커서가 있는 줄 다음에 새 줄을 열어 글자를 넣는다. 빈 줄이면 그 줄을 바꾼다.
 * `bold`(트랙 구분)는 굵게 한 줄을 쓰고 빈 다음 줄로 내려가며, 아니면(시점) 같은 줄에 이어 쓸 수 있게 공백을 둔다.
 */
export function insertLessonLine(editor: Editor, text: string, { bold = false }: { bold?: boolean } = {}): void {
  const { $from } = editor.state.selection;
  const inBlock = $from.depth > 0 && $from.parent.isTextblock;
  const emptyBlock = inBlock && $from.parent.content.size === 0;
  const from = !inBlock ? editor.state.doc.content.size : emptyBlock ? $from.before() : $from.after();
  const to = emptyBlock ? $from.after() : from;
  const lines = bold
    ? [{ type: "paragraph", content: [{ type: "text", text, marks: [{ type: "bold" }] }] }, { type: "paragraph" }]
    : [{ type: "paragraph", content: [{ type: "text", text: `${text} ` }] }];
  editor.chain().focus().insertContentAt({ from, to }, lines, { updateSelection: true }).run();
}
