import assert from "node:assert/strict";
import test from "node:test";
import {
  createPostRequestHashForVersion,
  createPostSnapshotHashForVersion,
  type PostCanonicalRequest,
  type PostCanonicalSnapshot,
} from "./post-continuity";
import {
  createQnaRequestHashForVersion,
  type QnaCanonicalRequest,
} from "./qna-continuity";

const POST_MEDIA_OBJECT_ID = "11111111-1111-4111-8111-111111111111";
const ALTERNATE_POST_MEDIA_OBJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const QNA_MEDIA_OBJECT_ID = "22222222-2222-4222-8222-222222222222";
const ALTERNATE_QNA_MEDIA_OBJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const postSnapshotFixture: PostCanonicalSnapshot = {
  category: "리뷰",
  boardType: "FEEDBACK",
  isPinned: true,
  mediaUrl: "https://cdn.example.com/legacy/audio.mp3",
  mediaObjectId: POST_MEDIA_OBJECT_ID,
  title: "여름 믹스",
  contentHtml: "<p>킥 &amp; 베이스</p>",
  deletedAt: new Date("2026-08-09T09:10:11.987Z"),
};

const postRequestFixture: PostCanonicalRequest = {
  operationType: "UPDATE",
  resourceId: "post-fixture-01",
  subjectId: "student-fixture-01",
  baseRevision: 7,
  snapshot: postSnapshotFixture,
};

const qnaRequestFixture: QnaCanonicalRequest = {
  operationType: "APPEND_REPLY",
  resourceId: "thread-fixture-01",
  subjectId: "student-fixture-01",
  baseRevision: 4,
  replyId: "reply-fixture-02",
  replyAuthorId: "admin-fixture-01",
  contentHtml: "<p>파형을 다시 확인해 주세요.</p>",
  attachmentUrl: "https://cdn.example.com/legacy/waveform.png",
  attachmentObjectId: QNA_MEDIA_OBJECT_ID,
};

test("게시물 request hash v1 호환성을 보존하고 v2부터 media object ID를 반영한다", () => {
  const alternateRequest: PostCanonicalRequest = {
    ...postRequestFixture,
    snapshot: {
      ...postSnapshotFixture,
      mediaObjectId: ALTERNATE_POST_MEDIA_OBJECT_ID,
    },
  };

  assert.equal(
    createPostRequestHashForVersion(postRequestFixture, 1),
    "ef1853dfb2d6446ed947aae5b2c7c49689249df32c35d7a61e602ca4b1f56b65",
  );
  assert.equal(
    createPostRequestHashForVersion(postRequestFixture, 1),
    createPostRequestHashForVersion(alternateRequest, 1),
  );
  assert.notEqual(
    createPostRequestHashForVersion(postRequestFixture, 2),
    createPostRequestHashForVersion(alternateRequest, 2),
  );
  assert.equal(
    createPostRequestHashForVersion(postRequestFixture, 2),
    createPostRequestHashForVersion(
      {
        ...postRequestFixture,
        snapshot: {
          ...postSnapshotFixture,
          mediaUrl: "https://changed.example.com/audio.mp3",
        },
      },
      2,
    ),
  );
  assert.equal(createPostRequestHashForVersion(postRequestFixture, 999), null);
});

test("게시물 snapshot hash v1 호환성을 보존하고 v2부터 media object ID를 반영한다", () => {
  const alternateSnapshot: PostCanonicalSnapshot = {
    ...postSnapshotFixture,
    mediaObjectId: ALTERNATE_POST_MEDIA_OBJECT_ID,
  };

  assert.equal(
    createPostSnapshotHashForVersion(postSnapshotFixture, 1),
    "d7e7dbfabbfbb08044653ed7e1c4fb8b13d74d9e23bd16c0943e01e1cfe3e2b5",
  );
  assert.equal(
    createPostSnapshotHashForVersion(postSnapshotFixture, 1),
    createPostSnapshotHashForVersion(alternateSnapshot, 1),
  );
  assert.notEqual(
    createPostSnapshotHashForVersion(postSnapshotFixture, 2),
    createPostSnapshotHashForVersion(alternateSnapshot, 2),
  );
  assert.equal(
    createPostSnapshotHashForVersion(postSnapshotFixture, 2),
    createPostSnapshotHashForVersion(
      { ...postSnapshotFixture, mediaUrl: "https://changed.example.com/audio.mp3" },
      2,
    ),
  );
  assert.equal(createPostSnapshotHashForVersion(postSnapshotFixture, 999), null);
});

test("Q&A request hash v1 호환성을 보존하고 v2부터 media object ID를 반영한다", () => {
  const alternateRequest: QnaCanonicalRequest = {
    ...qnaRequestFixture,
    attachmentObjectId: ALTERNATE_QNA_MEDIA_OBJECT_ID,
  };

  assert.equal(
    createQnaRequestHashForVersion(qnaRequestFixture, 1),
    "b1bafe7ded5628c6f4f3bb40d96bf6c52d98fe323b4d18ff0ffeeb299a407b4d",
  );
  assert.equal(
    createQnaRequestHashForVersion(qnaRequestFixture, 1),
    createQnaRequestHashForVersion(alternateRequest, 1),
  );
  assert.notEqual(
    createQnaRequestHashForVersion(qnaRequestFixture, 2),
    createQnaRequestHashForVersion(alternateRequest, 2),
  );
  assert.equal(
    createQnaRequestHashForVersion(qnaRequestFixture, 2),
    createQnaRequestHashForVersion(
      {
        ...qnaRequestFixture,
        attachmentUrl: "https://changed.example.com/attachment.png",
      },
      2,
    ),
  );
  assert.equal(createQnaRequestHashForVersion(qnaRequestFixture, 999), null);
});
