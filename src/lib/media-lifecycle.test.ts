import assert from "node:assert/strict";
import test from "node:test";
import {
  MEDIA_DELETE_REQUEST_TIMEOUT_MS,
  MEDIA_DELETION_REASONS,
  MEDIA_DRAFT_RETENTION_SECONDS,
  MEDIA_OBJECT_STATES,
  MEDIA_PURPOSE_POLICIES,
  MEDIA_SEAL_LEASE_SECONDS,
  MEDIA_SEAL_RECOVERY_GRACE_SECONDS,
  MEDIA_SEAL_REQUEST_TIMEOUT_MS,
  MEDIA_UPLOAD_CLIENT_TIMEOUT_MS,
  MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
  MEDIA_UPLOAD_URL_TTL_SECONDS,
  calculateMediaDeletionBackoffMs,
  createMediaObjectKey,
  createMediaUploadObjectKey,
  createOpaqueMediaObjectKey,
  getTrustedLegacyMediaObjectKey,
  isTrustedLegacyMediaUrl,
  mediaUploadRequestHeaders,
  mediaDeletionBackoffSeconds,
  parseMediaUuidV4,
  prepareMediaUploadIntent,
  validateMediaUploadInput,
} from "./media-lifecycle";

const OPERATION_ID = "c00e5ee7-36ae-45eb-a39a-d96f6292a842";
const MEDIA_OBJECT_ID = "2f75452c-e4dd-4303-b8bf-f88cdd468ac2";
const STORAGE_OBJECT_ID = "71f9d4e5-dda9-4793-8b23-c1018526e258";

function validAudioInput() {
  return {
    purpose: "COMMUNITY_POST_AUDIO",
    fileName: "lesson mix.mp3",
    mimeType: "audio/mpeg",
    fileSize: 1_024,
    draftOperationId: OPERATION_ID,
  };
}

test("purpose별 MIME, 크기, 서명 만료 정책은 서버 상수로 고정된다", () => {
  assert.deepEqual(
    MEDIA_PURPOSE_POLICIES.COMMUNITY_POST_AUDIO.allowedMimeTypes,
    [
      "audio/aiff",
      "audio/flac",
      "audio/mp4",
      "audio/mpeg",
      "audio/ogg",
      "audio/wav",
    ],
  );
  assert.equal(
    MEDIA_PURPOSE_POLICIES.COMMUNITY_POST_AUDIO.maxFileSizeBytes,
    2 * 1024 * 1024 * 1024,
  );
  assert.equal(
    MEDIA_PURPOSE_POLICIES.QNA_ATTACHMENT.allowedMimeTypes.includes("image/png"),
    true,
  );
  assert.equal(
    MEDIA_PURPOSE_POLICIES.QNA_ATTACHMENT.uploadUrlTtlSeconds,
    3_600,
  );
  assert.equal(MEDIA_UPLOAD_URL_TTL_SECONDS, 3_600);
  assert.equal(
    MEDIA_UPLOAD_CLIENT_TIMEOUT_MS < MEDIA_UPLOAD_URL_TTL_SECONDS * 1_000,
    true,
  );
  assert.equal(MEDIA_UPLOAD_STAGING_GRACE_SECONDS, 3_600);
  assert.equal(
    MEDIA_SEAL_REQUEST_TIMEOUT_MS < MEDIA_SEAL_LEASE_SECONDS * 1_000,
    true,
  );
  assert.equal(
    MEDIA_SEAL_RECOVERY_GRACE_SECONDS * 1_000 > MEDIA_SEAL_REQUEST_TIMEOUT_MS,
    true,
  );
  assert.equal(MEDIA_DELETE_REQUEST_TIMEOUT_MS < 10_000, true);
  assert.equal(MEDIA_DRAFT_RETENTION_SECONDS, 30 * 24 * 60 * 60);
});

test("browser PUT은 presign과 같은 MIME 및 one-shot 조건부 header를 보낸다", () => {
  assert.deepEqual(mediaUploadRequestHeaders("audio/mpeg"), {
    "Content-Type": "audio/mpeg",
    "If-None-Match": "*",
  });
});

test("유효한 업로드 입력은 원본 파일명을 결과에 보존하지 않고 정규화된다", () => {
  const result = validateMediaUploadInput({
    ...validAudioInput(),
    draftOperationId: OPERATION_ID.toUpperCase(),
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      purpose: "COMMUNITY_POST_AUDIO",
      canonicalMimeType: "audio/mpeg",
      fileSize: 1_024,
      draftOperationId: OPERATION_ID,
    },
  });
  assert.equal("fileName" in (result.ok ? result.value : {}), false);
});

