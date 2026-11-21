import { NodeSelection, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";

/**
 * 방금 넣은 블록(이미지·영상)이 선택된 채면 커서를 그 뒤 글 자리로 옮긴다. 선택된 채로 두면 이어서 친 글자가 그 블록을
 * 지운다. 블록이 문서의 마지막이면 뒤에 글을 이어 쓸 빈 문단을 만든다. `chain().command(({ tr }) => …)`에 넣어 쓴다.
 */
export function moveCursorAfterInsertedNode(tr: Transaction): boolean {
  if (!(tr.selection instanceof NodeSelection)) return true;
  const after = tr.selection.to;
  const next = Selection.findFrom(tr.doc.resolve(after), 1, true);
  if (next) {
    tr.setSelection(next);
    return true;
  }
  const $after = tr.doc.resolve(after);
  const paragraph = tr.doc.type.schema.nodes.paragraph;
  if (paragraph && $after.parent.canReplaceWith($after.index(), $after.index(), paragraph)) {
    tr.insert(after, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
  }
  return true;
}
