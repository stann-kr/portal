/**
 * Web Push 표준의 서버 쪽 암호 처리(Workers WebCrypto만 사용, Node 전용 의존성 없음).
 * - 본문 암호화: RFC 8291(Message Encryption for Web Push) + RFC 8188 aes128gcm 한 record
 * - 발신자 인증: RFC 8292 VAPID(ES256 JWT)
 */

const textEncoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*={0,2}$/u.test(value)) throw new Error("INVALID_BASE64URL");
  const normalized = value.replace(/=+$/u, "").replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** WebCrypto 인자로 넘길 때 SharedArrayBuffer가 아닌 ArrayBuffer로 고정한다(TS lib 타입 요구). */
function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", buffer(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, buffer(data)));
}

/** HKDF(SHA-256)에서 출력이 32바이트 이하일 때: PRK = HMAC(salt, ikm), OKM = HMAC(PRK, info || 0x01)[0..length]. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmacSha256(salt, ikm);
  const okm = await hmacSha256(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

const P256_PUBLIC_KEY_LENGTH = 65;
const AUTH_SECRET_LENGTH = 16;
const SALT_LENGTH = 16;
/** 한 record 크기. 본문은 한 record에 담기므로 이보다 작아야 한다. */
export const RECORD_SIZE = 4096;
/** padding delimiter(1) + GCM tag(16)를 뺀, 한 record에 담을 수 있는 본문 최대 길이. */
export const MAX_PLAINTEXT_LENGTH = RECORD_SIZE - 17;

export type EphemeralKeys = {
  privateKey: CryptoKey;
  /** 비압축 P-256 공개키(65바이트). */
  publicKeyRaw: Uint8Array;
};

async function generateEphemeralKeys(): Promise<EphemeralKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKeyRaw };
}

/** 32바이트 비밀값(d)과 비압축 공개키로 WebCrypto EC 개인키를 만든다. */
export async function importP256PrivateKey(
  privateKeyBase64Url: string,
  publicKeyRaw: Uint8Array,
  algorithm: "ECDH" | "ECDSA",
): Promise<CryptoKey> {
  if (publicKeyRaw.length !== P256_PUBLIC_KEY_LENGTH || publicKeyRaw[0] !== 0x04) throw new Error("INVALID_PUBLIC_KEY");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: privateKeyBase64Url.replace(/=+$/u, ""),
    x: base64UrlEncode(publicKeyRaw.slice(1, 33)),
    y: base64UrlEncode(publicKeyRaw.slice(33, 65)),
    ext: true,
  };
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: algorithm, namedCurve: "P-256" },
    false,
    algorithm === "ECDH" ? ["deriveBits"] : ["sign"],
  );
}

export type EncryptInput = {
  plaintext: Uint8Array;
  /** 구독의 keys.p256dh(base64url, 65바이트). */
  p256dh: string;
  /** 구독의 keys.auth(base64url, 16바이트). */
  auth: string;
  /** 테스트 벡터용. 평소에는 매번 새로 만든다. */
  salt?: Uint8Array;
  ephemeralKeys?: EphemeralKeys;
};

/** RFC 8291: 구독 공개키로 본문을 aes128gcm 한 record로 암호화해 요청 body 전체(헤더 포함)를 돌려준다. */
export async function encryptWebPushPayload(input: EncryptInput): Promise<Uint8Array> {
  if (input.plaintext.length > MAX_PLAINTEXT_LENGTH) throw new Error("PAYLOAD_TOO_LARGE");
  const userAgentPublicKey = base64UrlDecode(input.p256dh);
  const authSecret = base64UrlDecode(input.auth);
  if (userAgentPublicKey.length !== P256_PUBLIC_KEY_LENGTH || userAgentPublicKey[0] !== 0x04) {
    throw new Error("INVALID_SUBSCRIPTION_KEY");
  }
  if (authSecret.length !== AUTH_SECRET_LENGTH) throw new Error("INVALID_SUBSCRIPTION_AUTH");

  const salt = input.salt ?? crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  if (salt.length !== SALT_LENGTH) throw new Error("INVALID_SALT");
  const local = input.ephemeralKeys ?? (await generateEphemeralKeys());

  const userAgentKey = await crypto.subtle.importKey(
    "raw",
    buffer(userAgentPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: userAgentKey }, local.privateKey, 256),
  );

  const keyInfo = concat(textEncoder.encode("WebPush: info\0"), userAgentPublicKey, local.publicKeyRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const contentEncryptionKey = await hkdf(salt, ikm, textEncoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, textEncoder.encode("Content-Encoding: nonce\0"), 12);

  // 마지막(유일한) record: 본문 뒤에 delimiter 0x02, 추가 padding 없음.
  const padded = concat(input.plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", buffer(contentEncryptionKey), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: buffer(nonce), tagLength: 128 }, aesKey, buffer(padded)),
  );

  const header = new Uint8Array(SALT_LENGTH + 4 + 1 + local.publicKeyRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(SALT_LENGTH, RECORD_SIZE, false);
  header[SALT_LENGTH + 4] = local.publicKeyRaw.length;
  header.set(local.publicKeyRaw, SALT_LENGTH + 5);
  return concat(header, ciphertext);
}

export type VapidKeys = {
  /** 비압축 P-256 공개키(base64url, 65바이트). 브라우저 구독의 applicationServerKey와 같은 값. */
  publicKey: string;
  /** P-256 개인키 d(base64url, 32바이트). */
  privateKey: string;
  /** 연락처: mailto: 또는 https: URL. */
  subject: string;
};

/** VAPID JWT 유효 시간. 표준 상한은 24시간이며, 시계 차이를 감안해 12시간으로 둔다. */
const VAPID_TOKEN_SECONDS = 12 * 60 * 60;

/** RFC 8292: 푸시 서비스 출처(aud)에 대한 ES256 JWT로 `Authorization: vapid t=…, k=…` 값을 만든다. */
export async function createVapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  now: Date = new Date(),
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = base64UrlEncode(textEncoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(
    textEncoder.encode(
      JSON.stringify({ aud: audience, exp: Math.floor(now.getTime() / 1000) + VAPID_TOKEN_SECONDS, sub: keys.subject }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const privateKey = await importP256PrivateKey(keys.privateKey, base64UrlDecode(keys.publicKey), "ECDSA");
  // WebCrypto ECDSA 서명은 JWS ES256이 요구하는 r||s(64바이트) 형식 그대로다.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, buffer(textEncoder.encode(signingInput))),
  );
  return `vapid t=${signingInput}.${base64UrlEncode(signature)}, k=${keys.publicKey}`;
}

/** VAPID 키 한 쌍을 만든다(scripts/generate-vapid-keys.mjs와 테스트용). */
export async function generateVapidKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!jwk.d) throw new Error("VAPID_KEY_EXPORT_FAILED");
  return { publicKey: base64UrlEncode(publicKeyRaw), privateKey: jwk.d };
}