test("파일명은 빈 값, 경로, 제어 문자, 앞뒤 공백, 255 UTF-8 byte 초과를 거부한다", () => {
  const invalidFileNames = [
    "",
    ".",
    "..",
    "../secret.mp3",
    "folder/secret.mp3",
    "folder\\secret.mp3",
    " lesson.mp3",
    "lesson.mp3 ",
    "bad\u0000name.mp3",
    `${"가".repeat(84)}.mp3`,
  ];

  for (const fileName of invalidFileNames) {
    const result = validateMediaUploadInput({ ...validAudioInput(), fileName });
    assert.equal(result.ok, false, fileName);
    if (!result.ok) assert.equal(result.code, "INVALID_FILE_NAME", fileName);
  }
});

test("MIME은 purpose allowlist에 한해 소문자 정규형으로 만든다", () => {
  for (const mimeType of ["", " audio/mpeg", "text/html", "image/png"]) {
    const result = validateMediaUploadInput({ ...validAudioInput(), mimeType });
    assert.equal(result.ok, false, mimeType);
    if (!result.ok) assert.equal(result.code, "INVALID_MIME_TYPE", mimeType);
  }

  const canonicalAudio = validateMediaUploadInput({
    ...validAudioInput(),
    mimeType: "AUDIO/MPEG",
  });
  assert.equal(canonicalAudio.ok, true);
  if (canonicalAudio.ok) {
    assert.equal(canonicalAudio.value.canonicalMimeType, "audio/mpeg");
  }

  const qnaImage = validateMediaUploadInput({
    ...validAudioInput(),
    purpose: "QNA_ATTACHMENT",
    fileName: "screenshot.png",
    mimeType: "image/png",
  });
  assert.equal(qnaImage.ok, true);
});

test("파일 크기는 양의 safe integer이며 purpose 상한 이하여야 한다", () => {
  const max = MEDIA_PURPOSE_POLICIES.COMMUNITY_POST_AUDIO.maxFileSizeBytes;
  for (const fileSize of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, max + 1]) {
    const result = validateMediaUploadInput({ ...validAudioInput(), fileSize });
    assert.equal(result.ok, false, String(fileSize));
    if (!result.ok) assert.equal(result.code, "INVALID_FILE_SIZE", String(fileSize));
  }

  assert.equal(
    validateMediaUploadInput({ ...validAudioInput(), fileSize: max }).ok,
    true,
  );
});

test("purpose와 draft operation ID를 fail-closed로 검증한다", () => {
  const invalidPurpose = validateMediaUploadInput({
    ...validAudioInput(),
    purpose: "ARBITRARY_PREFIX",
  });
  const invalidOperation = validateMediaUploadInput({
    ...validAudioInput(),
    draftOperationId: "not-a-v4-uuid",
  });

  assert.equal(invalidPurpose.ok, false);
  if (!invalidPurpose.ok) assert.equal(invalidPurpose.code, "INVALID_PURPOSE");
  assert.equal(invalidOperation.ok, false);
  if (!invalidOperation.ok) {
    assert.equal(invalidOperation.code, "INVALID_DRAFT_OPERATION_ID");
  }
});

test("업로드 intent는 UUID 기반 opaque key를 만들고 사용자·원본 파일명을 노출하지 않는다", () => {
  const identifiers = [MEDIA_OBJECT_ID, STORAGE_OBJECT_ID];
  const result = prepareMediaUploadIntent(validAudioInput(), () => {
    const identifier = identifiers.shift();
    if (!identifier) throw new Error("unexpected UUID request");
    return identifier;
  });

  assert.deepEqual(result, {
    ok: true,
    intent: {
      mediaObjectId: MEDIA_OBJECT_ID,
      objectKey: `media/community-post-audio/${STORAGE_OBJECT_ID}`,
      uploadObjectKey: `media-upload/community-post-audio/${MEDIA_OBJECT_ID}`,
      purpose: "COMMUNITY_POST_AUDIO",
      canonicalMimeType: "audio/mpeg",
      expectedSizeBytes: 1_024,
      draftOperationId: OPERATION_ID,
    },
  });
  assert.equal(JSON.stringify(result).includes("lesson mix.mp3"), false);
  assert.equal(JSON.stringify(result).includes("user-"), false);
});

