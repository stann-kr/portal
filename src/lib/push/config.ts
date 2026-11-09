import { readRuntimeEnv } from "@/lib/runtime-env";
import { base64UrlDecode, type VapidKeys } from "./web-push-crypto";

/**
 * 웹 푸시 발신 키(VAPID). VAPID_PUBLIC_KEY·VAPID_PRIVATE_KEY가 모두 있어야 기능이 켜진다(없으면 null: 알림 없이 동작).
 * 연락처(sub)는 VAPID_SUBJECT, 없으면 AUTH_URL(https 포탈 주소)을 쓴다.
 */
export function readPushConfig(read: (name: string) => string | undefined = readRuntimeEnv): VapidKeys | null {
  const publicKey = read("VAPID_PUBLIC_KEY");
  const privateKey = read("VAPID_PRIVATE_KEY");
  const subject = read("VAPID_SUBJECT") ?? read("AUTH_URL");
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(?:mailto:|https:\/\/)/u.test(subject)) return null;
  try {
    const publicBytes = base64UrlDecode(publicKey);
    const privateBytes = base64UrlDecode(privateKey);
    if (publicBytes.length !== 65 || publicBytes[0] !== 0x04 || privateBytes.length !== 32) return null;
  } catch {
    return null;
  }
  return { publicKey, privateKey, subject };
}
