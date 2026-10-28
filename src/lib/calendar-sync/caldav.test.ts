import assert from "node:assert/strict";
import test from "node:test";
import { assertICloudUrl, createICloudCalendarClient, decodeCalDavCursor, encodeCalDavCursor, parseMultistatus } from "./caldav";
import { createFakeFetch, xmlResponse, type FakeHandler, type RecordedCall } from "./fake-fetch";
import { buildIcsEvent, derivePortalResourceName, derivePortalUid, readIcsUid } from "./ics";
import { CalendarAuthError, CalendarConflictError, CalendarNotFoundError, CalendarProviderError } from "./types";

const APPLE_ID = "teacher@icloud.com";
const PASSWORD = "abcd-efgh-ijkl-mnop";
const HOME = "https://p42-caldav.icloud.com/1234567890/calendars/";
const COLLECTION = `${HOME}5F1A2B3C-STUDENT-A/`;
const COLLECTION_PATH = new URL(COLLECTION).pathname;
const WINDOW = { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2027-08-01T00:00:00Z") };
const NOW = new Date("2026-10-27T00:00:00Z");

const PRINCIPAL_XML = `<?xml version='1.0' encoding='UTF-8'?>
<multistatus xmlns='DAV:'><response><href>/</href><propstat><prop><current-user-principal><href xmlns='DAV:'>/1234567890/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;

const HOME_XML = `<?xml version='1.0' encoding='UTF-8'?>
<multistatus xmlns='DAV:'><response><href>/1234567890/principal/</href><propstat><prop><calendar-home-set xmlns='urn:ietf:params:xml:ns:caldav'><href xmlns='DAV:'>https://p42-caldav.icloud.com:443/1234567890/calendars/</href></calendar-home-set></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;

function calendarResponse(options: {
  href: string;
  name: string;
  types: string;
  comps?: string[];
  color?: string;
  write?: boolean;
}): string {
  const comps = options.comps
    ? `<supported-calendar-component-set xmlns='urn:ietf:params:xml:ns:caldav'>${options.comps.map((comp) => `<comp name='${comp}'/>`).join("")}</supported-calendar-component-set>`
    : "";
  const privileges = `<current-user-privilege-set><privilege><read/></privilege>${options.write ? "<privilege><write/></privilege>" : ""}<privilege><read-current-user-privilege-set/></privilege></current-user-privilege-set>`;
  return `<response><href>${options.href}</href><propstat><prop><displayname>${options.name}</displayname><resourcetype>${options.types}</resourcetype>${comps}${options.color ? `<calendar-color xmlns='http://apple.com/ns/ical/' symbolic-color='custom'>${options.color}</calendar-color>` : ""}<getctag xmlns='http://calendarserver.org/ns/'>HwoQEgwAAA</getctag><sync-token>https://p42-caldav.icloud.com/sync/1</sync-token>${privileges}</prop><status>HTTP/1.1 200 OK</status></propstat><propstat><prop><calendar-color xmlns='http://apple.com/ns/ical/'/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response>`;
}

const CALENDARS_XML = `<?xml version='1.0' encoding='UTF-8'?><multistatus xmlns='DAV:'>
<response><href>/1234567890/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
${calendarResponse({ href: `${COLLECTION_PATH}`, name: "학생 A &amp; 레슨", types: "<collection/><calendar xmlns='urn:ietf:params:xml:ns:caldav'/>", comps: ["VEVENT"], color: "#FF2968FF", write: true })}
${calendarResponse({ href: "/1234567890/calendars/shared-ro/", name: "공유(읽기)", types: "<collection/><calendar xmlns='urn:ietf:params:xml:ns:caldav'/><shared-owner xmlns='http://calendarserver.org/ns/'/>", comps: ["VEVENT", "VTODO"], write: false })}
${calendarResponse({ href: "/1234567890/calendars/tasks/", name: "미리 알림", types: "<collection/><calendar xmlns='urn:ietf:params:xml:ns:caldav'/>", comps: ["VTODO"], write: true })}
${calendarResponse({ href: "/1234567890/calendars/inbox/", name: "inbox", types: "<collection/><schedule-inbox xmlns='urn:ietf:params:xml:ns:caldav'/>", write: true })}
</multistatus>`;

function stateXml(syncToken: string, ctag: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:response><d:href>${COLLECTION_PATH}</d:href><d:propstat><d:prop><d:sync-token>${syncToken}</d:sync-token><cs:getctag>${ctag}</cs:getctag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
}

const ICS_A = buildIcsEvent(
  { title: "레슨 A", start: new Date("2026-11-01T10:00:00Z"), end: new Date("2026-11-01T11:00:00Z"), portalRef: "lesson:1" },
  { uid: "uid-a", now: NOW },
);
const ICS_B = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apple Inc.//iPhone OS 18//EN\r\nBEGIN:VEVENT\r\nUID:uid-b\r\nDTSTART;TZID=Asia/Seoul:20261102T190000\r\nDTEND;TZID=Asia/Seoul:20261102T200000\r\nSUMMARY:선생님 일정 <&>\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

function dataResponse(path: string, etag: string, ics: string, cdata = false): string {
  const data = cdata ? `<![CDATA[${ics}]]>` : ics.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  return `<response><href>${path}</href><propstat><prop><getetag>${etag}</getetag><calendar-data xmlns="urn:ietf:params:xml:ns:caldav">${data}</calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response>`;
}

function client(handlers: FakeHandler[], extra: { calendarHomeUrl?: string } = {}) {
  const fake = createFakeFetch(handlers);
  return {
    fake,
    client: createICloudCalendarClient({ appleId: APPLE_ID, appSpecificPassword: PASSWORD, fetchImpl: fake.fetchImpl, now: () => NOW, ...extra }),
  };
}

function expectedAuth(): string {
  return `Basic ${Buffer.from(`${APPLE_ID}:${PASSWORD}`).toString("base64")}`;
}

test("host allowlist는 caldav.icloud.com과 pNN-caldav.icloud.com의 https만 허용한다", () => {
  assert.ok(assertICloudUrl("https://caldav.icloud.com/"));
  assert.ok(assertICloudUrl("https://p42-caldav.icloud.com:443/1/calendars/"));
  for (const url of [
    "http://caldav.icloud.com/",
    "https://evil.example/",
    "https://caldav.icloud.com.evil.example/",
    "https://p42-caldav.icloud.com:8443/",
    "https://u:p@caldav.icloud.com/",
    "https://px-caldav.icloud.com/",
    "https://www.icloud.com/",
  ]) {
    assert.throws(() => assertICloudUrl(url), CalendarProviderError, url);
  }
});

test("discovery: principal → calendar-home-set → Depth 1 캘린더 목록(VEVENT만, readOnly·color)", async () => {
  const { fake, client: icloud } = client([
    () => xmlResponse(PRINCIPAL_XML),
    () => xmlResponse(HOME_XML),
    () => xmlResponse(CALENDARS_XML),
  ]);
  const calendars = await icloud.listCalendars();
  assert.deepEqual(calendars, [
    { id: COLLECTION, name: "학생 A & 레슨", color: "#ff2968", readOnly: false },
    { id: `${HOME}shared-ro/`, name: "공유(읽기)", readOnly: true },
  ]);
  assert.deepEqual(
    fake.calls.map((call) => [call.method, call.url, call.headers.depth]),
    [
      ["PROPFIND", "https://caldav.icloud.com/", "0"],
      ["PROPFIND", "https://caldav.icloud.com/1234567890/principal/", "0"],
      ["PROPFIND", HOME, "1"],
    ],
  );
  for (const call of fake.calls) {
    assert.equal(call.headers.authorization, expectedAuth());
    assert.match(call.headers["content-type"], /application\/xml/u);
  }
  assert.match(fake.calls[0].body, /current-user-principal/u);
  assert.match(fake.calls[1].body, /calendar-home-set/u);
  assert.deepEqual(await icloud.discover(), { principalUrl: "https://caldav.icloud.com/1234567890/principal/", calendarHomeUrl: HOME });
});

test("p-host로의 redirect는 method·body·Depth를 유지해 따라간다", async () => {
  const { fake, client: icloud } = client([
    () => new Response(null, { status: 301, headers: { location: "https://p42-caldav.icloud.com/" } }),
    () => xmlResponse(PRINCIPAL_XML),
    () => xmlResponse(HOME_XML),
  ]);
  const result = await icloud.discover();
  assert.equal(result.principalUrl, "https://p42-caldav.icloud.com/1234567890/principal/");
  assert.equal(fake.calls[1].url, "https://p42-caldav.icloud.com/");
  assert.equal(fake.calls[1].method, "PROPFIND");
  assert.equal(fake.calls[1].headers.depth, "0");
  assert.equal(fake.calls[1].body, fake.calls[0].body);
  assert.equal(fake.calls[1].headers.authorization, expectedAuth());
});

test("허용 밖 host로의 redirect와 redirect 반복은 credential을 보내지 않고 거부한다", async () => {
  const foreign = client([() => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } })]);
  await assert.rejects(foreign.client.discover(), (error) => error instanceof CalendarProviderError && !error.message.includes(PASSWORD));
  assert.equal(foreign.fake.calls.length, 1);

  const loop = client(Array.from({ length: 4 }, () => () => new Response(null, { status: 307, headers: { location: "/again" } })));
  await assert.rejects(loop.client.discover(), CalendarProviderError);
  assert.equal(loop.fake.calls.length, 4);
});

