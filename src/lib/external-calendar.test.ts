import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeExternalCalendarKey,
  decryptExternalCalendarUrl,
  encryptExternalCalendarUrl,
  EXTERNAL_CALENDAR_MAX_BYTES,
  fetchExternalCalendarIcs,
  normalizeExternalCalendarUrl,
  parseExternalCalendarItems,
  validateExternalCalendarConnection,
} from "./external-calendar";

const GOOGLE_URL = "https://calendar.google.com/calendar/ical/lesson%40example.com/public/basic.ics";
const ICLOUD_URL = "https://p42-caldav.icloud.com/published/2/opaque-calendar-id";
const KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

test("공개 Google/iCloud URL만 정규화하고 Secret·credential·query 주소를 거부한다", () => {
  assert.equal(normalizeExternalCalendarUrl(`webcal:${GOOGLE_URL.slice("https:".length)}`).provider, "GOOGLE");
  assert.equal(normalizeExternalCalendarUrl(ICLOUD_URL).provider, "ICLOUD");
  assert.throws(() => normalizeExternalCalendarUrl("https://calendar.google.com/calendar/ical/a/private-secret/basic.ics"));
  assert.throws(() => normalizeExternalCalendarUrl(`${GOOGLE_URL}?token=secret`));
  assert.throws(() => normalizeExternalCalendarUrl("https://user:pass@calendar.google.com/calendar/ical/a/public/basic.ics"));
  assert.throws(() => normalizeExternalCalendarUrl(`${GOOGLE_URL}${"a".repeat(4_096)}`));
});

test("AES-GCM은 32-byte key, fresh IV와 student/provider AAD로 URL을 보호한다", async () => {
  assert.equal(decodeExternalCalendarKey("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=").byteLength, 32);
  const first = await encryptExternalCalendarUrl({ url: GOOGLE_URL, studentId: "student-a", provider: "GOOGLE", key: KEY });
  const second = await encryptExternalCalendarUrl({ url: GOOGLE_URL, studentId: "student-a", provider: "GOOGLE", key: KEY });
  assert.notEqual(first.urlIv, second.urlIv);
  assert.equal(await decryptExternalCalendarUrl({ ...first, studentId: "student-a", provider: "GOOGLE", key: KEY }), GOOGLE_URL);
  await assert.rejects(() => encryptExternalCalendarUrl({ url: GOOGLE_URL, studentId: "student-a", provider: "GOOGLE", key: KEY.slice(0, 16) }));
  await assert.rejects(() => decryptExternalCalendarUrl({ ...first, studentId: "student-b", provider: "GOOGLE", key: KEY }));
  await assert.rejects(() => decryptExternalCalendarUrl({ ...first, studentId: "student-a", provider: "ICLOUD", key: KEY }));
  await assert.rejects(() => decryptExternalCalendarUrl({ ...first, studentId: "student-a", provider: "GOOGLE", key: KEY.map((byte) => byte ^ 0xff) }));
  await assert.rejects(() => decryptExternalCalendarUrl({ ...first, urlIv: "AA", studentId: "student-a", provider: "GOOGLE", key: KEY }));

  const lastCharacter = first.encryptedUrl.at(-1);
  const tampered = {
    ...first,
    encryptedUrl: `${first.encryptedUrl.slice(0, -1)}${lastCharacter === "A" ? "B" : "A"}`,
  };
  await assert.rejects(
    () => decryptExternalCalendarUrl({ ...tampered, studentId: "student-a", provider: "GOOGLE", key: KEY }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /calendar\.google|lesson%40example/iu);
      return true;
    },
  );
});

