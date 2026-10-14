import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_SERVER_DRAFT_POLL_MAX_MS,
  DOCUMENT_SERVER_DRAFT_POLL_MIN_MS,
  getDocumentServerDraftPollDelay,
} from "./document-server-draft-polling";

test("hidden 또는 offline editor는 polling timer를 만들지 않는다", () => {
  assert.equal(getDocumentServerDraftPollDelay({ visible: false, online: true, unchangedPolls: 0 }), null);
  assert.equal(getDocumentServerDraftPollDelay({ visible: true, online: false, unchangedPolls: 0 }), null);
});

test("활성 editor의 unchanged poll은 bounded exponential interval을 사용한다", () => {
  const delay = (unchangedPolls: number) => getDocumentServerDraftPollDelay({
    visible: true,
    online: true,
    unchangedPolls,
  });
  assert.equal(delay(0), DOCUMENT_SERVER_DRAFT_POLL_MIN_MS);
  assert.equal(delay(1), DOCUMENT_SERVER_DRAFT_POLL_MIN_MS);
  assert.equal(delay(2), DOCUMENT_SERVER_DRAFT_POLL_MIN_MS * 2);
  assert.equal(delay(4), DOCUMENT_SERVER_DRAFT_POLL_MIN_MS * 4);
  assert.equal(delay(100), DOCUMENT_SERVER_DRAFT_POLL_MAX_MS);
});
