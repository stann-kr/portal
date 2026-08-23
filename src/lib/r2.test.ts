import assert from "node:assert/strict";
import test from "node:test";
import { generatePresignedUploadUrl } from "./r2";

test("browser PUT presign은 non-empty body와 충돌하는 SDK checksum을 포함하지 않는다", async () => {
  const previous = {
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  };
  process.env.R2_ENDPOINT = "https://example-account.r2.cloudflarestorage.com";
  process.env.R2_ACCESS_KEY_ID = "test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";

  try {
    const result = await generatePresignedUploadUrl({
      uploadObjectKey:
        "media-upload/community-post-audio/10000000-0000-4000-8000-000000000001",
      mimeType: "audio/mpeg",
      fileSize: 1_024,
      expiresIn: 3_600,
    });
    const url = new URL(result.uploadUrl);

    assert.equal(url.searchParams.has("x-amz-checksum-crc32"), false);
    assert.equal(url.searchParams.has("x-amz-sdk-checksum-algorithm"), false);
    const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders") ?? "";
    assert.match(signedHeaders, /content-length/u);
    assert.match(signedHeaders, /if-none-match/u);
  } finally {
    if (previous.endpoint === undefined) delete process.env.R2_ENDPOINT;
    else process.env.R2_ENDPOINT = previous.endpoint;
    if (previous.accessKeyId === undefined) delete process.env.R2_ACCESS_KEY_ID;
    else process.env.R2_ACCESS_KEY_ID = previous.accessKeyId;
    if (previous.secretAccessKey === undefined) delete process.env.R2_SECRET_ACCESS_KEY;
    else process.env.R2_SECRET_ACCESS_KEY = previous.secretAccessKey;
  }
});
