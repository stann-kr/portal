import { base64UrlDecode } from "@/lib/push/web-push-crypto";

/**
 * 이 브라우저의 웹 푸시 가능 여부.
 * needs-install: iPhone·iPad Safari 탭(홈 화면에 추가한 앱에서만 푸시를 받는다).
 */
export type PushSupport = "supported" | "needs-install" | "unsupported";

type NavigatorLike = Pick<Navigator, "userAgent" | "maxTouchPoints"> & { standalone?: boolean; serviceWorker?: unknown };
type WindowLike = { matchMedia?: (query: string) => { matches: boolean }; PushManager?: unknown; Notification?: unknown };

export function detectPushSupport(nav: NavigatorLike, win: WindowLike): PushSupport {
  // iPadOS Safari는 데스크톱 Mac처럼 보이므로 터치 지점으로 구분한다.
  const isAppleMobile = /iPhone|iPad|iPod/u.test(nav.userAgent) || (/Macintosh/u.test(nav.userAgent) && nav.maxTouchPoints > 1);
  const standalone = win.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
  if (isAppleMobile && !standalone) return "needs-install";
  const hasApis = Boolean(nav.serviceWorker) && Boolean(win.PushManager) && Boolean(win.Notification);
  return hasApis ? "supported" : "unsupported";
}

export function readPushSupport(): PushSupport {
  return detectPushSupport(window.navigator as NavigatorLike, window as unknown as WindowLike);
}

export function readNotificationPermission(): NotificationPermission | null {
  return typeof Notification === "undefined" ? null : Notification.permission;
}

async function registerWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

/** 이 기기의 현재 구독(없으면 null). Service Worker를 새로 등록하지 않는다. */
export async function readCurrentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

function sameKey(subscription: PushSubscription, publicKey: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === publicKey.length && bytes.every((value, index) => value === publicKey[index]);
}

/**
 * 알림 권한을 묻고 이 기기를 구독한다. iPhone은 사용자가 누른 직후에만 권한을 물을 수 있어 버튼 handler에서 바로 부른다.
 * 서버 키가 바뀌었으면 옛 구독을 지우고 새로 만든다.
 */
export async function subscribeThisDevice(publicKey: string): Promise<PushSubscription | "denied"> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const registration = await registerWorker();
  const key = base64UrlDecode(publicKey);
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameKey(existing, key)) return existing;
  if (existing) await existing.unsubscribe().catch(() => false);
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as Uint8Array<ArrayBuffer> });
}

const OWNER_STORAGE_KEY = "portal:push-owner";

/** 이 기기 구독을 켠 계정. 세션이 만료된 뒤 다른 계정이 로그인하면 앞 계정의 구독을 이어 쓰지 않는다. */
export function readPushOwner(): string | null {
  try {
    return window.localStorage.getItem(OWNER_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writePushOwner(ownerId: string | null): void {
  try {
    if (ownerId) window.localStorage.setItem(OWNER_STORAGE_KEY, ownerId);
    else window.localStorage.removeItem(OWNER_STORAGE_KEY);
  } catch {
    // 저장소를 쓸 수 없으면 주인 확인 없이 해제 쪽으로 동작한다(readPushOwner가 null).
  }
}

/** 이 기기 구독을 브라우저에서 해제한다. 해제한 endpoint를 돌려준다(서버 행 삭제용). */
export async function unsubscribeThisDevice(): Promise<string | null> {
  const subscription = await readCurrentSubscription();
  if (!subscription) return null;
  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => false);
  writePushOwner(null);
  return endpoint;
}

/**
 * 로그아웃 때 이 기기 구독을 브라우저에서 해제한다. 해제된 endpoint는 푸시 서비스가 410으로 답해 서버 행도 지워지므로,
 * 공유 기기에서 다음 사람에게 앞 계정의 알림이 가지 않는다. 오래 걸리면 기다리지 않는다.
 */
export async function releaseThisDeviceForLogout(timeoutMs = 2_000): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  await Promise.race([
    unsubscribeThisDevice().catch(() => null),
    new Promise((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}
