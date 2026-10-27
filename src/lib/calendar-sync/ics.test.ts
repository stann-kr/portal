import assert from "node:assert/strict";
import test from "node:test";
import {
  PORTAL_REF_PROPERTY,
  buildIcsEvent,
  derivePortalResourceName,
  derivePortalUid,
  escapeIcsText,
  foldIcsLine,
  parseIcsEvent,
  patchIcsEvent,
  readIcsUid,
} from "./ics";
import { CalendarProviderError, lessonToRemoteInput, type RemoteEventInput } from "./types";

const NOW = new Date("2026-10-27T01:02:03Z");
const META = { remoteId: "/1/calendars/home/x.ics", etag: '"e1"' };

function octets(line: string): number {
  return new TextEncoder().encode(line).byteLength;
}

test("TEXT escaping은 \\ ; , 줄바꿈을 escape한다", () => {
  assert.equal(escapeIcsText("a\\b;c,d\ne\r\nf"), "a\\\\b\\;c\\,d\\ne\\nf");
});

test("75 octet folding은 한글 multi-byte 문자를 쪼개지 않는다", () => {
  const line = `SUMMARY:${"가나다라마바사".repeat(10)}`;
  const folded = foldIcsLine(line);
  const physical = folded.split("\r\n");
  assert.ok(physical.length > 1);
  for (const part of physical) assert.ok(octets(part) <= 75, `${octets(part)} octets`);
  assert.equal(physical.map((part, index) => (index === 0 ? part : part.slice(1))).join(""), line);
  assert.ok(physical.slice(1).every((part) => part.startsWith(" ")));
});

