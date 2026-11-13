import assert from "node:assert/strict";
import test from "node:test";
import { fillEmptyFromLinkMeta, numberCellValue } from "./inline-add-values";

const columns = [
  { id: "title", name: "트랙명" },
  { id: "artist", name: "아티스트" },
  { id: "memo", name: "감상평" },
];

test("링크 정보는 비어 있는 트랙명·아티스트만 채우고, 기다리는 동안 입력한 글자는 덮지 않는다", () => {
  const meta = { title: "Rej", artist: "Âme" };
  assert.deepEqual(fillEmptyFromLinkMeta({}, columns, meta), { title: "Rej", artist: "Âme" });
  // 응답을 기다리는 동안 트랙명을 직접 입력한 경우
  const typed = { title: "내가 적은 제목", memo: "좋다" };
  assert.deepEqual(fillEmptyFromLinkMeta(typed, columns, meta), { title: "내가 적은 제목", memo: "좋다", artist: "Âme" });
  const full = { title: "a", artist: "b" };
  assert.equal(fillEmptyFromLinkMeta(full, columns, meta), full, "바뀐 것이 없으면 같은 객체");
  assert.deepEqual(fillEmptyFromLinkMeta({}, [{ id: "memo", name: "감상평" }], meta), {}, "기본 열이 없으면 채우지 않는다");
  assert.deepEqual(fillEmptyFromLinkMeta({}, columns, { title: null, artist: "" }), {});
});

test("지운 숫자 칸은 0이 아니라 빈 값이다", () => {
  assert.equal(numberCellValue(""), "");
  assert.equal(numberCellValue("  "), "");
  assert.equal(numberCellValue("0"), 0);
  assert.equal(numberCellValue("128"), 128);
  assert.equal(numberCellValue("-3.5"), -3.5);
});
