import { savePushSubscription } from "@/lib/actions/push";
import { readNotificationPermission, subscribeThisDevice, writePushOwner } from "./push-client";

export type EnableDeviceResult =
  | { kind: "enabled" }
  | { kind: "blocked" }
  | { kind: "dismissed" }
  | { kind: "failed"; error: string };

const ENABLE_FAILED = "알림을 켜지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

/**
 * 이 기기 알림을 켠다(알림 설정 스위치와 홈의 "알림 받기" 줄이 함께 쓴다).
 * 권한 요청이 첫 await라 누른 handler에서 바로 불러야 iPhone이 허용 창을 띄운다. 서버 공개키는 미리 받아 둔다.
 */
export async function enablePushOnThisDevice(publicKey: string, ownerId: string): Promise<EnableDeviceResult> {
  try {
    const subscription = await subscribeThisDevice(publicKey);
    if (subscription === "denied") {
      return readNotificationPermission() === "denied" ? { kind: "blocked" } : { kind: "dismissed" };
    }
    const saved = await savePushSubscription(subscription.toJSON());
    if (!saved.ok) {
      await subscription.unsubscribe().catch(() => false);
      return { kind: "failed", error: saved.error };
    }
    writePushOwner(ownerId);
    return { kind: "enabled" };
  } catch {
    return { kind: "failed", error: ENABLE_FAILED };
  }
}

/** 알림 설정 대화상자를 연다(계정 메뉴가 데스크톱·서랍 두 곳에 있어도 한 곳만 연다). */
export const OPEN_NOTIFICATION_SETTINGS_EVENT = "portal:open-notification-settings";

export function requestOpenNotificationSettings(): void {
  window.dispatchEvent(new CustomEvent(OPEN_NOTIFICATION_SETTINGS_EVENT, { cancelable: true }));
}