test("401은 CalendarAuthError이며 message·속성에 credential이 없다", async () => {
  const { client: icloud } = client([() => new Response("Unauthorized", { status: 401 })]);
  await assert.rejects(icloud.listCalendars(), (error) => {
    assert.ok(error instanceof CalendarAuthError);
    const serialized = `${error.message} ${JSON.stringify(error)} ${error.stack ?? ""}`;
    assert.ok(!serialized.includes(PASSWORD));
    assert.ok(!serialized.includes(Buffer.from(`${APPLE_ID}:${PASSWORD}`).toString("base64")));
    return true;
  });
  assert.throws(() => createICloudCalendarClient({ appleId: "", appSpecificPassword: "x" }), CalendarAuthError);
});

test("multistatus href가 허용 밖 host면 거부한다", () => {
  assert.throws(
    () => parseMultistatus(`<multistatus xmlns="DAV:"><response><href>https://evil.example/x</href><status>HTTP/1.1 200 OK</status></response></multistatus>`, HOME),
    CalendarProviderError,
  );
});

test("초기 pull: collection sync-token을 먼저 읽고 time-range calendar-query로 전체를 받는다", async () => {
  const query = `<?xml version="1.0"?><multistatus xmlns="DAV:">${dataResponse(`${COLLECTION_PATH}a.ics`, '"e-a"', ICS_A)}${dataResponse(`${COLLECTION_PATH}b.ics`, '"e-b"', ICS_B, true)}</multistatus>`;
  const { fake, client: icloud } = client([() => xmlResponse(stateXml("tok-1", "ctag-1")), () => xmlResponse(query)]);
  const result = await icloud.pull(COLLECTION, null, WINDOW);
  assert.equal(fake.calls[0].method, "PROPFIND");
  assert.equal(fake.calls[0].headers.depth, "0");
  assert.equal(fake.calls[1].method, "REPORT");
  assert.equal(fake.calls[1].headers.depth, "1");
  assert.match(fake.calls[1].body, /<c:time-range start="20260801T000000Z" end="20270801T000000Z"\/>/u);
  assert.deepEqual(decodeCalDavCursor(result.nextCursor), { v: 1, syncToken: "tok-1", ctag: "ctag-1" });
  assert.equal(result.fullResync, false);
  assert.deepEqual(result.changed.map((event) => [event.remoteId, event.etag, event.title]), [
    [`${COLLECTION_PATH}a.ics`, '"e-a"', "레슨 A"],
    [`${COLLECTION_PATH}b.ics`, '"e-b"', "선생님 일정 <&>"],
  ]);
  assert.equal(result.changed[0].portalRef, "lesson:1");
  assert.equal(result.changed[1].start.toISOString(), "2026-11-02T10:00:00.000Z");
});

