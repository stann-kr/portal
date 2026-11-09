/*
 * Portal - Stann Service Worker — 웹 푸시 표시와 알림 클릭만 맡는다.
 * fetch를 가로채거나 캐시하지 않는다(문서 편집의 서버 저장·초안 흐름을 바꾸지 않기 위해).
 */
const DEFAULT_URL = "/dashboard";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch {
    return { title: "Portal - Stann", body: event.data.text() };
  }
}

/** 같은 출처의 경로만 연다. 다른 출처·잘못된 값은 대시보드로 연다. */
function safePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return DEFAULT_URL;
  return value;
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event) || {};
  const title = typeof payload.title === "string" && payload.title ? payload.title : "Portal - Stann";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    lang: "ko",
    data: { url: safePath(payload.url) },
  };
  if (typeof payload.tag === "string" && payload.tag) {
    options.tag = payload.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if (client.url !== target && "navigate" in client) await client.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/* 브라우저가 구독을 바꾸면 열린 화면이 다음에 열릴 때 다시 등록한다(서버 갱신은 화면의 구독 확인이 맡는다). */
self.addEventListener("pushsubscriptionchange", () => {});
