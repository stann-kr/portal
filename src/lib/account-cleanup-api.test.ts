import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_CLEANUP_RESPONSE_HEADERS,
  accountCleanupJson,
  parseAccountCleanupRequest,
} from "./account-cleanup-api";

const DIGEST = "a".repeat(64);

function request(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://portal.example/api/account-cleanup/status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://portal.example",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body,
  });
}

test("cleanup API는 정확한 same-origin digest payload만 허용한다", async () => {
  assert.deepEqual(
    await parseAccountCleanupRequest(
      request(JSON.stringify({ tokenDigest: DIGEST })),
    ),
    { ok: true, value: { tokenDigest: DIGEST } },
  );
  assert.deepEqual(
    await parseAccountCleanupRequest(
      request(JSON.stringify({ tokenDigest: DIGEST }), {
        origin: "https://attacker.example",
      }),
    ),
    { ok: false, reason: "CROSS_ORIGIN" },
  );
  assert.deepEqual(
    await parseAccountCleanupRequest(
      request(JSON.stringify({ tokenDigest: DIGEST, ownerId: "leak" })),
    ),
    { ok: false, reason: "INVALID_PAYLOAD" },
  );
  assert.deepEqual(
    await parseAccountCleanupRequest(
      request(JSON.stringify({ tokenDigest: "not-a-digest" })),
    ),
    { ok: false, reason: "INVALID_PAYLOAD" },
  );
});

test("cleanup API는 body byte 상한과 JSON content type을 강제한다", async () => {
  assert.deepEqual(
    await parseAccountCleanupRequest(
      request(JSON.stringify({ tokenDigest: DIGEST }), {
        "content-type": "text/plain",
      }),
    ),
    { ok: false, reason: "INVALID_CONTENT_TYPE" },
  );
  assert.deepEqual(
    await parseAccountCleanupRequest(
      request(JSON.stringify({ tokenDigest: DIGEST }), {
        "content-length": "9999",
      }),
    ),
    { ok: false, reason: "PAYLOAD_TOO_LARGE" },
  );
});

test("cleanup 응답은 모든 상태에서 no-store와 same-origin header를 쓴다", async () => {
  const response = accountCleanupJson({ ok: true, status: "NO_ACTION" });
  for (const [name, expected] of Object.entries(
    ACCOUNT_CLEANUP_RESPONSE_HEADERS,
  )) {
    assert.equal(response.headers.get(name), expected);
  }
  assert.deepEqual(await response.json(), { ok: true, status: "NO_ACTION" });
});
