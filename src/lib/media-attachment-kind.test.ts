import assert from "node:assert/strict";
import test from "node:test";
import { mediaAttachmentKind, parseMediaDeliveryPath } from "./media-lifecycle";

test("첨부 MIME은 image·audio·video·file 종류로 나뉜다", () => {
  assert.equal(mediaAttachmentKind("image/png"), "image");
  assert.equal(mediaAttachmentKind("IMAGE/WEBP"), "image");
  assert.equal(mediaAttachmentKind("audio/mpeg"), "audio");
  assert.equal(mediaAttachmentKind("video/mp4; codecs=avc1"), "video");
  assert.equal(mediaAttachmentKind("application/pdf"), "file");
  assert.equal(mediaAttachmentKind(""), null);
  assert.equal(mediaAttachmentKind(null), null);
  assert.equal(mediaAttachmentKind(undefined), null);
});

test("media 전달 경로에서만 UUID v4 id를 읽는다", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  assert.equal(parseMediaDeliveryPath(`/api/media/${id}`), id);
  assert.equal(parseMediaDeliveryPath(`/api/media/${id.toUpperCase()}`), id);
  assert.equal(parseMediaDeliveryPath(`/api/media/${id}/x`), null);
  assert.equal(parseMediaDeliveryPath("https://example.com/a.png"), null);
  assert.equal(parseMediaDeliveryPath("/api/media/not-a-uuid"), null);
  assert.equal(parseMediaDeliveryPath(null), null);
});
