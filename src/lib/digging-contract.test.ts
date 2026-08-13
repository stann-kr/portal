import assert from "node:assert/strict";
import test from "node:test";
import {
  DIGGING_TEXTAREA_MAX_LENGTH,
  parseDiggingColumnInput,
  parseDiggingColumnValue,
  parseDiggingTrackInput,
  type DiggingColumnContract,
} from "./digging-contract";

const columns: DiggingColumnContract[] = [
  { id: "title", userId: "student-1", columnType: "text", options: null },
  {
    id: "mood",
    userId: "student-1",
    columnType: "select",
    options: JSON.stringify(["좋음", "보통"]),
  },
  { id: "rating", userId: "student-1", columnType: "rating", options: null },
  { id: "key", userId: "student-1", columnType: "camelot_key", options: null },
];

test("digging 컬럼 정의는 허용 type과 bounded select option만 받는다", () => {
  assert.deepEqual(
    parseDiggingColumnInput({
      name: "  무드 ",
      columnType: "select",
      options: ["좋음", "보통"],
    }),
    {
      ok: true,
      value: { name: "무드", columnType: "select", options: ["좋음", "보통"] },
    },
  );
  assert.equal(
    parseDiggingColumnInput({ name: "x", columnType: "rogue" }).ok,
    false,
  );
  assert.equal(
    parseDiggingColumnInput({ name: "x", columnType: "select", options: ["중복", "중복"] }).ok,
    false,
  );
});

test("column type별 값과 option ownership을 검증한다", () => {
  assert.equal(parseDiggingColumnValue(columns[1], "좋음").ok, true);
  assert.equal(parseDiggingColumnValue(columns[1], "관리자 임의값").ok, false);
  assert.equal(parseDiggingColumnValue(columns[2], 5).ok, true);
  assert.equal(parseDiggingColumnValue(columns[2], 6).ok, false);
  assert.equal(parseDiggingColumnValue(columns[3], "12B").ok, true);
  assert.equal(parseDiggingColumnValue(columns[3], "13A").ok, false);
  assert.equal(
    parseDiggingColumnValue(
      { id: "memo", userId: "student-1", columnType: "textarea", options: null },
      "x".repeat(DIGGING_TEXTAREA_MAX_LENGTH + 1),
    ).ok,
    false,
  );
});

test("track payload는 소유 컬럼만 받고 링크 protocol과 JSON 크기를 제한한다", () => {
  const valid = parseDiggingTrackInput(
    {
      linkUrl: "https://open.spotify.com/track/example",
      values: { title: "Track", mood: "좋음", rating: 4, key: "8A" },
    },
    columns,
  );
  assert.equal(valid.ok, true);

  assert.equal(
    parseDiggingTrackInput({ values: { rogue: "value" } }, columns).ok,
    false,
  );
  assert.equal(
    parseDiggingTrackInput(
      { linkUrl: "http://127.0.0.1/private", values: {} },
      columns,
    ).ok,
    false,
  );
});