test("증분 pull: ctag·token이 같으면 REPORT 없이 끝난다", async () => {
  const cursor = encodeCalDavCursor({ v: 1, syncToken: "tok-1", ctag: "ctag-1" });
  const { fake, client: icloud } = client([() => xmlResponse(stateXml("tok-1", "ctag-1"))]);
  assert.deepEqual(await icloud.pull(COLLECTION, cursor, WINDOW), { changed: [], deletedRemoteIds: [], nextCursor: cursor, fullResync: false });
  assert.equal(fake.calls.length, 1);
});

test("증분 pull: sync-collection의 404 member는 삭제, 바뀐 href는 calendar-multiget으로 받는다(507 truncation 이어받기)", async () => {
  const cursor = encodeCalDavCursor({ v: 1, syncToken: "tok-1", ctag: "ctag-1" });
  const page1 = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
<d:response><d:href>${COLLECTION_PATH}a.ics</d:href><d:propstat><d:prop><d:getetag>"e-a2"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>${COLLECTION_PATH}gone.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>
<d:response><d:href>${COLLECTION_PATH}</d:href><d:status>HTTP/1.1 507 Insufficient Storage</d:status></d:response>
<d:sync-token>tok-2</d:sync-token></d:multistatus>`;
  const page2 = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
<d:response><d:href>${COLLECTION_PATH}b.ics</d:href><d:propstat><d:prop><d:getetag>"e-b2"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>${COLLECTION_PATH}vanished.ics</d:href><d:propstat><d:prop><d:getetag>"e-v"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:sync-token>tok-3</d:sync-token></d:multistatus>`;
  const cancelledIcs = ICS_B.replace("SUMMARY", "STATUS:CANCELLED\r\nSUMMARY");
  const multiget = `<?xml version="1.0"?><multistatus xmlns="DAV:">${dataResponse(`${COLLECTION_PATH}a.ics`, '"e-a2"', ICS_A.replace("레슨 A", "레슨 A2"))}${dataResponse(`${COLLECTION_PATH}b.ics`, '"e-b2"', cancelledIcs)}<response><href>${COLLECTION_PATH}vanished.ics</href><status>HTTP/1.1 404 Not Found</status></response></multistatus>`;
  const { fake, client: icloud } = client([
    () => xmlResponse(stateXml("tok-x", "ctag-2")),
    () => xmlResponse(page1),
    () => xmlResponse(page2),
    () => xmlResponse(multiget),
  ]);
  const result = await icloud.pull(COLLECTION, cursor, WINDOW);
  assert.match(fake.calls[1].body, /<d:sync-token>tok-1<\/d:sync-token><d:sync-level>1<\/d:sync-level>/u);
  assert.equal(fake.calls[1].headers.depth, "0");
  assert.match(fake.calls[2].body, /<d:sync-token>tok-2<\/d:sync-token>/u);
  assert.equal(fake.calls[3].method, "REPORT");
  assert.match(fake.calls[3].body, /calendar-multiget/u);
  assert.equal((fake.calls[3].body.match(/<d:href>/gu) ?? []).length, 3);
  assert.deepEqual(result.changed.map((event) => [event.remoteId, event.title]), [[`${COLLECTION_PATH}a.ics`, "레슨 A2"]]);
  assert.deepEqual(new Set(result.deletedRemoteIds), new Set([`${COLLECTION_PATH}gone.ics`, `${COLLECTION_PATH}b.ics`, `${COLLECTION_PATH}vanished.ics`]));
  assert.deepEqual(decodeCalDavCursor(result.nextCursor), { v: 1, syncToken: "tok-3", ctag: "ctag-2" });
});

