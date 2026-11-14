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

test("계정이 없거나 가입 전이어도 비밀번호 확인과 같은 일을 해, 응답 시간으로 가입 여부를 알 수 없다", async () => {
  const stored = await bcrypt.hash("real-pass-1", 10);
  const invite = inviteHash(await bcrypt.hash("invite-secret", 10), new Date(Date.now() + 60_000));
  const elapsed = async (run: () => Promise<boolean>) => {
    const startedAt = performance.now();
    assert.equal(await run(), false);
    return performance.now() - startedAt;
  };
  // 한 번씩 미리 돌려 JIT 차이를 줄인다.
  await verifyStoredPassword("warm-up", stored);
  const wrongPassword = await elapsed(() => verifyStoredPassword("wrong-pass", stored));
  const noAccount = await elapsed(() => verifyStoredPassword("wrong-pass", null));
  const notJoined = await elapsed(() => verifyStoredPassword("wrong-pass", invite));
  assert.ok(noAccount > wrongPassword * 0.3, `없는 계정 ${noAccount.toFixed(1)}ms, 틀린 비밀번호 ${wrongPassword.toFixed(1)}ms`);
  assert.ok(notJoined > wrongPassword * 0.3, `가입 전 계정 ${notJoined.toFixed(1)}ms, 틀린 비밀번호 ${wrongPassword.toFixed(1)}ms`);
});
