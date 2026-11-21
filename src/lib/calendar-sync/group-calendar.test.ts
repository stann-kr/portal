/**
 * 그룹 캘린더 동기화(2026-11-16 사용자 결정): 그룹레슨만 일정 하나로 올리기, 개인 캘린더에서 빼기, 원격 이동은 멤버 모두,
 * 원격 삭제는 연결만 끊기, 그룹 캘린더 새 일정은 멤버 모두의 사본 + 다른 서비스 그룹 캘린더로 복제.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { runCalendarMappingSync, type SyncEngineMode } from "./engine";
import { FakeCalendar } from "./fake-calendar-client";
import { markLinksDeletedStatement } from "./sync-runner";
import { createSqliteTestDb, insertConnection, insertMapping, insertProfile, type SqliteTestDb } from "./sqlite-test-db";

const NOW = new Date("2026-11-16T00:00:00.000Z");
const T_GROUP = new Date("2026-11-18T10:00:00.000Z");
const T_SOLO = new Date("2026-11-19T10:00:00.000Z");
const seconds = (date: Date) => Math.floor(date.getTime() / 1_000);

type Harness = SqliteTestDb & {
  remotes: Record<string, FakeCalendar>;
  sync: (mappingId: string, mode?: SyncEngineMode) => ReturnType<typeof runCalendarMappingSync>;
};

function setup(context: TestContext): Harness {
  const db = createSqliteTestDb(context);
  insertProfile(db, "admin-1", "admin");
  // 학생 id 순서가 그룹레슨 기준(첫 멤버)을 정한다: s-a가 기준.
  insertProfile(db, "s-a", "student");
  insertProfile(db, "s-b", "student");
  insertConnection(db, "conn-google", "GOOGLE");
  insertConnection(db, "conn-icloud", "ICLOUD");
  db.run("INSERT INTO lesson_groups (id, name) VALUES ('g-1', '화요일 2:1')");
  db.run("INSERT INTO lesson_group_members (student_id, group_id) VALUES ('s-a', 'g-1'), ('s-b', 'g-1')");
  const remotes: Record<string, FakeCalendar> = {};
  return {
    ...db,
    remotes,
    sync: (mappingId, mode) => {
      remotes[mappingId] ??= new FakeCalendar();
      return runCalendarMappingSync({
        ctx: db.ctx,
        mappingId,
        getClient: async () => remotes[mappingId],
        credentialsCiphertext: () => "x",
        now: () => NOW,
        force: true,
        mode,
      });
    },
  };
}

function insertGroupMapping(db: SqliteTestDb, id: string, connectionId: string, calendarId: string): void {
  db.run(
    "INSERT INTO calendar_mappings (id, connection_id, student_id, group_id, remote_calendar_id, remote_calendar_name, created_at, updated_at) VALUES (?, ?, NULL, 'g-1', ?, '그룹레슨', 1767225600, 1767225600)",
    id,
    connectionId,
    calendarId,
  );
}

function insertLesson(db: SqliteTestDb, id: string, studentId: string, start: Date): void {
  db.run("INSERT INTO lessons (id, student_id, scheduled_at) VALUES (?, ?, ?)", id, studentId, seconds(start));
}

function lessonStarts(db: SqliteTestDb): Record<string, number> {
  return Object.fromEntries(db.rows<{ id: string; scheduled_at: number }>("SELECT id, scheduled_at FROM lessons ORDER BY id").map((row) => [row.id, row.scheduled_at]));
}

function remoteTitles(remote: FakeCalendar): string[] {
  return [...remote.events.values()].map((event) => `${event.title}@${event.start.toISOString()}`).sort();
}

test("그룹 캘린더는 멤버 모두 같은 시각인 그룹레슨만 첫 멤버 레슨 기준 일정 하나로 올린다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "l-a", "s-a", T_GROUP);
  insertLesson(harness, "l-b", "s-b", T_GROUP);
  insertLesson(harness, "l-a-solo", "s-a", T_SOLO);
  insertGroupMapping(harness, "map-group-google", "conn-google", "cal-group");

  const result = await harness.sync("map-group-google");
  assert.equal(result.status, "synced");
  const remote = harness.remotes["map-group-google"];
  assert.deepEqual(remoteTitles(remote), [`그룹레슨@${T_GROUP.toISOString()}`]);
  assert.equal([...remote.events.values()][0].portalRef, "lesson:l-a");
  assert.deepEqual(
    harness.rows("SELECT local_kind, local_id FROM calendar_sync_links WHERE mapping_id = 'map-group-google'"),
    [{ local_kind: "LESSON", local_id: "l-a" }],
  );
});

test("같은 서비스에 그룹 캘린더가 생기면 그 서비스 개인 캘린더에서만 그룹레슨이 빠지고, 해제하면 다시 올라간다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "l-a", "s-a", T_GROUP);
  insertLesson(harness, "l-b", "s-b", T_GROUP);
  insertLesson(harness, "l-a-solo", "s-a", T_SOLO);
  insertMapping(harness, "map-a", "conn-google", "s-a", "cal-a");
  await harness.sync("map-a");
  const both = [`레슨@${T_GROUP.toISOString()}`, `레슨@${T_SOLO.toISOString()}`];
  assert.deepEqual(remoteTitles(harness.remotes["map-a"]), both);

  // 다른 서비스(iCloud)의 그룹 캘린더는 Google 개인 캘린더를 바꾸지 않는다(Google만 쓰는 멤버도 그룹레슨을 본다).
  insertGroupMapping(harness, "map-group-icloud", "conn-icloud", "cal-group-i");
  await harness.sync("map-a");
  assert.deepEqual(remoteTitles(harness.remotes["map-a"]), both);

  insertGroupMapping(harness, "map-group-google", "conn-google", "cal-group-g");
  await harness.sync("map-a");
  assert.deepEqual(remoteTitles(harness.remotes["map-a"]), [`레슨@${T_SOLO.toISOString()}`], "같은 서비스의 그룹레슨 사본을 지운다");

  harness.run("DELETE FROM calendar_mappings WHERE id = 'map-group-google'");
  await harness.sync("map-a");
  assert.deepEqual(remoteTitles(harness.remotes["map-a"]), both);
});

test("그룹 캘린더에서 그룹레슨을 옮기면 멤버 레슨이 모두 옮겨지고 다른 서비스 그룹 캘린더도 따라간다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "l-a", "s-a", T_GROUP);
  insertLesson(harness, "l-b", "s-b", T_GROUP);
  insertGroupMapping(harness, "map-group-google", "conn-google", "cal-group-g");
  insertGroupMapping(harness, "map-group-icloud", "conn-icloud", "cal-group-i");
  await harness.sync("map-group-google");
  await harness.sync("map-group-icloud");

  const moved = new Date("2026-11-18T12:00:00.000Z");
  harness.remotes["map-group-google"].remoteEdit("portal-lesson:l-a", {
    start: moved,
    end: new Date(moved.getTime() + 60 * 60_000),
  });
  const result = await harness.sync("map-group-google");
  assert.equal(result.status === "synced" && result.localChanged, true);
  assert.deepEqual(lessonStarts(harness), { "l-a": seconds(moved), "l-b": seconds(moved) });

  await harness.sync("map-group-icloud", "push");
  assert.deepEqual(remoteTitles(harness.remotes["map-group-icloud"]), [`그룹레슨@${moved.toISOString()}`]);
});

test("그룹 캘린더에서 그룹레슨을 지우면 포탈 레슨은 남고 연결만 끊긴다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "l-a", "s-a", T_GROUP);
  insertLesson(harness, "l-b", "s-b", T_GROUP);
  insertGroupMapping(harness, "map-group-google", "conn-google", "cal-group");
  await harness.sync("map-group-google");

  harness.remotes["map-group-google"].remoteDelete("portal-lesson:l-a");
  await harness.sync("map-group-google");
  assert.deepEqual(lessonStarts(harness), { "l-a": seconds(T_GROUP), "l-b": seconds(T_GROUP) });
  await harness.sync("map-group-google");
  assert.equal(harness.remotes["map-group-google"].events.size, 0, "옮기지 않았으면 다시 만들지 않는다");
});

test("한 멤버만 레슨을 옮기면 더 이상 그룹레슨이 아니어서 그룹 캘린더에서 빠진다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "l-a", "s-a", T_GROUP);
  insertLesson(harness, "l-b", "s-b", T_GROUP);
  insertGroupMapping(harness, "map-group-google", "conn-google", "cal-group");
  await harness.sync("map-group-google");
  harness.run("UPDATE lessons SET scheduled_at = ? WHERE id = 'l-b'", seconds(T_SOLO));
  await harness.sync("map-group-google", "push");
  assert.equal(harness.remotes["map-group-google"].events.size, 0);
});

type EventRow = { id: string; user_id: string; title: string; start_time: number; group_event_id: string | null };

function eventRows(db: SqliteTestDb): EventRow[] {
  return db.rows<EventRow>("SELECT id, user_id, title, start_time, group_event_id FROM calendar_events ORDER BY user_id");
}

test("그룹 캘린더 새 일정은 멤버 모두의 사본이 되고 다른 서비스 그룹 캘린더로 복제되며 개인 캘린더에는 오르지 않는다", async (context) => {
  const harness = setup(context);
  insertMapping(harness, "map-a", "conn-google", "s-a", "cal-a");
  insertGroupMapping(harness, "map-group-google", "conn-google", "cal-group-g");
  insertGroupMapping(harness, "map-group-icloud", "conn-icloud", "cal-group-i");
  harness.remotes["map-group-google"] = new FakeCalendar();
  const start = new Date("2026-11-20T09:00:00.000Z");
  const end = new Date("2026-11-20T11:00:00.000Z");
  const created = harness.remotes["map-group-google"].remoteAdd({ title: "합주", start, end });

  await harness.sync("map-group-google");
  const [groupEvent] = harness.rows<{ id: string; title: string }>("SELECT id, title FROM calendar_group_events");
  assert.equal(groupEvent.title, "합주");
  const copies = eventRows(harness);
  assert.deepEqual(copies.map((row) => [row.user_id, row.title, row.group_event_id]), [["s-a", "합주", groupEvent.id], ["s-b", "합주", groupEvent.id]]);

  await harness.sync("map-group-icloud");
  assert.deepEqual(remoteTitles(harness.remotes["map-group-icloud"]), [`합주@${start.toISOString()}`]);
  await harness.sync("map-a");
  assert.equal(harness.remotes["map-a"].events.size, 0, "사본은 개인 캘린더로 보내지 않는다");

  // 다른 서비스 쪽에서 고치면 원본·사본과 처음 캘린더가 따라간다.
  const icloudId = `portal-event:${groupEvent.id}`;
  const later = new Date("2026-11-20T13:00:00.000Z");
  harness.remotes["map-group-icloud"].remoteEdit(icloudId, { title: "합주 (B룸)", start: later, end: new Date(later.getTime() + 2 * 60 * 60_000) });
  await harness.sync("map-group-icloud");
  assert.deepEqual(eventRows(harness).map((row) => [row.title, row.start_time]), [["합주 (B룸)", seconds(later)], ["합주 (B룸)", seconds(later)]]);
  await harness.sync("map-group-google", "push");
  assert.equal(harness.remotes["map-group-google"].events.get(created.remoteId)?.title, "합주 (B룸)");

  // 학생이 자기 사본을 고치면 그 사본만 바뀌고 그룹 캘린더는 그대로다.
  const writesBefore = harness.remotes["map-group-google"].writeCount();
  harness.run("UPDATE calendar_events SET title = '개인 메모' WHERE user_id = 's-b'");
  await harness.sync("map-group-google");
  assert.equal(harness.remotes["map-group-google"].writeCount(), writesBefore);
  assert.deepEqual(eventRows(harness).map((row) => row.title), ["합주 (B룸)", "개인 메모"]);

  // 처음 캘린더에서 지우면 원본·사본이 지워지고 다른 서비스 사본도 지워진다.
  harness.remotes["map-group-google"].remoteDelete(created.remoteId);
  await harness.sync("map-group-google");
  assert.deepEqual(harness.rows("SELECT id FROM calendar_group_events"), []);
  assert.deepEqual(eventRows(harness), []);
  await harness.sync("map-group-icloud", "push");
  assert.equal(harness.remotes["map-group-icloud"].events.size, 0);
});

test("그룹 캘린더를 다시 지정해도 같은 내용의 그룹 일정 원본에 다시 이어 사본을 새로 만들지 않는다", async (context) => {
  const harness = setup(context);
  insertGroupMapping(harness, "map-group-google", "conn-google", "cal-group");
  harness.remotes["map-group-google"] = new FakeCalendar();
  harness.remotes["map-group-google"].remoteAdd({ title: "합주", start: T_SOLO, end: new Date(T_SOLO.getTime() + 60 * 60_000) });
  await harness.sync("map-group-google");
  harness.run("DELETE FROM calendar_mappings WHERE id = 'map-group-google'");
  insertGroupMapping(harness, "map-group-google", "conn-google", "cal-group");
  await harness.sync("map-group-google");
  assert.equal(harness.rows("SELECT id FROM calendar_group_events").length, 1);
  assert.equal(eventRows(harness).length, 2);
});

test("그룹 캘린더가 없는 계정의 개인 캘린더에는 그룹레슨과 그룹 일정 사본이 그대로 올라간다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "l-a", "s-a", T_GROUP);
  insertLesson(harness, "l-b", "s-b", T_GROUP);
  insertGroupMapping(harness, "map-group-google", "conn-google", "cal-group-g");
  insertMapping(harness, "map-b-icloud", "conn-icloud", "s-b", "cal-b");
  harness.remotes["map-group-google"] = new FakeCalendar();
  const start = new Date("2026-11-20T09:00:00.000Z");
  harness.remotes["map-group-google"].remoteAdd({ title: "합주", start, end: new Date(start.getTime() + 60 * 60_000) });
  await harness.sync("map-group-google");

  await harness.sync("map-b-icloud");
  assert.deepEqual(remoteTitles(harness.remotes["map-b-icloud"]), [`레슨@${T_GROUP.toISOString()}`, `합주@${start.toISOString()}`]);
});

test("학생이 포탈에서 지운 그룹 일정 사본은 다음 그룹 동기화에서 다시 생기지 않는다", async (context) => {
  const harness = setup(context);
  insertGroupMapping(harness, "map-group-google", "conn-google", "cal-group-g");
  harness.remotes["map-group-google"] = new FakeCalendar();
  const start = new Date("2026-11-20T09:00:00.000Z");
  const created = harness.remotes["map-group-google"].remoteAdd({ title: "합주", start, end: new Date(start.getTime() + 60 * 60_000) });
  await harness.sync("map-group-google");
  harness.run("DELETE FROM calendar_events WHERE user_id = 's-b'");

  await harness.sync("map-group-google");
  harness.remotes["map-group-google"].remoteEdit(created.remoteId, { title: "합주 (B룸)" });
  await harness.sync("map-group-google");
  assert.deepEqual(eventRows(harness).map((row) => [row.user_id, row.title]), [["s-a", "합주 (B룸)"]]);
  assert.equal(harness.remotes["map-group-google"].events.size, 1, "그룹 캘린더 일정은 남는다");
});

test("그룹레슨 기준 멤버가 그룹에서 빠지면 새 기준 레슨으로 일정 하나를 다시 올린다", async (context) => {
  const harness = setup(context);
  insertProfile(harness, "s-c", "student");
  harness.run("INSERT INTO lesson_group_members (student_id, group_id) VALUES ('s-c', 'g-1')");
  insertLesson(harness, "l-a", "s-a", T_GROUP);
  insertLesson(harness, "l-b", "s-b", T_GROUP);
  insertLesson(harness, "l-c", "s-c", T_GROUP);
  insertGroupMapping(harness, "map-group-google", "conn-google", "cal-group");
  await harness.sync("map-group-google");
  assert.equal([...harness.remotes["map-group-google"].events.values()][0].portalRef, "lesson:l-a");

  harness.run("DELETE FROM lesson_group_members WHERE student_id = 's-a'");
  await harness.sync("map-group-google", "push");
  const remote = [...harness.remotes["map-group-google"].events.values()];
  assert.deepEqual(remote.map((event) => [event.title, event.portalRef]), [["그룹레슨", "lesson:l-b"]]);
  assert.deepEqual(
    harness.rows("SELECT local_id FROM calendar_sync_links WHERE mapping_id = 'map-group-google'"),
    [{ local_id: "l-b" }],
  );
});

test("기준 멤버가 수강 종료하며 예정 레슨을 지우면 그룹 캘린더 일정은 하나 남고 그 학생 개인 캘린더 사본만 지워진다", async (context) => {
  const harness = setup(context);
  insertProfile(harness, "s-c", "student");
  harness.run("INSERT INTO lesson_group_members (student_id, group_id) VALUES ('s-c', 'g-1')");
  insertLesson(harness, "l-a", "s-a", T_GROUP);
  insertLesson(harness, "l-b", "s-b", T_GROUP);
  insertLesson(harness, "l-c", "s-c", T_GROUP);
  insertGroupMapping(harness, "map-group-google", "conn-google", "cal-group");
  // iCloud에는 그룹 캘린더가 없어 s-a 개인 캘린더에 그룹레슨이 그대로 오른다.
  insertMapping(harness, "map-a-icloud", "conn-icloud", "s-a", "cal-a");
  await harness.sync("map-group-google");
  await harness.sync("map-a-icloud");
  assert.equal(harness.remotes["map-a-icloud"].events.size, 1);

  // 수강 종료와 같은 batch에서 s-a 몫만 지운다(archiveStudent와 같은 문장).
  harness.run("UPDATE profiles SET account_status = 'ARCHIVED' WHERE id = 's-a'");
  const marked = markLinksDeletedStatement("LESSON", "l-a", "s-a", NOW);
  harness.run(marked.query, ...marked.params);
  harness.run("DELETE FROM lessons WHERE id = 'l-a' AND student_id = 's-a'");

  await harness.sync("map-group-google", "push");
  assert.deepEqual(
    [...harness.remotes["map-group-google"].events.values()].map((event) => [event.title, event.portalRef]),
    [["그룹레슨", "lesson:l-b"]],
  );
  assert.deepEqual(lessonStarts(harness), { "l-b": seconds(T_GROUP), "l-c": seconds(T_GROUP) });

  assert.equal((await harness.sync("map-a-icloud", "push")).status, "skipped");
  assert.equal((await harness.sync("map-a-icloud", "pruneDeleted")).status, "synced");
  assert.equal(harness.remotes["map-a-icloud"].events.size, 0);
});