test("무효 sync-token(403 valid-sync-token)과 깨진 cursor는 fullResync", async () => {
  const cursor = encodeCalDavCursor({ v: 1, syncToken: "expired" });
  const error = `<?xml version="1.0"?><error xmlns="DAV:"><valid-sync-token/></error>`;
  const { client: icloud } = client([
    () => xmlResponse(stateXml("tok-9", "c9")),
    () => xmlResponse(error, 403),
    () => xmlResponse(stateXml("tok-9", "c9")),
    () => xmlResponse(error, 409),
  ]);
  const expected = { changed: [], deletedRemoteIds: [], nextCursor: "", fullResync: true };
  assert.deepEqual(await icloud.pull(COLLECTION, cursor, WINDOW), expected);
  assert.deepEqual(await icloud.pull(COLLECTION, cursor, WINDOW), expected);
  assert.deepEqual(await icloud.pull(COLLECTION, "{nope", WINDOW), expected);
});

test("create는 결정적 <uuid>.ics에 If-None-Match:*로 PUT하고 ETag header를 돌려준다", async () => {
  const name = await derivePortalResourceName("lesson:7");
  const { fake, client: icloud } = client([() => new Response(null, { status: 201, headers: { etag: '"new-etag"' } })]);
  const result = await icloud.create(COLLECTION, { title: "레슨", start: new Date("2026-11-01T10:00:00Z"), end: new Date("2026-11-01T11:00:00Z"), portalRef: "lesson:7" });
  assert.deepEqual(result, { remoteId: `${COLLECTION_PATH}${name}.ics`, etag: '"new-etag"' });
  const call = fake.calls[0];
  assert.equal(call.method, "PUT");
  assert.equal(call.url, `${COLLECTION}${name}.ics`);
  assert.equal(call.headers["if-none-match"], "*");
  assert.equal(call.headers["if-match"], undefined);
  assert.equal(call.headers["content-type"], "text/calendar; charset=utf-8");
  assert.equal(readIcsUid(call.body), await derivePortalUid("lesson:7"));
  assert.match(call.body, /X-STANNLUMO-PORTAL-REF:lesson:7/u);
});

