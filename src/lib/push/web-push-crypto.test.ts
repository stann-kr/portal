import assert from "node:assert/strict";
import { test } from "node:test";
import {
  base64UrlDecode,
  base64UrlEncode,
  createVapidAuthorization,
  encryptWebPushPayload,
  generateVapidKeyPair,
  importP256PrivateKey,
  MAX_PLAINTEXT_LENGTH,
} from "./web-push-crypto";

// RFC 8291 Appendix A의 예시 값.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

test("RFC 8291 부록 A: 같은 키·salt면 요청 body가 바이트 단위로 같다", async () => {
  const publicKeyRaw = base64UrlDecode(RFC.asPublic);
  const privateKey = await importP256PrivateKey(RFC.asPrivate, publicKeyRaw, "ECDH");
  const body = await encryptWebPushPayload({
    plaintext: new TextEncoder().encode(RFC.plaintext),
    p256dh: RFC.uaPublic,
    auth: RFC.auth,
    salt: base64UrlDecode(RFC.salt),
    ephemeralKeys: { privateKey, publicKeyRaw },
  });
  assert.equal(base64UrlEncode(body), RFC.body);
});

test("암호화: salt·임시 키는 매번 새로 만들고, 헤더는 salt(16)·record 크기 4096·키 길이 65·임시 공개키다", async () => {
  const input = { plaintext: new TextEncoder().encode("{}"), p256dh: RFC.uaPublic, auth: RFC.auth };
  const first = await encryptWebPushPayload(input);
  const second = await encryptWebPushPayload(input);
  assert.notDeepEqual(first.slice(0, 16), second.slice(0, 16), "salt가 다르다");
  assert.equal(new DataView(first.buffer, first.byteOffset).getUint32(16, false), 4096);
  assert.equal(first[20], 65);
  assert.equal(first[21], 0x04, "비압축 공개키");
  // 본문 2바이트 + delimiter 1 + tag 16
  assert.equal(first.length, 16 + 4 + 1 + 65 + 2 + 1 + 16);
});

test("암호화: 잘못된 구독 키·너무 긴 본문은 거부한다", async () => {
  const plaintext = new TextEncoder().encode("{}");
  await assert.rejects(encryptWebPushPayload({ plaintext, p256dh: "AAAA", auth: RFC.auth }), /INVALID_SUBSCRIPTION_KEY/u);
  await assert.rejects(encryptWebPushPayload({ plaintext, p256dh: RFC.uaPublic, auth: "AAAA" }), /INVALID_SUBSCRIPTION_AUTH/u);
  await assert.rejects(
    encryptWebPushPayload({ plaintext: new Uint8Array(MAX_PLAINTEXT_LENGTH + 1), p256dh: RFC.uaPublic, auth: RFC.auth }),
    /PAYLOAD_TOO_LARGE/u,
  );
});

test("VAPID: 푸시 서비스 출처에 대한 ES256 JWT를 공개키로 검증할 수 있다", async () => {
  const keys = { ...(await generateVapidKeyPair()), subject: "https://portal.stann.kr" };
  const now = new Date("2026-11-09T00:00:00Z");
  const header = await createVapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, now);
  const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/u.exec(header);
  assert.ok(match, header);
  const [, encodedHeader, encodedClaims, encodedSignature, publicKey] = match;
  assert.equal(publicKey, keys.publicKey);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedHeader))), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedClaims)));
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "https://portal.stann.kr");
  assert.equal(claims.exp, Math.floor(now.getTime() / 1000) + 12 * 60 * 60);

  const signature = base64UrlDecode(encodedSignature);
  assert.equal(signature.length, 64, "r||s");
  const verifyKey = await crypto.subtle.importKey(
    "raw",
    base64UrlDecode(keys.publicKey) as Uint8Array<ArrayBuffer>,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    verifyKey,
    signature as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
  );
  assert.equal(valid, true);
});

test("base64url: 패딩 유무와 관계없이 왕복하고 다른 문자는 거부한다", () => {
  const bytes = new Uint8Array([251, 255, 0, 1, 2]);
  assert.deepEqual(base64UrlDecode(base64UrlEncode(bytes)), bytes);
  assert.deepEqual(base64UrlDecode("-_8AAQI="), bytes);
  assert.throws(() => base64UrlDecode("+/8AAQI"), /INVALID_BASE64URL/u);
});
