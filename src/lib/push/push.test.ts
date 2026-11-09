import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { detectPushSupport } from "@/components/push/push-client";
import { readPushConfig } from "./config";
import { pushMessages } from "./messages";
import { deliverPush, type PushDeliveryDeps } from "./notify";
import { sendWebPush } from "./send";
import type { StoredPushTarget } from "./store";
import { parsePushSubscriptionInput } from "./subscription-input";
import { generateVapidKeyPair } from "./web-push-crypto";

const P256DH = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH = "BTBZMqHH6r4Tts7J_aSIgg";

function target(id: string, profileId: string): StoredPushTarget {
  return { id, profileId, endpoint: `https://push.example.com/${id}`, p256dh: P256DH, auth: AUTH };
}

test("config: 두 키와 https·mailto 연락처가 있어야 켜지고, 연락처가 없으면 AUTH_URL을 쓴다", async () => {
  const keys = await generateVapidKeyPair();
  const env = (values: Record<string, string>) => (name: string) => values[name];
  assert.equal(readPushConfig(env({})), null);
  assert.equal(readPushConfig(env({ VAPID_PUBLIC_KEY: keys.publicKey })), null, "개인키 없음");
  assert.deepEqual(
    readPushConfig(env({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, AUTH_URL: "https://portal.stann.kr" })),
    { ...keys, subject: "https://portal.stann.kr" },
  );
  assert.equal(
    readPushConfig(env({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "http://insecure" })),
    null,
    "http 연락처",
  );
  assert.equal(
    readPushConfig(env({ VAPID_PUBLIC_KEY: keys.privateKey, VAPID_PRIVATE_KEY: keys.publicKey, VAPID_SUBJECT: "mailto:a@b.c" })),
    null,
    "키를 바꿔 넣음",
  );
});

test("구독 입력: https endpoint와 65바이트 p256dh·16바이트 auth만 받고 패딩을 뗀다", () => {
  const valid = { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: P256DH, auth: `${AUTH}==` } };
  assert.deepEqual(parsePushSubscriptionInput(valid), { endpoint: valid.endpoint, p256dh: P256DH, auth: AUTH });
  assert.equal(parsePushSubscriptionInput({ ...valid, endpoint: "http://push.example.com/x" }), null);
  assert.equal(parsePushSubscriptionInput({ ...valid, endpoint: `https://p.example.com/${"a".repeat(2048)}` }), null);
  assert.equal(parsePushSubscriptionInput({ ...valid, keys: { p256dh: AUTH, auth: AUTH } }), null);
  assert.equal(parsePushSubscriptionInput({ ...valid, keys: { p256dh: P256DH, auth: P256DH } }), null);
  assert.equal(parsePushSubscriptionInput({ endpoint: valid.endpoint }), null);
  assert.equal(parsePushSubscriptionInput(null), null);
});

test("발송: 키가 없으면 받는 사람을 읽지 않고 끝낸다", async () => {
  let listed = false;
  const summary = await deliverPush({ kind: "role", role: "admin" }, pushMessages.test(), {}, {
    readConfig: () => null,
    listTargets: async () => { listed = true; return []; },
    send: async () => "sent",
    record: async () => undefined,
  });
  assert.deepEqual(summary, { sent: 0, gone: 0, failed: 0 });
  assert.equal(listed, false);
});

test("발송: 모든 기기로 보내고 결과를 기기별로 남기며, 한 기기의 예외가 다른 기기를 막지 않는다", async () => {
  const keys = { ...(await generateVapidKeyPair()), subject: "mailto:a@b.c" };
  const recorded: [string, string][] = [];
  let receivedExclude: string | undefined;
  const deps: PushDeliveryDeps = {
    readConfig: () => keys,
    listTargets: async (_audience, exclude) => {
      receivedExclude = exclude;
      return [target("a", "s1"), target("b", "s1"), target("c", "s2")];
    },
    send: async (item) => {
      if (item.id === "a") return "sent";
      if (item.id === "b") return "gone";
      throw new Error("network");
    },
    record: async (id, outcome) => { recorded.push([id, outcome]); },
  };
  const summary = await deliverPush({ kind: "profiles", profileIds: ["s1", "s2"] }, pushMessages.test(), { excludeProfileId: "admin" }, deps);
  assert.deepEqual(summary, { sent: 1, gone: 1, failed: 1 });
  assert.equal(receivedExclude, "admin");
  assert.deepEqual(recorded.sort(), [["a", "sent"], ["b", "gone"], ["c", "failed"]]);
});