test("PUT 응답에 ETag가 없으면 PROPFIND getetag로 보충한다", async () => {
  const name = await derivePortalResourceName("lesson:8");
  const path = `${COLLECTION_PATH}${name}.ics`;
  const { fake, client: icloud } = client([
    () => new Response(null, { status: 204 }),
    () => xmlResponse(`<multistatus xmlns="DAV:"><response><href>${path}</href><propstat><prop><getetag>"fallback"</getetag></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`),
  ]);
  const result = await icloud.create(COLLECTION, { title: "x", start: new Date(0), end: new Date(60_000), portalRef: "lesson:8" });
  assert.equal(result.etag, '"fallback"');
  assert.equal(fake.calls[1].method, "PROPFIND");
  assert.equal(fake.calls[1].headers.depth, "0");
  assert.match(fake.calls[1].body, /getetag/u);
});

test("create 412(같은 결정적 리소스가 이미 있음)는 사본을 만들지 않고 기존 리소스를 If-Match PUT으로 맞춘다", async () => {
  const name = await derivePortalResourceName("lesson:1");
  const { fake, client: icloud } = client([
    () => new Response(null, { status: 412 }),
    () => new Response(ICS_A, { status: 200, headers: { etag: '"e-a"' } }),
    () => new Response(null, { status: 204, headers: { etag: '"e-a2"' } }),
  ]);
  const input = { title: "옮긴 레슨", start: new Date("2026-11-03T10:00:00Z"), end: new Date("2026-11-03T11:00:00Z"), portalRef: "lesson:1" };
  assert.deepEqual(await icloud.create(COLLECTION, input), { remoteId: `${COLLECTION_PATH}${name}.ics`, etag: '"e-a2"' });
  assert.deepEqual(fake.calls.map((call) => [call.method, call.url]), [
    ["PUT", `${COLLECTION}${name}.ics`],
    ["GET", `${COLLECTION}${name}.ics`],
    ["PUT", `${COLLECTION}${name}.ics`],
  ]);
  assert.equal(fake.calls[2].headers["if-match"], '"e-a"');
  assert.equal(fake.calls[2].headers["if-none-match"], undefined);
  assert.equal(readIcsUid(fake.calls[2].body), "uid-a", "기존 UID를 유지한다");
  assert.match(fake.calls[2].body, /SUMMARY:옮긴 레슨/u);

  // 412 뒤 리소스가 그 사이 사라졌으면 충돌로 올려 다음 실행이 다시 만든다.
  const gone = client([() => new Response(null, { status: 412 }), () => new Response(null, { status: 404 })]);
  await assert.rejects(gone.client.create(COLLECTION, input), CalendarConflictError);
});

