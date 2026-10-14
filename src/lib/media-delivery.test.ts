import assert from "node:assert/strict";
import test from "node:test";
import {
  INVALID_MEDIA_BYTE_RANGE,
  canAccessMediaDelivery,
  parseMediaByteRange,
} from "./media-delivery";

const attachedQna = {
  ownerId: "admin-1",
  purpose: "QNA_ATTACHMENT" as const,
  state: "ATTACHED" as const,
  resourceType: "QNA_REPLY" as const,
};

test("media byte range를 single bounded range로 정규화한다", () => {
  assert.equal(parseMediaByteRange(null, 1_000), null);
  assert.deepEqual(parseMediaByteRange("bytes=100-199", 1_000), {
    offset: 100,
    length: 100,
  });
  assert.deepEqual(parseMediaByteRange("bytes=900-", 1_000), {
    offset: 900,
    length: 100,
  });
  assert.deepEqual(parseMediaByteRange("bytes=-250", 1_000), {
    offset: 750,
    length: 250,
  });
  assert.deepEqual(parseMediaByteRange("bytes=900-2000", 1_000), {
    offset: 900,
    length: 100,
  });
});

test("multi-range와 범위 밖 요청을 거부한다", () => {
  for (const header of [
    "bytes=0-1,5-6",
    "bytes=1000-",
    "bytes=200-100",
    "items=0-1",
    "bytes=-0",
  ]) {
    assert.equal(parseMediaByteRange(header, 1_000), INVALID_MEDIA_BYTE_RANGE);
  }
});

test("Q&A attachment는 thread 학생과 관리자만 읽을 수 있다", () => {
  const resource = { kind: "QNA_REPLY" as const, studentId: "student-1" };
  assert.equal(
    canAccessMediaDelivery({ id: "student-1", role: "student" }, attachedQna, resource),
    true,
  );
  assert.equal(
    canAccessMediaDelivery({ id: "admin-2", role: "admin" }, attachedQna, resource),
    true,
  );
  assert.equal(
    canAccessMediaDelivery({ id: "student-2", role: "student" }, attachedQna, resource),
    false,
  );
});

test("READY preview와 trashed community media의 audience를 제한한다", () => {
  assert.equal(
    canAccessMediaDelivery(
      { id: "owner", role: "student" },
      { ...attachedQna, ownerId: "owner", state: "SEALING", resourceType: null },
      null,
    ),
    false,
  );
  assert.equal(
    canAccessMediaDelivery(
      { id: "owner", role: "student" },
      { ...attachedQna, ownerId: "owner", state: "READY", resourceType: null },
      null,
    ),
    true,
  );
  assert.equal(
    canAccessMediaDelivery(
      { id: "other", role: "admin" },
      { ...attachedQna, ownerId: "owner", state: "READY", resourceType: null },
      null,
    ),
    false,
  );
  const community = {
    ownerId: "owner",
    purpose: "COMMUNITY_POST_AUDIO" as const,
    state: "ATTACHED" as const,
    resourceType: "COMMUNITY_POST" as const,
  };
  const trashed = {
    kind: "COMMUNITY_POST" as const,
    authorId: "owner",
    deleted: true,
  };
  assert.equal(
    canAccessMediaDelivery({ id: "other", role: "student" }, community, trashed),
    false,
  );
  assert.equal(
    canAccessMediaDelivery({ id: "owner", role: "student" }, community, trashed),
    true,
  );
});
