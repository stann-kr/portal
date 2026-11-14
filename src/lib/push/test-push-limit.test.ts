import assert from "node:assert/strict";
import { test } from "node:test";
import { isTestPushAllowed } from "./test-push-limit";

test("테스트 알림 한도: 계정별 key로 세고, limiter가 없거나 실패하면 막지 않는다", async () => {
  const keys: string[] = [];
  const limiter = (success: boolean) => ({
    async limit(input: { key: string }) {
      keys.push(input.key);
      return { success };
    },
  });
  assert.equal(await isTestPushAllowed("student-1", limiter(true)), true);
  assert.equal(await isTestPushAllowed("student-2", limiter(false)), false);
  assert.deepEqual(keys, ["push-test:student-1", "push-test:student-2"]);
  assert.equal(await isTestPushAllowed("student-1", null), true);
  assert.equal(
    await isTestPushAllowed("student-1", { async limit() { throw new Error("down"); } }),
    true,
  );
});
