import { NodeSelection, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";

/**
 * 방금 넣은 블록(이미지·영상)이 선택된 채면 커서를 그 바로 뒤 글 자리로 옮긴다. 선택된 채로 두면 이어서 친 글자가 그 블록을
 * 지운다. 바로 뒤가 글 블록이면 그 맨 앞에 두고, 표·목록·다른 이미지이거나 아무것도 없으면 그 자리에 빈 문단을 만든다.
 * 가장 가까운 글 자리를 찾아가지 않는 것은 표의 첫 칸이나 여러 블록 뒤의 문단처럼 넣은 자리에서 먼 곳으로 커서가
 * 건너뛰기 때문이다. `chain().command(({ tr }) => …)`에 넣어 쓴다.
 */
export function moveCursorAfterInsertedNode(tr: Transaction): boolean {
  if (!(tr.selection instanceof NodeSelection)) return true;
  const after = tr.selection.to;
  const $after = tr.doc.resolve(after);
  if ($after.nodeAfter?.isTextblock) {
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    return true;
  }
  const paragraph = tr.doc.type.schema.nodes.paragraph;
  if (paragraph && $after.parent.canReplaceWith($after.index(), $after.index(), paragraph)) {
    tr.insert(after, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    return true;
  }
  // 문단을 둘 수 없는 자리에서만 가장 가까운 다음 글 자리로 옮긴다.
  const next = Selection.findFrom($after, 1, true);
  if (next) tr.setSelection(next);
  return true;
}
