import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_CLEANUP_STATUS_PATH,
  enforceAccountCleanupStatusRateLimit,
  type AccountCleanupRateLimiter,
} from "./account-cleanup-rate-limit";

function request(path = ACCOUNT_CLEANUP_STATUS_PATH, method = "POST") {
  return new Request(`https://portal.stann.kr${path}`, {
    method,
    headers: { "CF-Connecting-IP": "203.0.113.10" },
  });
}

test("cleanup status만 client address 기반 limiter를 호출한다", async () => {
  const keys: string[] = [];
  const limiter: AccountCleanupRateLimiter = {
    async limit(input) {
      keys.push(input.key);
      return { success: true };
    },
  };

  assert.equal(await enforceAccountCleanupStatusRateLimit(request(), limiter), null);
  assert.equal(
    await enforceAccountCleanupStatusRateLimit(request("/api/calendar/feed"), limiter),
    null,
  );
  assert.equal(
    await enforceAccountCleanupStatusRateLimit(
      request(ACCOUNT_CLEANUP_STATUS_PATH, "GET"),
      limiter,
    ),
    null,
  );
  assert.deepEqual(keys, ["203.0.113.10"]);
});

test("limit 초과와 binding 실패는 body 비노출 no-store 응답으로 닫힌다", async () => {
  const limited = await enforceAccountCleanupStatusRateLimit(request(), {
    async limit() {
      return { success: false };
    },
  });
  assert.equal(limited?.status, 429);
  assert.equal(limited?.headers.get("Cache-Control"), "no-store");
  assert.equal(limited?.headers.get("Retry-After"), "60");
  assert.deepEqual(await limited?.json(), { ok: false });

  const unavailable = await enforceAccountCleanupStatusRateLimit(request(), {
    async limit() {
      throw new Error("sensitive digest must not escape");
    },
  });
  assert.equal(unavailable?.status, 503);
  assert.equal(unavailable?.headers.get("Retry-After"), "10");
  assert.deepEqual(await unavailable?.json(), { ok: false });
});

test("Cloudflare client address가 없으면 공유 fail-closed key를 사용한다", async () => {
  let key = "";
  const response = await enforceAccountCleanupStatusRateLimit(
    new Request(`https://portal.stann.kr${ACCOUNT_CLEANUP_STATUS_PATH}`, {
      method: "POST",
    }),
    {
      async limit(input) {
        key = input.key;
        return { success: true };
      },
    },
  );
  assert.equal(response, null);
  assert.equal(key, "missing-cloudflare-client-address");
});
