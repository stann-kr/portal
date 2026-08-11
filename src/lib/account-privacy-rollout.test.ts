import assert from "node:assert/strict";
import test from "node:test";
import { isAccountDeletionEnabled } from "./account-privacy-rollout";

test("계정 삭제 rollout flag는 명시적인 false만 거부한다", () => {
  assert.equal(isAccountDeletionEnabled("false"), false);
  assert.equal(isAccountDeletionEnabled("true"), true);
  assert.equal(isAccountDeletionEnabled(undefined), true);
});