test("update·remove 412는 CalendarConflictError", async () => {
  const path = `${COLLECTION_PATH}a.ics`;
  const { fake, client: icloud } = client([
    () => new Response(ICS_A, { status: 200, headers: { etag: '"e-a"' } }),
    () => new Response(null, { status: 412 }),
    () => new Response(null, { status: 412 }),
  ]);
  const input = { title: "x", start: new Date("2026-11-03T10:00:00Z"), end: new Date("2026-11-03T11:00:00Z"), portalRef: "lesson:1" };
  await assert.rejects(icloud.update(COLLECTION, path, input, '"e-a"'), CalendarConflictError);
  assert.equal(fake.calls[1].method, "PUT");
  assert.equal(fake.calls[1].headers["if-match"], '"e-a"');
  assert.equal(readIcsUid(fake.calls[1].body), "uid-a");
  await assert.rejects(icloud.remove(COLLECTION, path, '"e-a"'), CalendarConflictError);
  assert.equal(fake.calls[2].method, "DELETE");
  assert.equal(fake.calls[2].headers["if-match"], '"e-a"');
});

test("get은 remoteId href를 GET해 최신 etag와 내용을 주고 404·취소된 리소스는 null, collection 밖 id는 요청 전에 거부", async () => {
  const path = `${COLLECTION_PATH}imported-b.ics`;
  const cancelled = ICS_B.replace("SUMMARY:", "STATUS:CANCELLED\r\nSUMMARY:");
  const { fake, client: icloud } = client([
    () => new Response(ICS_B, { status: 200, headers: { etag: '"e-b"' } }),
    () => new Response(null, { status: 404 }),
    () => new Response(cancelled, { status: 200, headers: { etag: '"e-c"' } }),
  ]);
  const found = await icloud.get(COLLECTION, path);
  assert.equal(found?.remoteId, path);
  assert.equal(found?.etag, '"e-b"');
  assert.equal(found?.portalRef, undefined, "portalRef가 없는 가져온 일정도 찾는다");
  assert.equal(fake.calls[0].method, "GET");
  assert.equal(fake.calls[0].url, `${COLLECTION}imported-b.ics`);
  assert.equal(await icloud.get(COLLECTION, path), null);
  assert.equal(await icloud.get(COLLECTION, path), null);
  await assert.rejects(icloud.get(COLLECTION, "/1234567890/calendars/other/a.ics"), CalendarProviderError);
  assert.equal(fake.calls.length, 3);
});

test("update는 GET etag가 이미 다르면 PUT 없이 충돌, 성공하면 기존 UID로 PUT한다", async () => {
  const path = `${COLLECTION_PATH}b.ics`;
  const input = { title: "옮김", start: new Date("2026-11-04T10:00:00Z"), end: new Date("2026-11-04T11:00:00Z"), portalRef: "event:5" };
  const stale = client([() => new Response(ICS_B, { status: 200, headers: { etag: '"newer"' } })]);
  await assert.rejects(stale.client.update(COLLECTION, path, input, '"e-b"'), CalendarConflictError);
  assert.equal(stale.fake.calls.length, 1);

  const ok = client([() => new Response(ICS_B, { status: 200, headers: { etag: '"e-b"' } }), () => new Response(null, { status: 204, headers: { etag: '"e-b2"' } })]);
  assert.deepEqual(await ok.client.update(COLLECTION, path, input, '"e-b"'), { remoteId: path, etag: '"e-b2"' });
  const put: RecordedCall = ok.fake.calls[1];
  assert.equal(readIcsUid(put.body), "uid-b");
  assert.match(put.body, /DTSTART:20261104T100000Z/u);
});

