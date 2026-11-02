import * as Y from "yjs";

/**
 * "저장한 내용과 room이 같은가"를 비교하는 값. state vector만으로는 삭제(새 clock 없이 지운 글자)를 구분하지 못하므로
 * delete set까지 담긴 Yjs snapshot을 쓴다. 클라이언트가 저장 뒤 보고하고 room이 자기 상태와 비교한다.
 */
export function collabSavedMarker(doc: Y.Doc): Uint8Array {
  return Y.encodeSnapshot(Y.snapshot(doc));
}
