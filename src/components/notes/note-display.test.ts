import assert from "node:assert/strict";
import test from "node:test";
import {
  formatListUpdatedLabel,
  formatNoteLongDate,
  formatNoteUpdated,
  formatRecordTime,
  formatTrashDeadline,
  formatTrashTime,
  toLedgerDateLabel,
} from "./note-display";

// 2026-10-26 18:40 KST
const NOW = Date.UTC(2026, 9, 26, 9, 40);

test("목록 날짜는 서버 label을 Mono 날짜로 바꾸고 같은 해는 좁은 화면에서 월·일만 남긴다", () => {
  assert.equal(toLedgerDateLabel("2026년 10월 5일"), "2026.10.05");
  assert.equal(toLedgerDateLabel("2026년 10월 5일", { now: NOW, omitSameYear: true }), "10.05");
  assert.equal(toLedgerDateLabel("2025년 3월 2일", { now: NOW, omitSameYear: true }), "2025.03.02");
  assert.equal(toLedgerDateLabel("날짜 없음", { now: NOW, omitSameYear: true }), "날짜 없음");
});

test("수정 시각은 하루 안이면 상대 시각, 그보다 오래되면 짧은 날짜로 보인다", () => {
  const row = (minutesAgo: number, label: string) => ({ updatedValue: NOW - minutesAgo * 60_000, updatedLabel: label });
  assert.equal(formatListUpdatedLabel(row(0, "2026년 10월 26일 오후 6:40"), NOW), "방금 전");
  assert.equal(formatListUpdatedLabel(row(12, "2026년 10월 26일 오후 6:28"), NOW), "12분 전");
  assert.equal(formatListUpdatedLabel(row(120, "2026년 10월 26일 오후 4:40"), NOW), "2시간 전");
  assert.equal(formatListUpdatedLabel(row(4 * 24 * 60, "2026년 10월 22일 오후 6:40"), NOW), "10월 22일");
  assert.equal(formatListUpdatedLabel(row(400 * 24 * 60, "2025년 9월 21일 오후 6:40"), NOW), "2025년 9월 21일");
  assert.equal(formatListUpdatedLabel(row(5, "2026년 10월 26일 오후 6:35")), "2026년 10월 26일", "기준 시각이 없으면 상대 시각을 만들지 않는다");
  assert.equal(formatListUpdatedLabel({ updatedValue: null, updatedLabel: "—" }, NOW), "—");
  assert.equal(formatNoteUpdated(new Date(NOW - 3 * 60 * 60_000), NOW), "3시간 전");
  assert.equal(formatNoteUpdated(null, NOW), "—");
});

test("문서 날짜·이력·휴지통 시각은 KST로 표시하고 다른 해에는 연도를 붙인다", () => {
  assert.equal(formatNoteLongDate(new Date(NOW)), "2026년 10월 26일 (월)");
  assert.equal(formatNoteLongDate(null), "날짜 없음");
  assert.equal(formatRecordTime(new Date(NOW), NOW), "10.26 18:40");
  assert.equal(formatRecordTime(Date.UTC(2025, 0, 2, 0, 5), NOW), "2025.01.02 09:05");
  assert.equal(formatTrashTime(Date.UTC(2026, 9, 25, 12, 14), NOW), "10월 25일 21:14");
  assert.equal(formatTrashDeadline(Date.UTC(2026, 10, 24, 12, 14), NOW), "11월 24일");
});