test("remove 404는 CalendarNotFoundError, collection 밖 remoteId는 요청 전에 거부", async () => {
  const { fake, client: icloud } = client([() => new Response(null, { status: 404 }), () => new Response(null, { status: 204 })]);
  await assert.rejects(icloud.remove(COLLECTION, `${COLLECTION_PATH}a.ics`, '"e"'), CalendarNotFoundError);
  await icloud.remove(COLLECTION, `${COLLECTION_PATH}a.ics`, '"e"');
  for (const bad of ["/1234567890/calendars/other/a.ics", `${COLLECTION_PATH}../other/a.ics`, "https://evil.example/a.ics", `${COLLECTION_PATH}sub/a.ics`, "a.ics"]) {
    await assert.rejects(icloud.remove(COLLECTION, bad, '"e"'), CalendarProviderError, bad);
  }
  await assert.rejects(icloud.pull("https://evil.example/cal/", null, WINDOW), CalendarProviderError);
  assert.equal(fake.calls.length, 2);
});

test("findByPortalRef는 결정적 href를 GET하고 404면 null", async () => {
  const name = await derivePortalResourceName("lesson:1");
  const { fake, client: icloud } = client([() => new Response(ICS_A, { status: 200, headers: { etag: '"e-a"' } }), () => new Response(null, { status: 404 })]);
  const found = await icloud.findByPortalRef(COLLECTION, "lesson:1");
  assert.equal(found?.remoteId, `${COLLECTION_PATH}${name}.ics`);
  assert.equal(found?.etag, '"e-a"');
  assert.equal(await icloud.findByPortalRef(COLLECTION, "lesson:1"), null);
  assert.equal(fake.calls[0].method, "GET");
});

test("저장된 calendarHomeUrl이 있으면 discovery를 생략한다", async () => {
  const { fake, client: icloud } = client([() => xmlResponse(CALENDARS_XML)], { calendarHomeUrl: HOME });
  assert.equal((await icloud.listCalendars()).length, 2);
  assert.equal(fake.calls.length, 1);
});

test("반복 리소스는 calendar-data 원문을 seriesIcs로, UID를 seriesKey로 준다", async () => {
  const recurringIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:series-uid-1",
    "DTSTART:20261102T100000Z",
    "DTEND:20261102T110000Z",
    "RRULE:FREQ=WEEKLY;COUNT=3",
    "SUMMARY:주간",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:series-uid-1",
    "RECURRENCE-ID:20261109T100000Z",
    "DTSTART:20261109T100000Z",
    "STATUS:CANCELLED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const query = `<?xml version="1.0"?><multistatus xmlns="DAV:">${dataResponse(`${COLLECTION_PATH}r.ics`, '"e-r"', recurringIcs, true)}${dataResponse(`${COLLECTION_PATH}a.ics`, '"e-a"', ICS_A)}</multistatus>`;
  const { client: icloud } = client([() => xmlResponse(stateXml("tok-1", "c")), () => xmlResponse(query)]);
  const { changed } = await icloud.pull(COLLECTION, null, WINDOW);
  const [series, single] = changed;
  assert.equal(series.recurring, true);
  assert.equal(series.seriesKey, "series-uid-1");
  assert.equal(series.seriesIcs, recurringIcs);
  assert.equal(single.recurring, false);
  assert.equal(single.seriesIcs, undefined);
  const { parseExternalCalendarItems } = await import("../external-calendar");
  const items = await parseExternalCalendarItems({
    ics: series.seriesIcs ?? "",
    subscriptionId: "s",
    studentId: "s",
    provider: "ICLOUD",
    spaceLabel: "학생",
    window: { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2027-01-01T00:00:00Z") },
  });
  assert.deepEqual(items.map((item) => item.date.toISOString()), ["2026-11-02T10:00:00.000Z", "2026-11-16T10:00:00.000Z"]);
});
