#!/usr/bin/env node
/**
 * 웹 푸시 발신 키(VAPID) 한 쌍을 만들어 표준 출력에만 보여 준다. 파일에 쓰지 않는다.
 * 개인키는 secret으로 넣는다: 로컬은 .env.development.local, 운영은 `wrangler secret put VAPID_PRIVATE_KEY`.
 * 키를 바꾸면 기존 기기 구독은 모두 다시 켜야 한다(브라우저 구독이 공개키에 묶인다).
 */
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const publicKey = Buffer.from(raw).toString("base64url");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
