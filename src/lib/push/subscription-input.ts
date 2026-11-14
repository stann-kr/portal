import { isAllowedPushEndpoint, type PushTarget } from "./send";
import { base64UrlDecode } from "./web-push-crypto";

/**
 * 브라우저 PushSubscription.toJSON()에서 받은 값을 저장 가능한 구독으로 좁힌다.
 * endpoint는 알려진 푸시 서비스의 https 주소·2048자 이하(`isAllowedPushEndpoint`), p256dh는 비압축 P-256 공개키(65바이트), auth는 16바이트여야 한다.
 */
export function parsePushSubscriptionInput(input: unknown): PushTarget | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as { endpoint?: unknown; keys?: unknown };
  const keys = (typeof record.keys === "object" && record.keys !== null ? record.keys : {}) as { p256dh?: unknown; auth?: unknown };
  const { endpoint } = record;
  const { p256dh, auth } = keys;
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (!isAllowedPushEndpoint(endpoint)) return null;
  try {
    const publicKey = base64UrlDecode(p256dh);
    const secret = base64UrlDecode(auth);
    if (publicKey.length !== 65 || publicKey[0] !== 0x04 || secret.length !== 16) return null;
  } catch {
    return null;
  }
  // 저장 형식은 패딩 없는 base64url로 맞춘다(CHECK 길이 범위 안).
  return { endpoint, p256dh: p256dh.replace(/=+$/u, ""), auth: auth.replace(/=+$/u, "") };
}
