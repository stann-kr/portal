import assert from "node:assert/strict";
import test from "node:test";
import {
  createCalendarEventUnifiedItem,
  createDiggingTrackUnifiedItem,
  describeAssignmentMedia,
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
    "CALENDAR_EVENT", "LESSON", "PRIVATE_NOTE", "DIGGING_TRACK", "QNA_THREAD", "ASSIGNMENT",
  ]);
  for (const item of items) {
    assert.deepEqual(item.space, { studentId: "student-1", label: "Mina" });
    assert.deepEqual(item.source.kind, "PORTAL");
    assert.equal(item.source.label, "포털");
  }
});

test("과제 항목 제목은 원본 URL 대신 제출 플랫폼을 표시한다", () => {
  const assignment = normalizeUnifiedItems(createInput()).find((item) => item.type === "ASSIGNMENT");
  assert.equal(assignment?.title, "제출한 믹스셋");
  assert.equal(assignment?.metadata.mediaUrl, "https://example.com/media");
  assert.equal(describeAssignmentMedia("https://m.youtube.com/watch?v=abc"), "YouTube 믹스셋");
  assert.equal(describeAssignmentMedia("https://youtu.be/abc"), "YouTube 믹스셋");
  assert.equal(describeAssignmentMedia("https://soundcloud.com/dj/mix"), "SoundCloud 믹스셋");
  assert.equal(describeAssignmentMedia("https://youtube.com.evil.test/watch"), "제출한 믹스셋");
});

test("레슨은 EVENT/LESSON으로 정규화하고 동일 시각의 calendar event를 유지한다", () => {
  const events = normalizeUnifiedItems(createInput()).filter((item) => item.id === "shared-id");
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((item) => [item.type, item.subType, item.title]), [
    ["EVENT", "PRACTICE", "연습"],
    ["EVENT", "LESSON", "레슨"],
  ]);
  assert.notEqual(getUnifiedItemKey(events[0]!), getUnifiedItemKey(events[1]!));
});

test("표시명은 trim한 값을 우선하고 없으면 email을 사용한다", () => {
  assert.equal(getUnifiedItemSpaceLabel({ displayName: "  Mina  ", email: "mina@example.com" }), "Mina");
  assert.equal(getUnifiedItemSpaceLabel({ displayName: "   ", email: "mina@example.com" }), "mina@example.com");
});

test("손상된 디깅 JSON은 안전한 fallback 제목과 빈 값을 사용한다", () => {
  const track = normalizeUnifiedItems(createInput()).find((item) => item.source.entity === "DIGGING_TRACK");
  assert.ok(track);
  assert.equal(track.title, "https://example.com/track");
  assert.deepEqual(track.metadata.values, {});
});

const profile = { id: "student-1", email: "student@example.test", displayName: "학생" };

test("일정 생성 응답은 기존 통합 일정과 같은 source 계약을 사용한다", () => {
  const item = createCalendarEventUnifiedItem({
    id: "event-1",
    eventType: "PRACTICE",
    title: "연습",
    startTime: new Date("2026-08-12T15:30:00.000Z"),
    endTime: null,
    description: null,
  }, profile);
  assert.equal(item.source.entity, "CALENDAR_EVENT");
  assert.equal(item.date.toISOString(), "2026-08-12T15:30:00.000Z");
});

test("기본 한국어 digging 컬럼으로 생성 직후 제목을 만든다", () => {
  const item = createDiggingTrackUnifiedItem({
    id: "track-1",
    linkUrl: null,
    values: { title: "Track", artist: "Artist" },
    createdAt: new Date("2026-08-13T01:00:00.000Z"),
  }, [
    { id: "title", name: "트랙명" },
    { id: "artist", name: "아티스트" },
  ], profile);
  assert.equal(item.title, "Track — Artist");
  assert.equal(item.source.entity, "DIGGING_TRACK");
});