test("opaque key 생성기는 UUID v4가 아닌 난수 결과를 거부한다", () => {
  assert.throws(
    () => createOpaqueMediaObjectKey("QNA_ATTACHMENT", () => "predictable"),
    /UUID v4/u,
  );
  assert.equal(
    createMediaObjectKey("QNA_ATTACHMENT", MEDIA_OBJECT_ID.toUpperCase()),
    `media/qna-attachment/${MEDIA_OBJECT_ID}`,
  );
  assert.equal(
    createMediaUploadObjectKey("QNA_ATTACHMENT", MEDIA_OBJECT_ID.toUpperCase()),
    `media-upload/qna-attachment/${MEDIA_OBJECT_ID}`,
  );
  assert.equal(parseMediaUuidV4(MEDIA_OBJECT_ID.toUpperCase()), MEDIA_OBJECT_ID);
  assert.equal(parseMediaUuidV4("predictable"), null);
});

test("미디어 상태와 삭제 사유는 lifecycle/outbox 계약을 모두 포함한다", () => {
  assert.deepEqual(MEDIA_OBJECT_STATES, [
    "PENDING_UPLOAD",
    "SEALING",
    "READY",
    "ATTACHED",
    "PENDING_DELETE",
    "DELETED",
  ]);
  assert.equal(MEDIA_DELETION_REASONS.includes("RESOURCE_PURGED"), true);
  assert.equal(MEDIA_DELETION_REASONS.includes("UPLOAD_STAGING_EXPIRED"), true);
  assert.equal(MEDIA_DELETION_REASONS.includes("ACCOUNT_DELETION"), true);
});

test("삭제 재시도는 1회부터 지수 증가하고 설정 상한에서 멈춘다", () => {
  assert.equal(calculateMediaDeletionBackoffMs(1), 30_000);
  assert.equal(calculateMediaDeletionBackoffMs(2), 60_000);
  assert.equal(calculateMediaDeletionBackoffMs(3), 120_000);
  assert.equal(mediaDeletionBackoffSeconds(3), 120);
  assert.equal(
    calculateMediaDeletionBackoffMs(20),
    6 * 60 * 60 * 1_000,
  );
  assert.equal(
    calculateMediaDeletionBackoffMs(4, { baseDelayMs: 100, maxDelayMs: 500 }),
    500,
  );
  assert.throws(() => calculateMediaDeletionBackoffMs(0), RangeError);
  assert.throws(
    () => calculateMediaDeletionBackoffMs(1, { baseDelayMs: 0 }),
    RangeError,
  );
});

test("legacy URL은 trusted HTTPS origin·base path·managed prefix가 정확히 맞아야 한다", () => {
  const baseUrl = "https://media.example.com/portal-assets/";
  const audioUrl = "https://media.example.com/portal-assets/audio/1710000000000-mix.mp3";
  const qnaUrl = "https://media.example.com/portal-assets/qna/1710000000001-image.png";

  assert.equal(
    getTrustedLegacyMediaObjectKey(audioUrl, baseUrl),
    "audio/1710000000000-mix.mp3",
  );
  assert.equal(isTrustedLegacyMediaUrl(qnaUrl, baseUrl), true);
});

test("legacy URL 판정은 lookalike origin, query/hash, encoding, 비관리 prefix를 거부한다", () => {
  const baseUrl = "https://media.example.com/portal-assets";
  const rejected = [
    "https://media.example.com.evil.test/portal-assets/audio/file.mp3",
    "http://media.example.com/portal-assets/audio/file.mp3",
    "https://media.example.com/portal-assets/audio/file.mp3?download=1",
    "https://media.example.com/portal-assets/audio/file.mp3#fragment",
    "https://media.example.com/portal-assets/audio%2Ffile.mp3",
    "https://media.example.com/portal-assets/private/file.mp3",
    "https://media.example.com/audio/file.mp3",
  ];

  for (const candidate of rejected) {
    assert.equal(getTrustedLegacyMediaObjectKey(candidate, baseUrl), null, candidate);
  }
});

test("legacy URL custom prefix도 canonical 상대 prefix만 허용한다", () => {
  const candidate = "https://media.example.com/assets/legacy/file.wav";
  assert.equal(
    getTrustedLegacyMediaObjectKey(candidate, "https://media.example.com/assets", [
      "legacy/",
    ]),
    "legacy/file.wav",
  );
  assert.equal(
    getTrustedLegacyMediaObjectKey(candidate, "https://media.example.com/assets", [
      "../legacy/",
    ]),
    null,
  );
});
