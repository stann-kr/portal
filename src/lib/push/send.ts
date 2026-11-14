import type { PushMessage } from "./messages";
import { createVapidAuthorization, encryptWebPushPayload, type VapidKeys } from "./web-push-crypto";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** sent: 푸시 서비스가 받음. gone: 구독이 사라짐(지운다). failed: 일시 실패·거부(다음에 다시 보낸다). */
export type PushSendOutcome = "sent" | "gone" | "failed";

/** 기기가 꺼져 있으면 푸시 서비스가 이 시간(초)까지 보관했다가 전달한다. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const PUSH_REQUEST_TIMEOUT_MS = 10_000;

/**
 * 브라우저가 구독 주소로 주는 푸시 서비스 host(이 이름 자체 또는 그 하위 host).
 * Chrome·Edge(Android)·Samsung·Opera·Brave는 FCM, Firefox는 Mozilla, Safari·홈 화면 앱은 Apple, Windows Edge는 WNS다.
 * 목록에 없는 브라우저는 알림을 켤 수 없다(2026-11-14 사용자 결정: 로그인한 사용자가 임의 주소를 등록해
 * 서버가 그 주소로 요청을 보내게 하는 것을 막는다).
 */
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return false;
    const host = url.hostname.toLowerCase();
    return PUSH_SERVICE_HOSTS.some((service) => host === service || host.endsWith(`.${service}`));
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
