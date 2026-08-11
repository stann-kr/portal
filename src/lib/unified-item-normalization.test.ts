import assert from "node:assert/strict";
import test from "node:test";
import {
  getUnifiedItemSpaceLabel,
  normalizeUnifiedItems,
  type UnifiedItemNormalizationInput,
} from "./unified-item-normalization";
import { getUnifiedItemKey } from "./utils/unifiedItemUtils";

function createInput(): UnifiedItemNormalizationInput {
  return {
    profile: { id: "student-1", displayName: "  Mina  ", email: "mina@example.com" },
    events: [{
      id: "shared-id",
      eventType: "PRACTICE",
      title: "연습",
      startTime: new Date("2026-08-10T10:00:00.000Z"),
      endTime: null,
      description: null,
    }],
    lessons: [{ id: "shared-id", scheduledAt: new Date("2026-08-10T10:00:00.000Z") }],
    notes: [{
      id: "note-1",
      title: "레슨 노트",
      contentHtml: "<p>내용</p>",
      authorId: "admin-1",
      noteDate: new Date("2026-08-09T10:00:00.000Z"),
      createdAt: new Date("2026-08-09T09:00:00.000Z"),
    }],
    tracks: [{
      id: "track-1",
      linkUrl: "https://example.com/track",
      values: "{not-json",
      createdAt: new Date("2026-08-08T10:00:00.000Z"),
    }],
    columns: [
      { id: "track-name", name: "Track Name" },
      { id: "artist", name: "Artist" },
    ],
    threads: [{
      id: "qna-1",
      title: "질문",
      status: "ANSWERED",
      createdAt: new Date("2026-08-07T10:00:00.000Z"),
    }],
    assignments: [{
      id: "assignment-1",
      mediaUrl: "https://example.com/media",
      submittedAt: new Date("2026-08-06T10:00:00.000Z"),
    }],
    feedbackCounts: { "assignment-1": 2 },
  };
}

test("모든 통합 유형에 학생 스페이스와 포털 출처를 제공한다", () => {
  const items = normalizeUnifiedItems(createInput());

  assert.equal(items.length, 6);
  assert.deepEqual(items.map((item) => item.source.entity), [
    "CALENDAR_EVENT",
    "LESSON",
    "PRIVATE_NOTE",
    "DIGGING_TRACK",
    "QNA_THREAD",
    "ASSIGNMENT",
  ]);
  for (const item of items) {
    assert.deepEqual(item.space, { studentId: "student-1", label: "Mina" });
    assert.deepEqual(item.source.kind, "PORTAL");
    assert.equal(item.source.label, "포털");
  }
});

test("레슨은 EVENT/LESSON으로 정규화하고 동일 시각의 calendar event를 유지한다", () => {
  const items = normalizeUnifiedItems(createInput());
  const events = items.filter((item) => item.id === "shared-id");

  assert.equal(events.length, 2);
  assert.deepEqual(events.map((item) => [item.type, item.subType, item.title]), [
    ["EVENT", "PRACTICE", "연습"],
    ["EVENT", "LESSON", "레슨"],
  ]);
  assert.notEqual(getUnifiedItemKey(events[0]), getUnifiedItemKey(events[1]));
});

test("표시명은 trim한 값을 우선하고 없으면 email을 사용한다", () => {
  assert.equal(getUnifiedItemSpaceLabel({ displayName: "  Mina  ", email: "mina@example.com" }), "Mina");
  assert.equal(getUnifiedItemSpaceLabel({ displayName: "   ", email: "mina@example.com" }), "mina@example.com");
});

test("손상된 디깅 JSON은 안전한 fallback 제목과 빈 값을 사용한다", () => {
  const items = normalizeUnifiedItems(createInput());
  const track = items.find((item) => item.source.entity === "DIGGING_TRACK");

  assert.ok(track);
  assert.equal(track.title, "https://example.com/track");
  assert.deepEqual(track.metadata.values, {});
});
