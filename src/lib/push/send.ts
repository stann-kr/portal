import type { PushMessage } from "./messages";
import { createVapidAuthorization, encryptWebPushPayload, type VapidKeys } from "./web-push-crypto";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** sent: 푸시 서비스가 받음. gone: 구독이 사라짐(지운다). failed: 일시 실패·거부(다음에 다시 보낸다). */
export type PushSendOutcome = "sent" | "gone" | "failed";

/** 기기가 꺼져 있으면 푸시 서비스가 이 시간(초)까지 보관했다가 전달한다. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const PUSH_REQUEST_TIMEOUT_MS = 10_000;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && endpoint.length <= 2048;
  } catch {
    return false;
  }
}

/** 한 기기로 알림 한 건을 암호화해 보낸다. 예외를 던지지 않고 결과만 돌려준다. */
export async function sendWebPush(
  target: PushTarget,
  message: PushMessage,
  keys: VapidKeys,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<PushSendOutcome> {
  if (!isAllowedPushEndpoint(target.endpoint)) return "gone";
  let body: Uint8Array;
  let authorization: string;
  try {
    body = await encryptWebPushPayload({
      plaintext: new TextEncoder().encode(JSON.stringify(message)),
      p256dh: target.p256dh,
      auth: target.auth,
    });
    authorization = await createVapidAuthorization(target.endpoint, keys, now);
  } catch {
    // 저장된 구독 키가 망가졌다: 다시 보내도 같은 결과다.
    return "gone";
  }
  try {
    const response = await fetchImpl(target.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: "normal",
      },
      body: body as Uint8Array<ArrayBuffer>,
      signal: AbortSignal.timeout(PUSH_REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return "sent";
    if (response.status === 404 || response.status === 410) return "gone";
    return "failed";
  } catch {
    return "failed";
  }
}
