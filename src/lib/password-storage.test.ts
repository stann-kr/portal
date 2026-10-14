import assert from "node:assert/strict";
import test from "node:test";
import * as bcrypt from "bcryptjs";
import { newPasswordPolicyError } from "./password-policy";
import {
  generateTemporaryPassword,
  isTemporaryPasswordHash,
  temporaryPasswordHash,
  verifyStoredPassword,
} from "./password-storage";

test("임시 비밀번호 hash는 표시로 구분되고 일반 hash와 같은 방식으로 확인된다", async () => {
  const bcryptHash = await bcrypt.hash("temp-pass-1", 4);
  const stored = temporaryPasswordHash(bcryptHash);

  assert.equal(isTemporaryPasswordHash(stored), true);
  assert.equal(isTemporaryPasswordHash(bcryptHash), false);
  assert.equal(isTemporaryPasswordHash(null), false);
  assert.equal(await verifyStoredPassword("temp-pass-1", stored), true);
  assert.equal(await verifyStoredPassword("temp-pass-1", bcryptHash), true);
  assert.equal(await verifyStoredPassword("wrong-pass", stored), false);
  assert.equal(await verifyStoredPassword("temp-pass-1", null), false);
});

test("임시 비밀번호는 전달하기 쉬운 형식이고 새 비밀번호 정책을 통과한다", () => {
  const issued = new Set<string>();
  for (let index = 0; index < 50; index += 1) {
    const password = generateTemporaryPassword();
    assert.match(password, /^[a-km-np-z2-9]{4}-[a-km-np-z2-9]{4}-[a-km-np-z2-9]{4}$/u);
    assert.equal(newPasswordPolicyError(password), null);
    issued.add(password);
  }
  assert.equal(issued.size, 50);
});
