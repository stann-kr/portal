import assert from "node:assert/strict";
import test from "node:test";
import {
  createMediaObjectKey,
  createMediaUploadObjectKey,
} from "./media-lifecycle";
import {
  createR2BindingDeletionStorage,
  type RuntimeR2DeletionBucket,
} from "./r2-deletion-storage";

const FINAL_OBJECT_ID = "71f9d4e5-dda9-4793-8b23-c1018526e258";
const UPLOAD_OBJECT_ID = "2f75452c-e4dd-4303-b8bf-f88cdd468ac2";

test("native R2 deletion adapter는 canonical managed key만 binding delete로 전달한다", async () => {
  const deletedKeys: Array<string | string[]> = [];
  const bucket: RuntimeR2DeletionBucket = {
    async delete(objectKey) {
      deletedKeys.push(objectKey);
    },
  };
  const storage = createR2BindingDeletionStorage(bucket);
  const validKeys = [
    createMediaObjectKey("COMMUNITY_POST_AUDIO", FINAL_OBJECT_ID),
    createMediaObjectKey("QNA_ATTACHMENT", FINAL_OBJECT_ID),
    createMediaUploadObjectKey("COMMUNITY_POST_AUDIO", UPLOAD_OBJECT_ID),
    createMediaUploadObjectKey("QNA_ATTACHMENT", UPLOAD_OBJECT_ID),
  ];

  for (const key of validKeys) {
    await storage.delete(key);
  }
  assert.deepEqual(deletedKeys, validKeys);

  const rejectedKeys = [
    "audio/legacy-track.mp3",
    `https://media.example.com/${validKeys[0]}`,
    `${validKeys[0]}/extra`,
    validKeys[0].toUpperCase(),
    "media/qna-attachment/not-a-uuid",
    "../media/qna-attachment/71f9d4e5-dda9-4793-8b23-c1018526e258",
  ];
  for (const key of rejectedKeys) {
    await assert.rejects(storage.delete(key), /관리 대상 R2 object key/u);
  }
  assert.deepEqual(deletedKeys, validKeys);
});
