/**
 * 본문의 시점 표시(`[12:34]`)와 수업 세트 구조(트랙 제목 `lesson-track`·전환 칸 `lesson-transition`)를 꾸미는 decoration. 문서 schema·저장 HTML은 그대로 두고,
 * 화면에서만 `data-lesson-seconds`를 붙여 녹음 재생(RecordingDock)이 눌린 시점을 읽게 한다.
 */
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { LESSON_TIMESTAMP_PATTERN, parseLessonTimestamp } from "@/components/lesson/lesson-timestamps";
import { isTransitionBlock, readTrackHeading } from "@/components/lesson/lesson-structure";

const lessonTimestampKey = new PluginKey<DecorationSet>("lessonTimestamp");

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  // 수업 세트 구조: 트랙 제목과 전환 칸을 꾸민다(맨 위 블록만).
  doc.forEach((node, offset) => {
    const kind = readTrackHeading(node) ? "lesson-track" : isTransitionBlock(node) ? "lesson-transition" : null;
    if (kind) decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: kind }));
  });
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(LESSON_TIMESTAMP_PATTERN)) {
      const from = position + (match.index ?? 0);
      decorations.push(
        Decoration.inline(from, from + match[0].length, {
          class: "lesson-timestamp",
          "data-lesson-seconds": String(parseLessonTimestamp(match)),
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const LessonTimestamp = Extension.create({
  name: "lessonTimestamp",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: lessonTimestampKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc),
          apply: (transaction, previous) =>
            transaction.docChanged ? buildDecorations(transaction.doc) : previous,
        },
        props: {
          decorations: (state) => lessonTimestampKey.getState(state),
        },
      }),
    ];
  },
});