test("send: 성공·사라짐(404·410)·일시 실패를 나누고 표준 헤더로 보낸다", async () => {
  const keys = { ...(await generateVapidKeyPair()), subject: "mailto:a@b.c" };
  const calls: { url: string; init: RequestInit }[] = [];
  const respond = (status: number) => (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as typeof fetch;
  const item = target("a", "s1");
  assert.equal(await sendWebPush(item, pushMessages.test(), keys, respond(201)), "sent");
  assert.equal(await sendWebPush(item, pushMessages.test(), keys, respond(410)), "gone");
  assert.equal(await sendWebPush(item, pushMessages.test(), keys, respond(404)), "gone");
  assert.equal(await sendWebPush(item, pushMessages.test(), keys, respond(429)), "failed");
  assert.equal(await sendWebPush(item, pushMessages.test(), keys, (async () => { throw new Error("down"); }) as typeof fetch), "failed");
  assert.equal(await sendWebPush({ ...item, endpoint: "http://push.example.com/a" }, pushMessages.test(), keys, respond(201)), "gone");
  assert.equal(await sendWebPush({ ...item, p256dh: "broken" }, pushMessages.test(), keys, respond(201)), "gone");

  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(calls[0]!.url, item.endpoint);
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(headers["Content-Encoding"], "aes128gcm");
  assert.equal(headers.TTL, "86400");
  assert.match(headers.Authorization!, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/u);
});

test("메시지: 눌렀을 때 열 포탈 경로와 같은 대상의 알림을 바꿔 쓰는 tag를 둔다", () => {
  const feedback = pushMessages.feedbackAdded({ assignmentId: "a 1", title: "6주차 믹스 녹음" });
  assert.deepEqual(feedback, {
    category: "feedback",
    title: "새 피드백",
    body: "‘6주차 믹스 녹음’에 피드백이 달렸습니다.",
    url: "/dashboard/student/assignments/a%201",
    tag: "feedback:a 1",
  });
  assert.equal(pushMessages.feedbackAdded({ assignmentId: "a", title: null }).body, "제출한 과제에 피드백이 달렸습니다.");
  const acknowledged = pushMessages.assignmentAcknowledged({ assignmentId: "a 1", title: "6주차 믹스 녹음" });
  assert.deepEqual(acknowledged, {
    category: "feedback",
    title: "Stann이 과제를 확인했습니다",
    body: "‘6주차 믹스 녹음’",
    url: "/dashboard/student/assignments/a%201",
    tag: feedback.tag,
  }, "뒤에 오는 피드백 알림이 확인 알림을 바꾸도록 같은 tag");
  assert.equal(pushMessages.assignmentAcknowledged({ assignmentId: "a", title: null }).body, "제출한 과제");
  const long = pushMessages.announcementPosted({ postId: "p", title: "가".repeat(60) });
  assert.equal(long.body, `‘${"가".repeat(39)}…’`);
  assert.equal(long.url, "/community/p");
  const lesson = pushMessages.lessonScheduled({ lessonId: "l", scheduledAt: new Date("2026-11-10T05:00:00Z"), changed: true });
  assert.equal(lesson.body, "레슨 시간 변경: 11.10 14:00");
  assert.equal(
    lesson.url,
    "/dashboard/student?section=workspace&view=calendar&date=2026-11-10&item=PORTAL%3ALESSON%3Al",
    "학생 레슨 알림은 KST 날짜와 그 레슨 상세로 간다",
  );
  const lateNight = pushMessages.lessonScheduled({ lessonId: "l", scheduledAt: new Date("2026-11-10T16:30:00Z"), changed: false });
  assert.match(lateNight.url, /date=2026-11-11&/u, "UTC 자정 뒤 KST 날짜를 쓴다");
  const moved = pushMessages.lessonScheduled({ lessonId: "l", scheduledAt: new Date("2026-11-10T05:00:00Z"), changed: true, toAdmin: true, studentName: "김학생" });
  assert.equal(moved.body, "김학생님이 레슨을 옮겼습니다: 11.10 14:00");
  assert.equal(moved.url, "/dashboard/calendar", "관리자 알림은 관리자 캘린더 그대로");
  assert.equal(
    pushMessages.assignmentAssigned({ taskId: "t 1", title: "셋", dueAt: null }).url,
    "/dashboard/student/assignments?task=t%201",
    "새 과제 알림은 그 과제가 펼쳐진 목록",
  );
  assert.equal(
    pushMessages.assignmentAssigned({ taskId: "t 1", title: "분석", dueAt: null, analysis: true }).url,
    "/dashboard/student/assignments/analysis/t%201",
    "분석 과제는 분석 쓰기 화면",
  );
  assert.equal(pushMessages.replyAdded({ threadId: "t", authorName: "Stann", title: "큐", toStudent: true }).title, "Q&A 답변");
  assert.equal(pushMessages.replyAdded({ threadId: "t", authorName: "김학생", title: "큐", toStudent: false }).body, "김학생님 답글: ‘큐’");
  for (const message of [feedback, long, lesson, moved, pushMessages.test()]) {
    assert.ok(message.url.startsWith("/") && !message.url.startsWith("//"), "같은 출처 경로");
    assert.ok(new TextEncoder().encode(JSON.stringify(message)).length < 1000, "한 record에 넉넉히 들어간다");
  }
});

test("지원 판정: iPhone·iPad Safari 탭은 홈 화면 추가가 필요하고, 홈 화면 앱·푸시 API가 있는 브라우저는 지원한다", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const apis = { PushManager: {}, Notification: {} };
  const tab = { matchMedia: () => ({ matches: false }), ...apis };
  const installed = { matchMedia: () => ({ matches: true }), ...apis };
  assert.equal(detectPushSupport({ userAgent: iphone, maxTouchPoints: 5, serviceWorker: {} }, tab), "needs-install");
  assert.equal(detectPushSupport({ userAgent: ipad, maxTouchPoints: 5, serviceWorker: {} }, tab), "needs-install");
  assert.equal(detectPushSupport({ userAgent: iphone, maxTouchPoints: 5, serviceWorker: {} }, installed), "supported");
  assert.equal(detectPushSupport({ userAgent: ipad, maxTouchPoints: 0, serviceWorker: {} }, tab), "supported", "데스크톱 Mac Safari");
  assert.equal(detectPushSupport({ userAgent: "Mozilla/5.0 (Linux; Android 14)", maxTouchPoints: 5 }, tab), "unsupported", "Service Worker 없음");
});

test("proxy: sw.js·manifest는 로그인 없이 받고, 비슷한 다른 경로는 계속 보호한다", async () => {
  const source = await readFile(new URL("../../proxy.ts", import.meta.url), "utf8");
  const pattern = /matcher:\s*\[\s*"([^"]+)"/u.exec(source)?.[1];
  assert.ok(pattern);
  const matcher = new RegExp(`^${pattern.replace(/\\\\/gu, "\\")}$`, "u");
  assert.equal(matcher.test("/sw.js"), false);
  assert.equal(matcher.test("/manifest.webmanifest"), false);
  assert.equal(matcher.test("/icons/icon-192.png"), false);
  assert.equal(matcher.test("/sw.jsx"), true);
  assert.equal(matcher.test("/dashboard/sw.js"), true);
  assert.equal(matcher.test("/dashboard"), true);
});