test("fetch는 redirect와 비-iCal MIME을 거부하고 text/plain 공개 iCal은 허용한다", async () => {
  const ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
  await assert.rejects(() => fetchExternalCalendarIcs(GOOGLE_URL, async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example" } })));
  await assert.rejects(() => fetchExternalCalendarIcs(GOOGLE_URL, async () => new Response("<html>", { headers: { "content-type": "text/html" } })));
  assert.equal(await fetchExternalCalendarIcs(GOOGLE_URL, async () => new Response(ics, { headers: { "content-type": "text/plain; charset=utf-8" } })), ics);
});

test("fetch는 1 MiB streaming 상한과 timeout에서 fail closed 한다", async () => {
  await assert.rejects(() => fetchExternalCalendarIcs(
    GOOGLE_URL,
    async () => new Response(new Uint8Array(EXTERNAL_CALENDAR_MAX_BYTES + 1), {
      headers: { "content-type": "text/plain" },
    }),
  ));

  const hangingFetch: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
  await assert.rejects(
    () => fetchExternalCalendarIcs(GOOGLE_URL, hangingFetch, 5),
    /unavailable/u,
  );
});

test("반복, EXDATE, override, 취소, all-day를 bounded read-only 레슨으로 정규화한다", async () => {
  const items = await parseExternalCalendarItems({
    subscriptionId: "subscription-1", studentId: "student-1", provider: "GOOGLE", spaceLabel: "Mina", referenceTime: new Date("2026-08-01T00:00:00.000Z"),
    ics: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:series-1\r\nDTSTART:20260801T100000Z\r\nDTEND:20260801T110000Z\r\nRRULE:FREQ=DAILY;COUNT=4\r\nEXDATE:20260802T100000Z\r\nSUMMARY:Original\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:series-1\r\nRECURRENCE-ID:20260803T100000Z\r\nDTSTART:20260803T120000Z\r\nDTEND:20260803T133000Z\r\nSUMMARY:Moved\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:series-1\r\nRECURRENCE-ID:20260804T100000Z\r\nSTATUS:CANCELLED\r\nDTSTART:20260804T100000Z\r\nDTEND:20260804T110000Z\r\nSUMMARY:Cancelled\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:all-day\r\nDTSTART;VALUE=DATE:20260805\r\nDTEND;VALUE=DATE:20260806\r\nSUMMARY:All day lesson\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  });
  assert.deepEqual(items.map((item) => item.title), ["Original", "Moved", "All day lesson"]);
  assert.equal(items.find((item) => item.title === "Moved")?.date.toISOString(), "2026-08-03T12:00:00.000Z");
  assert.equal(items.find((item) => item.title === "All day lesson")?.metadata.allDay, true);
  assert.equal(items.find((item) => item.title === "All day lesson")?.metadata.allDayStartDate, "2026-08-05");
  assert.equal(items.find((item) => item.title === "All day lesson")?.metadata.allDayEndDate, "2026-08-06");
  assert.ok(items.every((item) => item.source.kind === "GOOGLE_CALENDAR" && item.source.entity === "EXTERNAL_CALENDAR_EVENT"));
  assert.ok(items.every((item) => !item.id.includes("series-1")));
});

test("VTIMEZONE과 DURATION을 실제 시작·종료 시각으로 변환한다", async () => {
  const items = await parseExternalCalendarItems({
    subscriptionId: "timezone-duration",
    studentId: "student-1",
    provider: "ICLOUD",
    spaceLabel: "Mina",
    referenceTime: new Date("2026-08-01T00:00:00.000Z"),
    ics: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:Asia/Seoul\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0900\r\nTZOFFSETTO:+0900\r\nTZNAME:KST\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:timezone-duration\r\nDTSTART;TZID=Asia/Seoul:20260810T190000\r\nDURATION:PT90M\r\nSUMMARY:Timezone lesson\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  });

  assert.equal(items[0]?.date.toISOString(), "2026-08-10T10:00:00.000Z");
  assert.equal(items[0]?.endDate?.toISOString(), "2026-08-10T11:30:00.000Z");
});

test("호출자가 지정한 bounded window 밖의 외부 일정은 반환하지 않는다", async () => {
  const items = await parseExternalCalendarItems({
    subscriptionId: "bounded-window",
    studentId: "student-1",
    provider: "GOOGLE",
    spaceLabel: "Mina",
    window: {
      start: new Date("2026-08-01T00:00:00.000Z"),
      end: new Date("2026-08-31T23:59:59.999Z"),
    },
    ics: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:inside\r\nDTSTART:20260810T100000Z\r\nDTEND:20260810T110000Z\r\nSUMMARY:Inside\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:outside\r\nDTSTART:20260910T100000Z\r\nDTEND:20260910T110000Z\r\nSUMMARY:Outside\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  });
  assert.deepEqual(items.map((item) => item.title), ["Inside"]);
  await assert.rejects(() => parseExternalCalendarItems({
    ics: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n",
    subscriptionId: "invalid-window",
    studentId: "student-1",
    provider: "GOOGLE",
    spaceLabel: "Mina",
    window: {
      start: new Date("2026-09-01T00:00:00.000Z"),
      end: new Date("2026-08-01T00:00:00.000Z"),
    },
  }));
});

test("window 이전 recurrence도 확장 상한에 포함해 조용히 누락하지 않는다", async () => {
  await assert.rejects(
    () => parseExternalCalendarItems({
      ics: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:long-series\r\nDTSTART:20200101T100000Z\r\nDTEND:20200101T110000Z\r\nRRULE:FREQ=DAILY;COUNT=3000\r\nSUMMARY:Long lesson\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
      subscriptionId: "long-series", studentId: "student-1", provider: "GOOGLE", spaceLabel: "Mina", referenceTime: new Date("2026-08-01T00:00:00.000Z"),
    }),
    /too many recurrences/u,
  );
});

test("빈 VCALENDAR는 연결 검증에 사용할 수 있는 유효한 공개 캘린더다", async () => {
  const items = await parseExternalCalendarItems({ ics: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n", subscriptionId: "empty", studentId: "student-1", provider: "ICLOUD", spaceLabel: "Mina" });
  assert.deepEqual(items, []);
});

test("연결 helper는 선택한 provider와 실제 fetch/parse 성공을 함께 요구한다", async () => {
  const emptyCalendar = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
  await assert.rejects(() => validateExternalCalendarConnection({ provider: "ICLOUD", url: GOOGLE_URL, studentId: "student-1", spaceLabel: "Mina", fetchImpl: async () => new Response(emptyCalendar) }));
  const connection = await validateExternalCalendarConnection({ provider: "GOOGLE", url: GOOGLE_URL, studentId: "student-1", spaceLabel: "Mina", fetchImpl: async () => new Response(emptyCalendar) });
  assert.equal(connection.url, GOOGLE_URL);
});
