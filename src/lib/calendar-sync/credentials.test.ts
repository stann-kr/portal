import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CalendarCredentialError,
  decryptConnectionCredentials,
  encryptConnectionCredentials,
  type GoogleConnectionCredentials,
  type ICloudConnectionCredentials,
} from "./credentials";

const KEY = crypto.getRandomValues(new Uint8Array(32));
const GOOGLE: GoogleConnectionCredentials = {
  refreshToken: "refresh-secret-value-1234",
  accessToken: "access-secret-value-5678",
  accessTokenExpiresAt: Date.UTC(2026, 9, 27, 4, 0, 0),
};
const ICLOUD: ICloudConnectionCredentials = {
  appleId: "teacher@example.com",
  appPassword: "abcd-efgh-ijkl-mnop",
  calendarHomeUrl: "https://p01-caldav.icloud.com/123456/calendars/",
};
const SECRETS = [GOOGLE.refreshToken, GOOGLE.accessToken!, ICLOUD.appPassword];

/** CalendarCredentialError로 거부되고 메시지에 비밀 값이 없어야 한다. */
async function assertRejectsWithoutSecret(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CalendarCredentialError, `expected CalendarCredentialError, got ${String(error)}`);
    for (const secret of SECRETS) assert.equal(error.message.includes(secret), false);
    return true;
  });
}

function flipFirstChar(value: string): string {
  const first = value[0] === "A" ? "B" : "A";
  return `${first}${value.slice(1)}`;
}

test("Google 자격 증명은 같은 연결 id·provider로 암호화·복호화하면 그대로 돌아온다", async () => {
  const sealed = await encryptConnectionCredentials({ connectionId: "conn-g", provider: "GOOGLE", credentials: GOOGLE, key: KEY });
  assert.equal(sealed.encryptedCredentials.includes(GOOGLE.refreshToken), false);
  const opened = await decryptConnectionCredentials({ connectionId: "conn-g", provider: "GOOGLE", ...sealed, key: KEY });
  assert.deepEqual(opened, GOOGLE);
});

test("iCloud 자격 증명은 같은 연결 id·provider로 암호화·복호화하면 그대로 돌아오고 매번 다른 IV를 쓴다", async () => {
  const first = await encryptConnectionCredentials({ connectionId: "conn-i", provider: "ICLOUD", credentials: ICLOUD, key: KEY });
  const second = await encryptConnectionCredentials({ connectionId: "conn-i", provider: "ICLOUD", credentials: ICLOUD, key: KEY });
  assert.notEqual(first.credentialsIv, second.credentialsIv);
  assert.equal(first.encryptedCredentials.includes(ICLOUD.appPassword), false);
  assert.deepEqual(await decryptConnectionCredentials({ connectionId: "conn-i", provider: "ICLOUD", ...first, key: KEY }), ICLOUD);
});

test("다른 연결 id나 다른 provider로는 복호화를 거부한다", async () => {
  const sealed = await encryptConnectionCredentials({ connectionId: "conn-a", provider: "ICLOUD", credentials: ICLOUD, key: KEY });
  await assertRejectsWithoutSecret(decryptConnectionCredentials({ connectionId: "conn-b", provider: "ICLOUD", ...sealed, key: KEY }));
  await assertRejectsWithoutSecret(decryptConnectionCredentials({ connectionId: "conn-a", provider: "GOOGLE", ...sealed, key: KEY }));
});

test("IV나 ciphertext가 바뀌면 복호화를 거부한다", async () => {
  const sealed = await encryptConnectionCredentials({ connectionId: "conn-g", provider: "GOOGLE", credentials: GOOGLE, key: KEY });
  await assertRejectsWithoutSecret(
    decryptConnectionCredentials({ connectionId: "conn-g", provider: "GOOGLE", ...sealed, credentialsIv: flipFirstChar(sealed.credentialsIv), key: KEY }),
  );
  await assertRejectsWithoutSecret(
    decryptConnectionCredentials({
      connectionId: "conn-g",
      provider: "GOOGLE",
      ...sealed,
      encryptedCredentials: flipFirstChar(sealed.encryptedCredentials),
      key: KEY,
    }),
  );
});

test("다른 key나 32바이트가 아닌 key는 거부한다", async () => {
  const sealed = await encryptConnectionCredentials({ connectionId: "conn-g", provider: "GOOGLE", credentials: GOOGLE, key: KEY });
  await assertRejectsWithoutSecret(
    decryptConnectionCredentials({ connectionId: "conn-g", provider: "GOOGLE", ...sealed, key: crypto.getRandomValues(new Uint8Array(32)) }),
  );
  for (const length of [0, 16, 31, 33, 64]) {
    const key = crypto.getRandomValues(new Uint8Array(length));
    await assertRejectsWithoutSecret(encryptConnectionCredentials({ connectionId: "conn-g", provider: "GOOGLE", credentials: GOOGLE, key }));
    await assertRejectsWithoutSecret(decryptConnectionCredentials({ connectionId: "conn-g", provider: "GOOGLE", ...sealed, key }));
  }
});

test("형식이 깨진 저장 값은 CalendarCredentialError로 거부한다", async () => {
  const sealed = await encryptConnectionCredentials({ connectionId: "conn-g", provider: "GOOGLE", credentials: GOOGLE, key: KEY });
  const malformed: { encryptedCredentials: string; credentialsIv: string }[] = [
    { encryptedCredentials: "", credentialsIv: sealed.credentialsIv },
    { encryptedCredentials: sealed.encryptedCredentials, credentialsIv: "" },
    { encryptedCredentials: "not base64url!", credentialsIv: sealed.credentialsIv },
    { encryptedCredentials: sealed.encryptedCredentials, credentialsIv: "a" },
    // 12바이트가 아닌 IV, 인증 tag(16바이트)보다 짧은 ciphertext
    { encryptedCredentials: sealed.encryptedCredentials, credentialsIv: "AAAAAAAAAAAA" },
    { encryptedCredentials: "AAAA", credentialsIv: sealed.credentialsIv },
  ];
  for (const value of malformed) {
    await assertRejectsWithoutSecret(decryptConnectionCredentials({ connectionId: "conn-g", provider: "GOOGLE", ...value, key: KEY }));
  }
});

test("필수 값이 빠진 자격 증명은 암호화하지 않는다", async () => {
  const { refreshToken: _refreshToken, ...googleWithoutRefresh } = GOOGLE;
  void _refreshToken;
  await assertRejectsWithoutSecret(
    encryptConnectionCredentials({
      connectionId: "conn-g",
      provider: "GOOGLE",
      credentials: googleWithoutRefresh as unknown as GoogleConnectionCredentials,
      key: KEY,
    }),
  );
  await assertRejectsWithoutSecret(
    encryptConnectionCredentials({ connectionId: "conn-g", provider: "GOOGLE", credentials: { ...GOOGLE, refreshToken: "" }, key: KEY }),
  );
  const { appPassword: _appPassword, ...icloudWithoutPassword } = ICLOUD;
  void _appPassword;
  await assertRejectsWithoutSecret(
    encryptConnectionCredentials({
      connectionId: "conn-i",
      provider: "ICLOUD",
      credentials: icloudWithoutPassword as unknown as ICloudConnectionCredentials,
      key: KEY,
    }),
  );
  // provider와 맞지 않는 모양(iCloud 값에 Google provider)
  await assertRejectsWithoutSecret(
    encryptConnectionCredentials({
      connectionId: "conn-i",
      provider: "GOOGLE",
      credentials: ICLOUD as unknown as GoogleConnectionCredentials,
      key: KEY,
    }),
  );
});
