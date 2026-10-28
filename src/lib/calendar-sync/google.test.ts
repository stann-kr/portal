import assert from "node:assert/strict";
import test from "node:test";
import { createFakeFetch, jsonResponse } from "./fake-fetch";
import {
  GOOGLE_CALENDAR_SCOPES,
  assertGoogleUrl,
  buildGoogleAuthUrl,
  computePkceChallenge,
  createGoogleCalendarClient,
  createPkcePair,
  decodeGoogleCursor,
  deriveGoogleEventId,
  exchangeGoogleCode,
  fetchGoogleAccountLabel,
  refreshGoogleAccessToken,
  revokeGoogleToken,
  stopGoogleChannel,
  watchGoogleCalendar,
} from "./google";
import {
  CalendarAuthError,
  CalendarConflictError,
  CalendarNotFoundError,
  CalendarProviderError,
  CalendarRateLimitError,
} from "./types";

const WINDOW = { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2027-08-01T00:00:00Z") };
const CAL = "teacher.student-a@group.calendar.google.com";

function tokenProvider() {
  const requests: boolean[] = [];
  return {
    requests,
    getAccessToken: async ({ forceRefresh }: { forceRefresh: boolean }) => {
      requests.push(forceRefresh);
      return forceRefresh ? "fresh-token" : "stale-token";
    },
  };
}

function googleError(status: number, reason: string) {
  return jsonResponse({ error: { code: status, message: "x", errors: [{ reason, domain: "global" }] } }, status);
}

const timed = {
  kind: "calendar#event",
  id: "evt1",
  etag: '"3401"',
  status: "confirmed",
  summary: "레슨",
  description: "메모",
  updated: "2026-10-01T00:00:00.000Z",
  start: { dateTime: "2026-11-01T19:00:00+09:00", timeZone: "Asia/Seoul" },
  end: { dateTime: "2026-11-01T20:00:00+09:00", timeZone: "Asia/Seoul" },
  extendedProperties: { private: { portalRef: "lesson:42" } },
};

test("OAuth URL은 최소 scope·offline·consent·PKCE S256을 쓴다", async () => {
  const pair = await createPkcePair();
  assert.match(pair.codeVerifier, /^[A-Za-z0-9_-]{43,128}$/u);
  assert.equal(pair.codeChallenge, await computePkceChallenge(pair.codeVerifier));
  // RFC 7636 Appendix B 예시
  assert.equal(await computePkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const url = new URL(buildGoogleAuthUrl({ clientId: "cid", redirectUri: "https://portal.example/cb", state: "st", codeChallenge: pair.codeChallenge }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), GOOGLE_CALENDAR_SCOPES.join(" "));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "st");
});

test("code 교환은 form body로 보내고 만료 시각·refresh token을 돌려준다", async () => {
  const fake = createFakeFetch([
    () => jsonResponse({ access_token: "at", expires_in: 3599, refresh_token: "rt", scope: GOOGLE_CALENDAR_SCOPES.join(" "), token_type: "Bearer" }),
  ]);
  const now = new Date("2026-10-27T00:00:00Z");
  const tokens = await exchangeGoogleCode({ clientId: "cid", clientSecret: "sec", code: "c", redirectUri: "https://p/cb", codeVerifier: "v", fetchImpl: fake.fetchImpl, now });
  assert.equal(tokens.accessToken, "at");
  assert.equal(tokens.refreshToken, "rt");
  assert.equal(tokens.expiresAt.toISOString(), "2026-10-27T00:59:59.000Z");
  assert.equal(fake.calls[0].url, "https://oauth2.googleapis.com/token");
  const body = new URLSearchParams(fake.calls[0].body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code_verifier"), "v");
});

test("calendar.events scope를 빼고 동의하면 CalendarAuthError", async () => {
  const fake = createFakeFetch([() => jsonResponse({ access_token: "at", expires_in: 3600, scope: GOOGLE_CALENDAR_SCOPES[1] })]);
  await assert.rejects(
    exchangeGoogleCode({ clientId: "c", clientSecret: "s", code: "c", redirectUri: "https://p/cb", codeVerifier: "v", fetchImpl: fake.fetchImpl }),
    (error) => error instanceof CalendarAuthError && error.reason === "insufficient_scope",
  );
});

test("refresh의 invalid_grant는 CalendarAuthError이며 message에 token이 없다", async () => {
  const fake = createFakeFetch([() => jsonResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400)]);
  await assert.rejects(
    refreshGoogleAccessToken({ clientId: "c", clientSecret: "secret-x", refreshToken: "refresh-secret", fetchImpl: fake.fetchImpl }),
    (error) => error instanceof CalendarAuthError && error.reason === "invalid_grant" && !/secret/u.test(error.message),
  );
  const ok = createFakeFetch([() => jsonResponse({ access_token: "new", expires_in: 3600 })]);
  const refreshed = await refreshGoogleAccessToken({ clientId: "c", clientSecret: "s", refreshToken: "r", fetchImpl: ok.fetchImpl });
  assert.equal(refreshed.accessToken, "new");
  assert.equal(refreshed.refreshToken, undefined);
  assert.equal(new URLSearchParams(ok.calls[0].body).get("grant_type"), "refresh_token");
});

test("revoke는 이미 무효한 token을 성공으로 본다", async () => {
  const fake = createFakeFetch([() => jsonResponse({ error: "invalid_token" }, 400), () => new Response("", { status: 200 })]);
  await revokeGoogleToken({ token: "t", fetchImpl: fake.fetchImpl });
  await revokeGoogleToken({ token: "t", fetchImpl: fake.fetchImpl });
  assert.equal(fake.calls[0].url, "https://oauth2.googleapis.com/revoke");
});

test("계정 라벨은 calendarList/primary의 id다", async () => {
  const fake = createFakeFetch([() => jsonResponse({ id: "teacher@gmail.com", accessRole: "owner" })]);
  assert.equal(await fetchGoogleAccountLabel({ accessToken: "a", fetchImpl: fake.fetchImpl }), "teacher@gmail.com");
  assert.equal(fake.calls[0].url, "https://www.googleapis.com/calendar/v3/users/me/calendarList/primary");
  assert.equal(fake.calls[0].headers.authorization, "Bearer a");
});

test("host allowlist는 Google 3개 host의 https만 허용한다", () => {
  assert.ok(assertGoogleUrl("https://www.googleapis.com/calendar/v3/x"));
  for (const url of [
    "http://www.googleapis.com/x",
    "https://evil.example/x",
    "https://www.googleapis.com.evil.example/x",
    "https://user:pw@www.googleapis.com/x",
    "https://www.googleapis.com:8443/x",
    "not a url",
  ]) {
    assert.throws(() => assertGoogleUrl(url), CalendarProviderError, url);
  }
});

test("calendarList는 page를 따라가며 owner/writer 외는 readOnly로 표시한다", async () => {
  const fake = createFakeFetch([
    () =>
      jsonResponse({
        items: [
          { id: "primary@gmail.com", summary: "Me", accessRole: "owner", backgroundColor: "#9FE1E7" },
          { id: "holidays", summary: "공휴일", accessRole: "reader" },
        ],
        nextPageToken: "p2",
      }),
    () => jsonResponse({ items: [{ id: CAL, summary: "s", summaryOverride: "학생 A", accessRole: "writer" }, { id: "gone", deleted: true, accessRole: "owner" }] }),
  ]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  const calendars = await client.listCalendars();
  assert.deepEqual(calendars, [
    { id: "primary@gmail.com", name: "Me", color: "#9fe1e7", readOnly: false },
    { id: "holidays", name: "공휴일", readOnly: true },
    { id: CAL, name: "학생 A", readOnly: false },
  ]);
  assert.equal(new URL(fake.calls[1].url).searchParams.get("pageToken"), "p2");
});

test("초기 pull은 window·singleEvents=false로 page를 끝까지 읽고 nextSyncToken을 cursor로 만든다", async () => {
  const fake = createFakeFetch([
    () =>
      jsonResponse({
        items: [
          timed,
          { id: "master1", etag: '"m"', status: "confirmed", summary: "주간", recurrence: ["RRULE:FREQ=WEEKLY"], start: { dateTime: "2026-11-02T10:00:00Z" }, end: { dateTime: "2026-11-02T11:00:00Z" } },
        ],
        nextPageToken: "page-2",
      }),
    () =>
      jsonResponse({
        items: [
          { id: "allday", etag: '"a"', status: "confirmed", summary: "종일", start: { date: "2026-11-05" }, end: { date: "2026-11-07" } },
          { id: "master1_20261109T100000Z", etag: '"x"', status: "confirmed", recurringEventId: "master1", start: { dateTime: "2026-11-09T12:00:00Z" }, end: { dateTime: "2026-11-09T13:00:00Z" } },
          { id: "ooo", etag: '"o"', status: "confirmed", eventType: "outOfOffice", start: { dateTime: "2026-11-09T12:00:00Z" }, end: { dateTime: "2026-11-09T13:00:00Z" } },
          { id: "old-cancel", status: "cancelled" },
        ],
        nextSyncToken: "SYNC-1",
      }),
  ]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  const result = await client.pull(CAL, null, WINDOW);
  const first = new URL(fake.calls[0].url);
  assert.equal(first.pathname, `/calendar/v3/calendars/${encodeURIComponent(CAL)}/events`);
  assert.equal(first.searchParams.get("timeMin"), WINDOW.from.toISOString());
  assert.equal(first.searchParams.get("timeMax"), WINDOW.to.toISOString());
  assert.equal(first.searchParams.get("singleEvents"), "false");
  assert.equal(first.searchParams.get("showDeleted"), "true");
  assert.equal(first.searchParams.get("syncToken"), null);
  assert.equal(new URL(fake.calls[1].url).searchParams.get("pageToken"), "page-2");

  assert.equal(result.fullResync, false);
  assert.deepEqual(decodeGoogleCursor(result.nextCursor), { v: 1, syncToken: "SYNC-1" });
  assert.deepEqual(result.deletedRemoteIds, ["old-cancel"]);
  assert.deepEqual(result.changed.map((event) => event.remoteId), ["evt1", "master1", "allday", "master1_20261109T100000Z"]);
  const [lesson, master, allDay, exception] = result.changed;
  assert.equal(lesson.start.toISOString(), "2026-11-01T10:00:00.000Z");
  assert.equal(lesson.portalRef, "lesson:42");
  assert.equal(lesson.etag, '"3401"');
  assert.equal(lesson.recurring, false);
  assert.equal(master.recurring, true);
  assert.equal(exception.recurring, true);
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.allDayStartDate, "2026-11-05");
  assert.equal(allDay.allDayEndDate, "2026-11-07");
  assert.equal(allDay.start.toISOString(), "2026-11-04T15:00:00.000Z");
});

test("증분 pull은 syncToken만 보내고 cancelled를 deletedRemoteIds로 준다", async () => {
  const fake = createFakeFetch([
    () => jsonResponse({ items: [{ ...timed, summary: "바뀜", etag: '"3402"' }, { id: "evt2", status: "cancelled" }], nextSyncToken: "SYNC-2" }),
  ]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  const result = await client.pull(CAL, JSON.stringify({ v: 1, syncToken: "SYNC-1" }), WINDOW);
  const params = new URL(fake.calls[0].url).searchParams;
  assert.equal(params.get("syncToken"), "SYNC-1");
  for (const forbidden of ["timeMin", "timeMax", "updatedMin", "orderBy", "q", "privateExtendedProperty"]) {
    assert.equal(params.get(forbidden), null, forbidden);
  }
  assert.equal(params.get("singleEvents"), "false");
  assert.deepEqual(result.changed.map((event) => [event.remoteId, event.title, event.etag]), [["evt1", "바뀜", '"3402"']]);
  assert.deepEqual(result.deletedRemoteIds, ["evt2"]);
  assert.deepEqual(decodeGoogleCursor(result.nextCursor), { v: 1, syncToken: "SYNC-2" });
});

test("410 GONE과 깨진 cursor는 fullResync 결과다", async () => {
  const fake = createFakeFetch([() => googleError(410, "fullSyncRequired")]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  assert.deepEqual(await client.pull(CAL, JSON.stringify({ v: 1, syncToken: "old" }), WINDOW), {
    changed: [],
    deletedRemoteIds: [],
    nextCursor: "",
    fullResync: true,
  });
  assert.equal((await client.pull(CAL, "garbage", WINDOW)).fullResync, true);
  assert.equal(fake.remaining(), 0);
});

test("초기 응답에 nextSyncToken이 없으면 updatedMin cursor로 대체한다", async () => {
  const fake = createFakeFetch([() => jsonResponse({ items: [] }), () => jsonResponse({ items: [], nextSyncToken: "S" })]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl, now: () => new Date("2026-10-27T00:10:00Z") });
  const first = await client.pull(CAL, null, WINDOW);
  assert.deepEqual(decodeGoogleCursor(first.nextCursor), { v: 1, updatedMin: "2026-10-27T00:05:00.000Z" });
  await client.pull(CAL, first.nextCursor, WINDOW);
  const params = new URL(fake.calls[1].url).searchParams;
  assert.equal(params.get("updatedMin"), "2026-10-27T00:05:00.000Z");
  assert.equal(params.get("syncToken"), null);
});

test("401이면 forceRefresh로 한 번만 재시도하고, 다시 401이면 CalendarAuthError", async () => {
  const tokens = tokenProvider();
  const fake = createFakeFetch([() => googleError(401, "authError"), () => jsonResponse({ items: [], nextSyncToken: "S" })]);
  const client = createGoogleCalendarClient({ ...tokens, fetchImpl: fake.fetchImpl });
  await client.pull(CAL, null, WINDOW);
  assert.deepEqual(tokens.requests, [false, true]);
  assert.equal(fake.calls[0].headers.authorization, "Bearer stale-token");
  assert.equal(fake.calls[1].headers.authorization, "Bearer fresh-token");

  const again = tokenProvider();
  const failing = createFakeFetch([() => googleError(401, "authError"), () => googleError(401, "authError")]);
  await assert.rejects(createGoogleCalendarClient({ ...again, fetchImpl: failing.fetchImpl }).listCalendars(), CalendarAuthError);
  assert.deepEqual(again.requests, [false, true]);
  assert.equal(failing.remaining(), 0);
});

test("getAccessToken의 CalendarAuthError(invalid_grant)는 그대로 전파된다", async () => {
  const fake = createFakeFetch([]);
  const client = createGoogleCalendarClient({
    getAccessToken: async () => {
      throw new CalendarAuthError("revoked", { reason: "invalid_grant" });
    },
    fetchImpl: fake.fetchImpl,
  });
  await assert.rejects(client.listCalendars(), CalendarAuthError);
});

test("429와 403 rateLimitExceeded는 CalendarRateLimitError, 403 insufficientPermissions는 CalendarAuthError", async () => {
  const fake = createFakeFetch([
    () => googleError(429, "rateLimitExceeded"),
    () => googleError(403, "userRateLimitExceeded"),
    () => googleError(403, "insufficientPermissions"),
    () => googleError(403, "forbidden"),
  ]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  await assert.rejects(client.listCalendars(), CalendarRateLimitError);
  await assert.rejects(client.listCalendars(), (error) => error instanceof CalendarRateLimitError && error.reason === "userRateLimitExceeded");
  await assert.rejects(client.listCalendars(), CalendarAuthError);
  await assert.rejects(client.listCalendars(), (error) => error instanceof CalendarProviderError && error.status === 403);
});

test("create는 portalRef를 private extended property로, 시간은 UTC dateTime으로 보낸다", async () => {
  const fake = createFakeFetch([() => jsonResponse({ id: "new1", etag: '"1"' })]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  const result = await client.create(CAL, {
    title: "레슨",
    start: new Date("2026-11-01T10:00:00Z"),
    end: new Date("2026-11-01T11:00:00Z"),
    portalRef: "lesson:42",
  });
  assert.deepEqual(result, { remoteId: "new1", etag: '"1"' });
  assert.equal(fake.calls[0].method, "POST");
  assert.equal(new URL(fake.calls[0].url).searchParams.get("sendUpdates"), "none");
  const body = JSON.parse(fake.calls[0].body);
  assert.deepEqual(body.start, { dateTime: "2026-11-01T10:00:00.000Z" });
  assert.deepEqual(body.extendedProperties, { private: { portalRef: "lesson:42" } });
  assert.equal(fake.calls[0].headers["if-match"], undefined);
  // 클라이언트 지정 id: portalRef에서 결정적, Google 규칙(base32hex a-v·0-9, 5~1024자).
  assert.equal(body.id, await deriveGoogleEventId("lesson:42"));
  assert.match(body.id, /^[a-v0-9]{5,1024}$/u);
  assert.notEqual(await deriveGoogleEventId("lesson:43"), body.id);
});

test("create 409(같은 결정적 id가 이미 있음)는 사본을 만들지 않고 그 id를 읽어 If-Match PATCH로 맞추며 삭제된 일정은 confirmed로 되살린다", async () => {
  const id = await deriveGoogleEventId("lesson:42");
  const fake = createFakeFetch([
    () => googleError(409, "duplicate"),
    () => jsonResponse({ ...timed, id, etag: '"9"', status: "cancelled" }),
    () => jsonResponse({ id, etag: '"10"' }),
  ]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  const result = await client.create(CAL, { title: "레슨", start: new Date("2026-11-01T10:00:00Z"), end: new Date("2026-11-01T11:00:00Z"), portalRef: "lesson:42" });
  assert.deepEqual(result, { remoteId: id, etag: '"10"' });
  assert.deepEqual(fake.calls.map((call) => call.method), ["POST", "GET", "PATCH"]);
  assert.equal(new URL(fake.calls[1].url).pathname.endsWith(`/events/${id}`), true);
  assert.equal(fake.calls[2].headers["if-match"], '"9"');
  const body = JSON.parse(fake.calls[2].body);
  assert.equal(body.status, "confirmed");
  assert.equal(body.id, undefined);
  assert.deepEqual(body.extendedProperties, { private: { portalRef: "lesson:42" } });
});

test("get은 events/{id}를 읽고 404·410·취소된 일정은 null, 그 밖 오류는 throw한다", async () => {
  const fake = createFakeFetch([
    () => jsonResponse(timed),
    () => googleError(404, "notFound"),
    () => googleError(410, "deleted"),
    () => jsonResponse({ ...timed, status: "cancelled" }),
    () => googleError(500, "backendError"),
  ]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  const found = await client.get(CAL, "evt1");
  assert.equal(found?.remoteId, "evt1");
  assert.equal(found?.etag, '"3401"');
  assert.equal(fake.calls[0].method, "GET");
  assert.equal(new URL(fake.calls[0].url).pathname, `/calendar/v3/calendars/${encodeURIComponent(CAL)}/events/evt1`);
  assert.equal(await client.get(CAL, "evt1"), null);
  assert.equal(await client.get(CAL, "evt1"), null);
  assert.equal(await client.get(CAL, "evt1"), null);
  await assert.rejects(client.get(CAL, "evt1"), CalendarProviderError);
  await assert.rejects(client.get(CAL, "../x"), CalendarProviderError);
  assert.equal(fake.calls.length, 5);
});

test("update는 PATCH + If-Match(따옴표 원문)를 보내고 종일 전환 때 dateTime을 비운다. 412는 CalendarConflictError", async () => {
  const fake = createFakeFetch([() => jsonResponse({ id: "evt1", etag: '"3403"' }), () => googleError(412, "conditionNotMet")]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  const input = { title: "종일", start: new Date("2026-11-01T15:00:00Z"), end: new Date("2026-11-02T15:00:00Z"), allDay: true, portalRef: "event:1" };
  assert.deepEqual(await client.update(CAL, "evt1", input, '"3402"'), { remoteId: "evt1", etag: '"3403"' });
  assert.equal(fake.calls[0].method, "PATCH");
  assert.equal(fake.calls[0].headers["if-match"], '"3402"');
  const body = JSON.parse(fake.calls[0].body);
  assert.deepEqual(body.start, { date: "2026-11-02", dateTime: null, timeZone: null });
  assert.deepEqual(body.end, { date: "2026-11-03", dateTime: null, timeZone: null });
  await assert.rejects(client.update(CAL, "evt1", input, '"stale"'), CalendarConflictError);
});

test("remove는 DELETE + If-Match, 410/404는 CalendarNotFoundError, 이상한 id는 요청 전에 거부", async () => {
  const fake = createFakeFetch([() => new Response(null, { status: 204 }), () => googleError(410, "deleted"), () => googleError(412, "conditionNotMet")]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  await client.remove(CAL, "evt1", '"1"');
  assert.equal(fake.calls[0].method, "DELETE");
  assert.equal(fake.calls[0].headers["if-match"], '"1"');
  await assert.rejects(client.remove(CAL, "evt1", '"1"'), CalendarNotFoundError);
  await assert.rejects(client.remove(CAL, "evt1", '"1"'), CalendarConflictError);
  await assert.rejects(client.remove(CAL, "../x", '"1"'), CalendarProviderError);
  await assert.rejects(client.remove(CAL, "evt1", 'a"\r\nx'), CalendarProviderError);
  assert.equal(fake.calls.length, 3);
});

test("findByPortalRef는 privateExtendedProperty로 찾는다", async () => {
  const fake = createFakeFetch([() => jsonResponse({ items: [timed] }), () => jsonResponse({ items: [] })]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  assert.equal((await client.findByPortalRef(CAL, "lesson:42"))?.remoteId, "evt1");
  assert.equal(new URL(fake.calls[0].url).searchParams.get("privateExtendedProperty"), "portalRef=lesson:42");
  assert.equal(await client.findByPortalRef(CAL, "lesson:43"), null);
});

test("Google 응답의 redirect는 따라가지 않는다", async () => {
  const fake = createFakeFetch([() => new Response(null, { status: 302, headers: { location: "https://evil.example/" } })]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  await assert.rejects(client.listCalendars(), CalendarProviderError);
  assert.equal(fake.calls.length, 1);
});

// ── 반복 시리즈 합성 ───────────────────────────────────────

function mergeSeries(parts: string[]): string {
  const zones = new Map<string, string>();
  const events: string[] = [];
  for (const part of parts) {
    const unfolded = part.replace(/\r\n[ \t]/gu, "");
    for (const match of unfolded.matchAll(/BEGIN:VTIMEZONE\r\nTZID:([^\r\n]+)[\s\S]*?END:VTIMEZONE\r\n/gu)) zones.set(match[1], match[0]);
    for (const match of unfolded.matchAll(/BEGIN:VEVENT\r\n[\s\S]*?END:VEVENT\r\n/gu)) events.push(match[0]);
  }
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${[...zones.values()].join("")}${events.join("")}END:VCALENDAR\r\n`;
}

async function expand(ics: string, window = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2027-01-01T00:00:00Z") }) {
  const { parseExternalCalendarItems } = await import("../external-calendar");
  return parseExternalCalendarItems({ ics, subscriptionId: "sub", studentId: "s", provider: "GOOGLE", spaceLabel: "학생", window });
}

test("반복 master·수정 예외·취소 예외를 seriesIcs로 합성하면 펼칠 때 취소 회차는 빠지고 수정 회차가 반영된다", async () => {
  // 매주 월요일 08:00 KST(= 일요일 23:00Z) — BYDAY가 UTC 날짜 경계를 넘어도 TZID로 정확해야 한다.
  const master = {
    id: "wk1",
    etag: '"m1"',
    status: "confirmed",
    iCalUID: "wk1@google.com",
    summary: "주간 레슨",
    description: "반복, 설명; 포함",
    updated: "2026-10-20T00:00:00.000Z",
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4", "EXDATE;TZID=Asia/Seoul:20261123T080000"],
    start: { dateTime: "2026-11-02T08:00:00+09:00", timeZone: "Asia/Seoul" },
    end: { dateTime: "2026-11-02T09:00:00+09:00", timeZone: "Asia/Seoul" },
  };
  const moved = {
    id: "wk1_20261108T230000Z",
    etag: '"x1"',
    status: "confirmed",
    iCalUID: "wk1@google.com",
    recurringEventId: "wk1",
    summary: "이동된 레슨",
    originalStartTime: { dateTime: "2026-11-09T08:00:00+09:00", timeZone: "Asia/Seoul" },
    start: { dateTime: "2026-11-09T10:00:00+09:00", timeZone: "Asia/Seoul" },
    end: { dateTime: "2026-11-09T11:00:00+09:00", timeZone: "Asia/Seoul" },
  };
  // 증분 sync의 취소 예외는 iCalUID·etag 없이 올 수 있다.
  const cancelled = {
    id: "wk1_20261115T230000Z",
    status: "cancelled",
    recurringEventId: "wk1",
    originalStartTime: { dateTime: "2026-11-16T08:00:00+09:00", timeZone: "Asia/Seoul" },
  };
  const cancelledMaster = { id: "gone-series", status: "cancelled" };
  const fake = createFakeFetch([() => jsonResponse({ items: [master, moved, cancelled, cancelledMaster], nextSyncToken: "S" })]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  const result = await client.pull(CAL, null, WINDOW);

  assert.deepEqual(result.deletedRemoteIds, ["gone-series"]);
  assert.deepEqual(result.changed.map((event) => [event.remoteId, event.status, event.seriesKey, event.recurring]), [
    ["wk1", "confirmed", "wk1@google.com", true],
    ["wk1_20261108T230000Z", "confirmed", "wk1@google.com", true],
    ["wk1_20261115T230000Z", "cancelled", "wk1@google.com", true],
  ]);
  const cancelledEvent = result.changed[2];
  assert.equal(cancelledEvent.start.toISOString(), "2026-11-15T23:00:00.000Z");
  assert.match(cancelledEvent.seriesIcs ?? "", /RECURRENCE-ID;TZID=Asia\/Seoul:20261116T080000\r\n/u);
  assert.match(cancelledEvent.seriesIcs ?? "", /STATUS:CANCELLED/u);
  const masterIcs = result.changed[0].seriesIcs ?? "";
  assert.match(masterIcs, /DTSTART;TZID=Asia\/Seoul:20261102T080000\r\n/u);
  assert.match(masterIcs, /RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4\r\n/u);
  assert.match(masterIcs, /EXDATE;TZID=Asia\/Seoul:20261123T080000\r\n/u);
  assert.match(masterIcs, /BEGIN:VTIMEZONE\r\nTZID:Asia\/Seoul\r\n/u);

  const items = await expand(mergeSeries(result.changed.map((event) => event.seriesIcs ?? "")));
  assert.deepEqual(items.map((item) => [item.date.toISOString(), item.title]), [
    ["2026-11-01T23:00:00.000Z", "주간 레슨"],
    ["2026-11-09T01:00:00.000Z", "이동된 레슨"],
  ]);
});

test("DST 시간대 반복은 합성 VTIMEZONE으로 전환 뒤에도 같은 현지 시각을 유지한다", async () => {
  const fake = createFakeFetch([
    () =>
      jsonResponse({
        items: [
          {
            id: "ny",
            etag: '"n"',
            status: "confirmed",
            iCalUID: "ny@google.com",
            summary: "NY",
            recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"],
            start: { dateTime: "2026-10-26T09:00:00-04:00", timeZone: "America/New_York" },
            end: { dateTime: "2026-10-26T10:00:00-04:00", timeZone: "America/New_York" },
          },
        ],
        nextSyncToken: "S",
      }),
  ]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  const [event] = (await client.pull(CAL, null, WINDOW)).changed;
  const items = await expand(event.seriesIcs ?? "");
  assert.deepEqual(items.map((item) => item.date.toISOString()), ["2026-10-26T13:00:00.000Z", "2026-11-02T14:00:00.000Z"]);
});

test("종일 반복 master는 VALUE=DATE로 합성한다", async () => {
  const fake = createFakeFetch([
    () =>
      jsonResponse({
        items: [
          { id: "ad", etag: '"a"', status: "confirmed", iCalUID: "ad@google.com", summary: "종일", recurrence: ["RRULE:FREQ=DAILY;COUNT=2"], start: { date: "2026-11-05" }, end: { date: "2026-11-06" } },
          { id: "ad_20261106", status: "cancelled", recurringEventId: "ad", originalStartTime: { date: "2026-11-06" } },
        ],
        nextSyncToken: "S",
      }),
  ]);
  const client = createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl });
  const { changed } = await client.pull(CAL, null, WINDOW);
  assert.match(changed[0].seriesIcs ?? "", /DTSTART;VALUE=DATE:20261105\r\n/u);
  assert.match(changed[1].seriesIcs ?? "", /RECURRENCE-ID;VALUE=DATE:20261106\r\n/u);
  assert.equal(changed[1].seriesKey, "ad@google.com");
  const items = await expand(mergeSeries(changed.map((event) => event.seriesIcs ?? "")));
  assert.equal(items.length, 1);
  assert.equal(items[0].metadata?.allDayStartDate, "2026-11-05");
});

const WATCH_TOKEN = "channel-token-secret-value";
const NOTIFY_ADDRESS = "https://portal.example.com/api/calendar-connections/google/notify";

test("watch는 events/watch에 web_hook·주소·token·ttl을 보내고 expiration(epoch ms 문자열)을 돌려준다", async () => {
  const fake = createFakeFetch([
    () => jsonResponse({ kind: "api#channel", id: "channel-1", resourceId: "res-1", resourceUri: "https://x", token: WATCH_TOKEN, expiration: "1793700000000" }),
  ]);
  const result = await createGoogleCalendarClient({ ...tokenProvider(), fetchImpl: fake.fetchImpl }).watch({
    calendarId: CAL,
    channelId: "channel-1",
    token: WATCH_TOKEN,
    address: NOTIFY_ADDRESS,
    ttlSeconds: 604_800,
  });
  assert.deepEqual(result, { resourceId: "res-1", expiresAt: new Date(1_793_700_000_000) });
  const [call] = fake.calls;
  assert.equal(call.method, "POST");
  assert.equal(call.url, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL)}/events/watch`);
  assert.equal(call.headers.authorization, "Bearer stale-token");
  assert.deepEqual(JSON.parse(call.body), {
    id: "channel-1",
    type: "web_hook",
    address: NOTIFY_ADDRESS,
    token: WATCH_TOKEN,
    params: { ttl: "604800" },
  });
});

test("watch는 expiration이 없으면 ttl로 만료를 정하고 401이면 token을 새로 받아 한 번 재시도한다", async () => {
  const tokens = tokenProvider();
  const fake = createFakeFetch([
    () => jsonResponse({ error: { code: 401 } }, 401),
    () => jsonResponse({ id: "channel-1", resourceId: "res-1" }),
  ]);
  const now = new Date("2026-10-27T00:00:00Z");
  const result = await watchGoogleCalendar(
    { ...tokens, fetchImpl: fake.fetchImpl, calendarId: CAL, channelId: "channel-1", token: WATCH_TOKEN, address: NOTIFY_ADDRESS, ttlSeconds: 3_600 },
    now,
  );
  assert.deepEqual(tokens.requests, [false, true]);
  assert.equal(result.expiresAt.getTime(), now.getTime() + 3_600_000);
});

test("watch는 https가 아닌 주소·잘못된 channel id를 요청 전에 거부하고 오류에 token을 넣지 않는다", async () => {
  const fake = createFakeFetch([() => googleError(403, "push.webhookUrlNotHttps"), () => jsonResponse({ id: "other", resourceId: "r" })]);
  const base = { ...tokenProvider(), fetchImpl: fake.fetchImpl, calendarId: CAL, channelId: "channel-1", token: WATCH_TOKEN, ttlSeconds: 60 };
  await assert.rejects(watchGoogleCalendar({ ...base, address: "http://localhost:3004/api/calendar-connections/google/notify" }), CalendarProviderError);
  await assert.rejects(watchGoogleCalendar({ ...base, address: NOTIFY_ADDRESS, channelId: "bad id!" }), CalendarProviderError);
  assert.equal(fake.calls.length, 0);
  const failure = await watchGoogleCalendar({ ...base, address: NOTIFY_ADDRESS }).catch((error: unknown) => error);
  assert.ok(failure instanceof CalendarProviderError);
  assert.doesNotMatch(String((failure as Error).message), new RegExp(WATCH_TOKEN, "u"));
  // 응답 channel id가 요청과 다르면 신뢰하지 않는다.
  await assert.rejects(watchGoogleCalendar({ ...base, address: NOTIFY_ADDRESS }), /response is invalid/u);
});

test("channels/stop은 id·resourceId를 보내고 404는 성공, 그 밖의 오류는 throw한다", async () => {
  const fake = createFakeFetch([
    () => new Response(null, { status: 204 }),
    () => googleError(404, "notFound"),
    () => googleError(500, "backendError"),
  ]);
  const input = { ...tokenProvider(), fetchImpl: fake.fetchImpl, channelId: "channel-1", resourceId: "res-1" };
  await stopGoogleChannel(input);
  assert.equal(fake.calls[0].url, "https://www.googleapis.com/calendar/v3/channels/stop");
  assert.equal(fake.calls[0].method, "POST");
  assert.deepEqual(JSON.parse(fake.calls[0].body), { id: "channel-1", resourceId: "res-1" });
  await stopGoogleChannel(input);
  await assert.rejects(stopGoogleChannel(input), CalendarProviderError);
});