test("시간 지정 일정은 UTC로 쓰고 한글·escape·folding 포함해 왕복한다", async () => {
  const input: RemoteEventInput = {
    title: "레슨, 믹싱; 기초\\심화",
    description: `첫 줄\n둘째 줄, 세미콜론; 그리고 ${"아주 긴 설명 ".repeat(20)}`,
    start: new Date("2026-11-01T10:00:00Z"),
    end: new Date("2026-11-01T11:30:00Z"),
    portalRef: "event:abc-123",
  };
  const uid = await derivePortalUid(input.portalRef);
  const ics = buildIcsEvent(input, { uid, now: NOW });
  assert.match(ics, /\r\nDTSTART:20261101T100000Z\r\n/u);
  assert.match(ics, /\r\nDTEND:20261101T113000Z\r\n/u);
  assert.match(ics, /\r\nDTSTAMP:20261027T010203Z\r\n/u);
  assert.match(ics, new RegExp(`\\r\\n${PORTAL_REF_PROPERTY}:event:abc-123\\r\\n`, "u"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  for (const line of ics.split("\r\n")) assert.ok(octets(line) <= 75);
  assert.ok(!/[^\r]\n/u.test(ics), "LF without CR");

  const parsed = parseIcsEvent(ics, META);
  assert.ok(parsed);
  assert.equal(parsed.title, input.title);
  assert.equal(parsed.description, input.description);
  assert.equal(parsed.start.toISOString(), "2026-11-01T10:00:00.000Z");
  assert.equal(parsed.end.toISOString(), "2026-11-01T11:30:00.000Z");
  assert.equal(parsed.allDay, false);
  assert.equal(parsed.portalRef, "event:abc-123");
  assert.equal(parsed.status, "confirmed");
  assert.equal(parsed.recurring, false);
  assert.equal(parsed.updatedAt?.toISOString(), NOW.toISOString());
  assert.equal(readIcsUid(ics), uid);
});

test("종일 일정은 KST 날짜와 배타적 DTEND로 쓰고 읽는다", () => {
  const ics = buildIcsEvent(
    {
      title: "공연",
      // KST 2026-11-02 00:00 ~ 2026-11-04 00:00 (2일)
      start: new Date("2026-11-01T15:00:00Z"),
      end: new Date("2026-11-03T15:00:00Z"),
      allDay: true,
      portalRef: "event:all",
    },
    { uid: "u1", now: NOW },
  );
  assert.match(ics, /DTSTART;VALUE=DATE:20261102\r\n/u);
  assert.match(ics, /DTEND;VALUE=DATE:20261104\r\n/u);
  const parsed = parseIcsEvent(ics, META);
  assert.ok(parsed);
  assert.equal(parsed.allDay, true);
  assert.equal(parsed.allDayStartDate, "2026-11-02");
  assert.equal(parsed.allDayEndDate, "2026-11-04");
  assert.equal(parsed.start.toISOString(), "2026-11-01T15:00:00.000Z");
  assert.equal(parsed.end.toISOString(), "2026-11-03T15:00:00.000Z");
});

test("종일 end가 start 이하이면 하루짜리로 쓴다", () => {
  const ics = buildIcsEvent(
    { title: "a", start: new Date("2026-11-01T15:00:00Z"), end: new Date("2026-11-01T15:00:00Z"), allDay: true, portalRef: "event:x" },
    { uid: "u", now: NOW },
  );
  assert.match(ics, /DTEND;VALUE=DATE:20261103\r\n|DTEND;VALUE=DATE:20261103$/mu);
});

test("TZID 시각은 VTIMEZONE이 있으면 그것으로, 없으면 IANA 이름(Intl)으로 해석한다", () => {
  const vtimezone = "BEGIN:VTIMEZONE\r\nTZID:Asia/Seoul\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0900\r\nTZOFFSETTO:+0900\r\nTZNAME:KST\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n";
  const event = "BEGIN:VEVENT\r\nUID:tz\r\nDTSTART;TZID=Asia/Seoul:20260810T190000\r\nDURATION:PT90M\r\nSUMMARY:TZ\r\nEND:VEVENT\r\n";
  for (const ics of [
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${vtimezone}${event}END:VCALENDAR\r\n`,
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${event}END:VCALENDAR\r\n`,
  ]) {
    const parsed = parseIcsEvent(ics, META);
    assert.ok(parsed);
    assert.equal(parsed.start.toISOString(), "2026-08-10T10:00:00.000Z");
    assert.equal(parsed.end.toISOString(), "2026-08-10T11:30:00.000Z");
  }
});

test("미국 DST 경계의 TZID도 VTIMEZONE 없이 정확하다", () => {
  const ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ny\r\nDTSTART;TZID=America/New_York:20260710T090000\r\nDTEND;TZID=America/New_York:20261210T090000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const parsed = parseIcsEvent(ics, META);
  assert.ok(parsed);
  assert.equal(parsed.start.toISOString(), "2026-07-10T13:00:00.000Z");
  assert.equal(parsed.end.toISOString(), "2026-12-10T14:00:00.000Z");
});

test("floating 시각은 Asia/Seoul로 해석한다", () => {
  const ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:f\r\nDTSTART:20261101T190000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const parsed = parseIcsEvent(ics, META);
  assert.ok(parsed);
  assert.equal(parsed.start.toISOString(), "2026-11-01T10:00:00.000Z");
  assert.equal(parsed.end.toISOString(), "2026-11-01T10:00:00.000Z");
});

test("반복 master와 예외는 recurring으로, master DTSTART를 쓴다. STATUS:CANCELLED는 cancelled", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:r",
    "DTSTART:20261102T100000Z",
    "DTEND:20261102T110000Z",
    "RRULE:FREQ=WEEKLY;COUNT=5",
    "SUMMARY:주간 레슨",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:r",
    "RECURRENCE-ID:20261109T100000Z",
    "DTSTART:20261109T120000Z",
    "DTEND:20261109T130000Z",
    "SUMMARY:이동됨",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const parsed = parseIcsEvent(ics, META);
  assert.ok(parsed);
  assert.equal(parsed.recurring, true);
  assert.equal(parsed.title, "주간 레슨");
  assert.equal(parsed.start.toISOString(), "2026-11-02T10:00:00.000Z");
  assert.throws(() => patchIcsEvent(ics, lessonToRemoteInput({ lessonId: "1", title: "x", start: new Date() })), CalendarProviderError);

  const cancelled = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:c\r\nDTSTART;VALUE=DATE:20261101\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const parsedCancelled = parseIcsEvent(cancelled, META);
  assert.equal(parsedCancelled?.status, "cancelled");
  assert.equal(parsedCancelled?.allDayEndDate, "2026-11-02");
});

test("VEVENT가 없으면 null, 깨진 데이터는 CalendarProviderError", () => {
  assert.equal(parseIcsEvent("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n", META), null);
  assert.throws(() => parseIcsEvent("not ics", META), CalendarProviderError);
});

test("patch는 UID·VALARM을 보존하고 시간·제목·portalRef·SEQUENCE를 바꾸며 TZID를 제거한다", () => {
  const existing = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Apple Inc.//iCal//EN",
    "BEGIN:VEVENT",
    "UID:apple-uid-1",
    "DTSTART;TZID=Asia/Seoul:20261101T190000",
    "DTEND;TZID=Asia/Seoul:20261101T200000",
    "SEQUENCE:2",
    "SUMMARY:old",
    "DESCRIPTION:old desc",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT15M",
    "DESCRIPTION:알림",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const patched = patchIcsEvent(
    existing,
    { title: `새 제목 ${"긴".repeat(40)}`, start: new Date("2026-11-03T10:00:00Z"), end: new Date("2026-11-03T11:00:00Z"), portalRef: "lesson:9" },
    { now: NOW },
  );
  for (const line of patched.split("\r\n")) assert.ok(octets(line) <= 75);
  assert.equal(readIcsUid(patched), "apple-uid-1");
  assert.match(patched, /BEGIN:VALARM/u);
  assert.match(patched, /SEQUENCE:3/u);
  assert.doesNotMatch(patched, /TZID=/u);
  assert.doesNotMatch(patched, /old desc/u);
  const parsed = parseIcsEvent(patched, META);
  assert.ok(parsed);
  assert.equal(parsed.start.toISOString(), "2026-11-03T10:00:00.000Z");
  assert.equal(parsed.portalRef, "lesson:9");
  assert.equal(parsed.title, `새 제목 ${"긴".repeat(40)}`);
  assert.equal(parsed.description, "");

  const allDay = patchIcsEvent(existing, { title: "t", start: new Date("2026-11-01T15:00:00Z"), end: new Date("2026-11-02T15:00:00Z"), allDay: true, portalRef: "event:1" });
  assert.match(allDay, /DTSTART;VALUE=DATE:20261102/u);
  assert.match(allDay, /DTEND;VALUE=DATE:20261103/u);
});

test("UID·리소스 이름은 portalRef에서 결정적으로 만든다", async () => {
  assert.equal(await derivePortalUid("lesson:1"), await derivePortalUid("lesson:1"));
  assert.notEqual(await derivePortalUid("lesson:1"), await derivePortalUid("lesson:2"));
  const name = await derivePortalResourceName("lesson:1");
  assert.match(name, /^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/u);
});

test("입력 검증: 잘못된 시간·portalRef·escape 필요 문자를 거부한다", () => {
  assert.throws(() => buildIcsEvent({ title: "a", start: new Date("x"), end: new Date(), portalRef: "event:1" }, { uid: "u" }), CalendarProviderError);
  assert.throws(() => buildIcsEvent({ title: "a", start: new Date(2), end: new Date(1), portalRef: "event:1" }, { uid: "u" }), CalendarProviderError);
  assert.throws(() => buildIcsEvent({ title: "a", start: new Date(1), end: new Date(2), portalRef: "event:1,2" }, { uid: "u" }), CalendarProviderError);
  assert.throws(() => buildIcsEvent({ title: "a", start: new Date(1), end: new Date(2), portalRef: "event:1" }, { uid: "a\r\nb" }), CalendarProviderError);
  const ics = buildIcsEvent({ title: "a\r\nINJECT:1", start: new Date(1), end: new Date(2), portalRef: "event:1" }, { uid: "u" });
  assert.doesNotMatch(ics, /\r\nINJECT/u);
});

test("lessonToRemoteInput은 기본 60분과 지정 duration을 적용한다", () => {
  const start = new Date("2026-11-01T10:00:00Z");
  assert.equal(lessonToRemoteInput({ lessonId: "a", title: "t", start }).end.toISOString(), "2026-11-01T11:00:00.000Z");
  const custom = lessonToRemoteInput({ lessonId: "a", title: "t", start, durationMinutes: 90 });
  assert.equal(custom.end.toISOString(), "2026-11-01T11:30:00.000Z");
  assert.equal(custom.portalRef, "lesson:a");
  assert.throws(() => lessonToRemoteInput({ lessonId: "a", title: "t", start, durationMinutes: 0 }), CalendarProviderError);
});
