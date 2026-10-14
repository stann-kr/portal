import assert from "node:assert/strict";
import test from "node:test";
import * as bcrypt from "bcryptjs";
import { newPasswordPolicyError } from "./password-policy";
import {
  generateInviteSecret,
  generateTemporaryPassword,
  inviteHash,
  isTemporaryPasswordHash,
  storedCredentialState,
  temporaryPasswordHash,
  verifyInviteSecret,
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

test("가입 링크 secret은 만료 시각과 함께 저장되고 로그인 비밀번호로는 쓸 수 없다", async () => {
  const secret = generateInviteSecret();
  const expiresAt = new Date("2026-10-21T12:00:00.000Z");
  const stored = inviteHash(await bcrypt.hash(secret, 4), expiresAt);

  assert.match(secret, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(generateInviteSecret(), secret);
  assert.deepEqual(storedCredentialState(stored), { kind: "invite", expiresAt });
  assert.deepEqual(storedCredentialState(temporaryPasswordHash("$2a$04$x")), { kind: "temporary" });
  assert.deepEqual(storedCredentialState("$2a$04$x"), { kind: "active" });
  assert.equal(await verifyInviteSecret(secret, stored, new Date("2026-10-21T11:59:59.000Z")), "valid");
  assert.equal(await verifyInviteSecret(secret, stored, new Date("2026-10-21T12:00:00.000Z")), "expired");
  assert.equal(await verifyInviteSecret("wrong-secret", stored, new Date("2026-10-30T00:00:00.000Z")), "invalid", "틀린 secret은 만료 여부를 드러내지 않는다");
  assert.equal(await verifyInviteSecret(secret, "$2a$04$x", new Date()), "invalid");
  assert.equal(await verifyStoredPassword(secret, stored), false);
});
