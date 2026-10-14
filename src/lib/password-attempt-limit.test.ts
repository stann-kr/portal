import assert from "node:assert/strict";
import test from "node:test";
import { isPasswordAttemptAllowed, type PasswordAttemptRateLimiter } from "./password-attempt-limit";

function recordingLimiter(results: boolean[]): PasswordAttemptRateLimiter & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      return { success: results.shift() ?? true };
    },
  };
}

test("비밀번호 시도 제한은 용도와 접속 주소별로 세고 한도를 넘으면 거부한다", async () => {
  const limiter = recordingLimiter([true, false]);
  const headers = () => new Headers({ "CF-Connecting-IP": " 203.0.113.7 " });

  assert.equal(await isPasswordAttemptAllowed("login", headers, limiter), true);
  assert.equal(await isPasswordAttemptAllowed("invite", headers, limiter), false);
  assert.deepEqual(limiter.keys, ["login:203.0.113.7", "invite:203.0.113.7"]);
});

test("binding이 없거나 실패하면 통과시키고, 주소를 모르는 요청은 같은 한도를 나눈다", async () => {
  assert.equal(await isPasswordAttemptAllowed("login", () => { throw new Error("no request"); }, null), true);

  const failing: PasswordAttemptRateLimiter = { limit: async () => { throw new Error("binding down"); } };
  const originalError = console.error;
  console.error = () => undefined;
  try {
    assert.equal(await isPasswordAttemptAllowed("login", () => new Headers(), failing), true);
  } finally {
    console.error = originalError;
  }

  const limiter = recordingLimiter([true]);
  await isPasswordAttemptAllowed("password-change", () => { throw new Error("no request"); }, limiter);
  assert.deepEqual(limiter.keys, ["password-change:missing-cloudflare-client-address"]);
});
