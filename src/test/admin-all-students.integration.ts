/**
 * 관리자 일정 "전체 학생"과 전체 노트 목록을 격리 D1(실제 D1 SQL·bind 제한)에서 확인한다.
 * 대상 학생을 서버가 직접 정하는지, 학생 묶음(90명)을 나눠 읽는지, 상관 서브쿼리(아직 안 낸 과제)가 D1에서 맞게 도는지 본다.
 */
import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import {
  assignments,
  assignmentTasks,
  calendarEvents,
  lessons,
  privateNotes,
  profiles,
} from "@/db/schema";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession = createSession("admin-1", "admin");
let unifiedActions: typeof import("@/lib/actions/unifiedItems");
let notesActions: typeof import("@/lib/actions/all-notes");
let store: typeof import("@/lib/unified-items-store");
let queryModule: typeof import("@/lib/unified-items-query");

function createSession(id: string, role: "admin" | "student"): AuthSession {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: { id, role, name: id, email: `${id}@example.com`, image: null },
  };
}

function requireActiveDb(): PortalTestDb {
  if (!activeDb) throw new Error("격리 D1 테스트 DB가 준비되지 않았습니다.");
  return activeDb;
}

mock.module("@/auth", {
  namedExports: { auth: async () => activeSession, signIn: async () => "/dashboard" },
});
mock.module("@/db/client", {
  namedExports: {
    createDb: () => requireActiveDb(),
    createDbContext: () => ({ kind: "d1", db: requireActiveDb() }),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });

const realFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = (async (input: unknown) => {
    throw new Error(`테스트 중 외부 요청 금지: ${String(input)}`);
  }) as typeof fetch;
  unifiedActions = await import("@/lib/actions/unifiedItems");
  notesActions = await import("@/lib/actions/all-notes");
  store = await import("@/lib/unified-items-store");
  queryModule = await import("@/lib/unified-items-query");
});

after(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
});

async function setupDatabase(context: TestContext): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  activeSession = createSession("admin-1", "admin");
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  await isolated.db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "Stann", role: "admin" },
    { id: "student-1", email: "student-1@example.com", displayName: "민지", role: "student" },
    { id: "student-2", email: "student-2@example.com", displayName: "준호", role: "student" },
  ]);
  return isolated.db;
}

const at = (iso: string) => new Date(iso);
const RANGE = { start: "2026-10-01", end: "2026-12-31" };

test("전체 학생 일정은 활성 학생 항목을 섞어 돌려주고 학생 칩용 space와 기간·권한을 지킨다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  await db.insert(lessons).values([
    { id: "lesson-1", studentId: "student-1", scheduledAt: at("2026-11-10T10:00:00.000Z") },
    { id: "lesson-2", studentId: "student-2", scheduledAt: at("2026-11-11T10:00:00.000Z") },
    { id: "lesson-outside", studentId: "student-1", scheduledAt: at("2027-03-01T10:00:00.000Z") },
  ]);
  await db.insert(calendarEvents).values([
    { id: "event-2", userId: "student-2", eventType: "PRACTICE", title: "연습", startTime: at("2026-11-12T09:00:00.000Z") },
    // 관리자 본인 일정은 학생 일정이 아니므로 섞이지 않는다.
    { id: "event-admin", userId: "admin-1", eventType: "PRACTICE", title: "관리자 일정", startTime: at("2026-11-12T09:00:00.000Z") },
  ]);
  await db.insert(privateNotes).values([
    { id: "note-1", studentId: "student-1", authorId: "admin-1", title: "레슨 메모", contentHtml: "<p>메모</p>", noteDate: at("2026-11-10T03:00:00.000Z") },
  ]);
  await db.insert(assignmentTasks).values([
    { id: "task-open", studentId: "student-2", title: "연습 일지", submissionFormat: "TEXT", dueAt: at("2026-11-20T00:00:00.000Z") },
    { id: "task-done", studentId: "student-2", title: "믹스셋", submissionFormat: "MIX", dueAt: at("2026-11-21T00:00:00.000Z") },
  ]);
  await db.insert(assignments).values([
    { id: "submission-1", studentId: "student-2", taskId: "task-done", mediaUrl: "https://youtu.be/abc", submittedAt: at("2026-11-19T00:00:00.000Z") },
  ]);

  const result = await unifiedActions.getUnifiedItemsForAllStudents(RANGE);
  const keys = result.items.map((item) => `${item.space.studentId}:${item.source.entity}:${item.id}`).sort();
  assert.deepEqual(keys, [
    "student-1:LESSON:lesson-1",
    "student-1:PRIVATE_NOTE:note-1",
    "student-2:ASSIGNMENT:submission-1",
    "student-2:ASSIGNMENT_TASK:task-open",
    "student-2:CALENDAR_EVENT:event-2",
    "student-2:LESSON:lesson-2",
  ].sort(), "두 학생 항목이 섞여 나오고, 기간 밖·관리자 본인 일정·이미 낸 과제는 빠진다(D1 상관 서브쿼리)");
  assert.equal(result.items.find((item) => item.id === "lesson-2")?.space.label, "준호", "항목마다 학생 이름(칩)이 붙는다");
  assert.ok(result.items.every((item) => item.source.kind === "PORTAL"), "외부 캘린더 항목은 싣지 않는다");
  assert.equal(result.truncated, false);
  assert.equal(result.start, "2026-10-01T00:00:00.000Z");

  // 학생 계정은 전체 학생 일정을 읽을 수 없다.
  activeSession = createSession("student-1", "student");
  await assert.rejects(() => unifiedActions.getUnifiedItemsForAllStudents(RANGE));
  activeSession = createSession("admin-1", "admin");

  // 한 번에 읽는 기간은 넉 달(124일)까지다.
  await assert.rejects(() => unifiedActions.getUnifiedItemsForAllStudents({ start: "2026-01-01", end: "2026-12-31" }), RangeError);

  // 지운 학생(계정 폐기 = profile 삭제)은 대상에서 빠진다. 학생 role이 아닌 계정도 빠진다.
  await db.update(profiles).set({ role: "admin" }).where(eq(profiles.id, "student-2"));
  const withoutSecond = await unifiedActions.getUnifiedItemsForAllStudents(RANGE);
  assert.deepEqual([...new Set(withoutSecond.items.map((item) => item.space.studentId))], ["student-1"]);
});

test("학생이 90명을 넘으면 학생 id를 나눠 bind해 D1 bind 제한 안에서 모두 읽는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  const extra = Array.from({ length: 95 }, (_, index) => `bulk-${String(index).padStart(3, "0")}`);
  // D1 batch도 statement당 bind 100개 제한이 있어 나눠 넣는다.
  for (let index = 0; index < extra.length; index += 20) {
    await db.insert(profiles).values(extra.slice(index, index + 20).map((id) => ({ id, email: `${id}@example.com`, displayName: id, role: "student" })));
  }
  for (let index = 0; index < extra.length; index += 30) {
    await db.insert(lessons).values(extra.slice(index, index + 30).map((id, offset) => ({
      id: `lesson-${id}`,
      studentId: id,
      scheduledAt: at(`2026-11-${String(1 + ((index + offset) % 28)).padStart(2, "0")}T10:00:00.000Z`),
    })));
  }
  const result = await unifiedActions.getUnifiedItemsForAllStudents(RANGE);
  assert.equal(new Set(result.items.map((item) => item.space.studentId)).size, 95, "97명 중 레슨이 있는 95명 모두 나온다");
  assert.equal(result.items.length, 95);

  // store를 직접 불러도 묶음 상한을 넘는 id는 거부한다(실수로 100개 넘게 bind하지 않게).
  const ids = ["student-1", "student-2", ...extra];
  const direct = await store.queryInternalUnifiedItemsForStudents(
    db,
    ids,
    queryModule.resolveAllStudentsItemsQuery(RANGE),
  );
  assert.equal(direct.items.length, 95);
  assert.equal(store.STUDENT_ID_CHUNK <= 90, true);
});

test("전체 노트는 활성 학생 노트를 최근 수정순·학생·종류로 돌려주고 학생 필터는 서버가 확인한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  await db.insert(privateNotes).values([
    { id: "note-a", studentId: "student-1", authorId: "admin-1", title: "레슨 정리", contentHtml: "<p>EQ</p>", updatedAt: at("2026-11-01T00:00:00.000Z") },
    { id: "note-b", studentId: "student-2", authorId: "student-2", title: "연습 기록", contentHtml: "<p>믹스</p>", updatedAt: at("2026-11-03T00:00:00.000Z") },
    { id: "note-trash", studentId: "student-2", authorId: "student-2", title: "지운 노트", contentHtml: "<p>x</p>", deletedAt: at("2026-11-04T00:00:00.000Z") },
  ]);

  const all = await notesActions.getAllStudentNotes();
  assert.deepEqual(all.notes.map((note) => [note.id, note.studentId, note.kind]), [
    ["note-b", "student-2", "STUDENT"],
    ["note-a", "student-1", "STANN"],
  ]);
  assert.deepEqual(all.students.map((student) => student.id).sort(), ["student-1", "student-2"]);
  assert.equal(all.selectedStudentId, null);

  const filtered = await notesActions.getAllStudentNotes({ studentId: "student-1" });
  assert.deepEqual(filtered.notes.map((note) => note.id), ["note-a"]);
  assert.equal(filtered.selectedStudentId, "student-1");
  // 학생이 아닌 id(관리자)를 필터로 보내도 그 노트를 열지 않고 전체로 돌아간다.
  const bogus = await notesActions.getAllStudentNotes({ studentId: "admin-1" });
  assert.equal(bogus.selectedStudentId, null);

  activeSession = createSession("student-1", "student");
  await assert.rejects(() => notesActions.getAllStudentNotes());
});

/** bind 없이 SQL 안에서 노트를 대량으로 만든다(D1 statement당 bind 100개 제한). */
async function seedBulkNotes(db: PortalTestDb, input: { count: number; studentId: string; idPrefix: string; updatedAtBase: number; sameUpdatedAt?: boolean }) {
  await db.run(sql.raw(`
    INSERT INTO private_notes (id, student_id, author_id, title, content_html, updated_at)
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${input.count})
    SELECT printf('${input.idPrefix}-%05d', i), '${input.studentId}', 'admin-1', printf('정리 %d', i), '<p>평범한 레슨 메모</p>',
      ${input.updatedAtBase} ${input.sameUpdatedAt ? "" : "+ i"}
    FROM n
  `));
}

async function collectAllPages(input: { studentId?: string | null; query?: string }) {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page: Awaited<ReturnType<typeof notesActions.getAllStudentNotes>> = await notesActions.getAllStudentNotes({ ...input, cursor });
    assert.ok(page.notes.length <= 50, "한 페이지는 50개 이하");
    ids.push(...page.notes.map((note) => note.id));
    cursor = page.nextCursor;
    pages += 1;
    assert.ok(pages < 100, "페이지가 끝난다");
  } while (cursor);
  return { ids, pages };
}

test("전체 노트는 1,000개를 넘어도 오래된 노트까지 SQL에서 찾고 본문 전체를 싣지 않는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  await seedBulkNotes(db, { count: 1_100, studentId: "student-1", idPrefix: "bulk", updatedAtBase: 1_790_000_000 });
  // 가장 오래된 노트(1,101번째)에만 드문 단어가 있다. 긴 본문 뒤쪽에 둔다.
  const longBody = `<p>${"앞부분 ".repeat(2_000)}</p><p>오래된 <strong>Tempo-Sync</strong> 기록</p>`;
  await db.insert(privateNotes).values({
    id: "note-oldest", studentId: "student-2", authorId: "student-2", title: "첫 노트", contentHtml: longBody, updatedAt: at("2020-01-01T00:00:00.000Z"),
  });

  const first = await notesActions.getAllStudentNotes();
  assert.equal(first.notes.length, 50, "기본 50개씩 읽는다");
  assert.ok(first.nextCursor, "더 있으면 다음 커서를 준다");
  assert.equal(first.continued, false);
  assert.equal(first.notes[0]?.id, "bulk-01100", "최근 수정순");
  for (const note of first.notes) {
    assert.equal("contentHtml" in note, false, "본문 HTML은 응답에 없다");
    assert.ok(note.preview.length <= 200, "미리보기는 짧다");
  }

  const found = await notesActions.getAllStudentNotes({ query: "tempo-sync 기록" });
  assert.deepEqual(found.notes.map((note) => [note.id, note.kind]), [["note-oldest", "STUDENT"]], "1,000개 밖의 오래된 노트도 대소문자 없이 찾는다");
  assert.equal(found.nextCursor, null);
  assert.match(found.notes[0]!.preview, /Tempo-Sync/u, "검색이면 일치 주변을 미리보기로 보인다");
  assert.ok(found.notes[0]!.preview.length <= 200);

  // 모든 단어가 있어야 한다(AND).
  assert.deepEqual((await notesActions.getAllStudentNotes({ query: "tempo-sync 없는단어" })).notes, []);
  // 제목도 찾는다.
  assert.deepEqual((await notesActions.getAllStudentNotes({ query: "정리 1099" })).notes.map((note) => note.id), ["bulk-01099"]);

  const everything = await collectAllPages({});
  assert.equal(everything.ids.length, 1_101, "페이지를 끝까지 넘기면 모두 한 번씩 나온다");
  assert.equal(new Set(everything.ids).size, 1_101, "페이지 경계에서 중복이 없다");
  assert.equal(everything.ids.at(-1), "note-oldest");
});

test("전체 노트 페이지는 수정 시각이 같아도 id로 이어 읽어 중복·누락이 없고 학생 필터와 함께 동작한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  // 한 번에 옮긴 노트처럼 수정 시각이 모두 같은 경우.
  await seedBulkNotes(db, { count: 123, studentId: "student-2", idPrefix: "same", updatedAtBase: 1_790_000_000, sameUpdatedAt: true });
  await seedBulkNotes(db, { count: 7, studentId: "student-1", idPrefix: "other", updatedAtBase: 1_790_000_000, sameUpdatedAt: true });

  const filtered = await collectAllPages({ studentId: "student-2" });
  assert.equal(filtered.pages, 3);
  const expected = Array.from({ length: 123 }, (_, index) => `same-${String(123 - index).padStart(5, "0")}`);
  assert.deepEqual(filtered.ids, expected, "id 내림차순으로 빠짐없이 한 번씩");

  const all = await collectAllPages({});
  assert.equal(all.ids.length, 130);
  assert.equal(new Set(all.ids).size, 130);

  // 학생 필터는 서버의 활성 학생 목록과 대조한다: 모르는 값·관리자 id는 전체로 돌아간다.
  const bogus = await notesActions.getAllStudentNotes({ studentId: "admin-1" });
  assert.equal(bogus.selectedStudentId, null);
  // 깨진 커서는 첫 페이지로 돌아간다.
  const broken = await notesActions.getAllStudentNotes({ studentId: "student-2", cursor: "%%%not-a-cursor" });
  assert.equal(broken.continued, false);
  assert.equal(broken.notes[0]?.id, "same-00123");
});

test("전체 노트 검색은 %·_·\\를 글자 그대로 찾고 HTML 엔티티로 저장된 글자도 찾는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  await db.insert(privateNotes).values([
    { id: "pct", studentId: "student-1", authorId: "admin-1", title: "진도 100% 완료", contentHtml: "<p>x</p>", updatedAt: at("2026-11-01T00:00:00.000Z") },
    { id: "no-pct", studentId: "student-1", authorId: "admin-1", title: "진도 1000 완료", contentHtml: "<p>x</p>", updatedAt: at("2026-11-02T00:00:00.000Z") },
    { id: "under", studentId: "student-2", authorId: "admin-1", title: "메모", contentHtml: "<p>low_cut 필터</p>", updatedAt: at("2026-11-03T00:00:00.000Z") },
    { id: "no-under", studentId: "student-2", authorId: "admin-1", title: "메모", contentHtml: "<p>lowXcut 필터</p>", updatedAt: at("2026-11-04T00:00:00.000Z") },
    { id: "slash", studentId: "student-2", authorId: "admin-1", title: "경로 C:\\Music", contentHtml: "<p>x</p>", updatedAt: at("2026-11-05T00:00:00.000Z") },
    { id: "amp", studentId: "student-2", authorId: "admin-1", title: "장르", contentHtml: "<p>R&amp;B 셋</p>", updatedAt: at("2026-11-06T00:00:00.000Z") },
  ]);
  const ids = async (query: string, studentId?: string) =>
    (await notesActions.getAllStudentNotes({ query, studentId })).notes.map((note) => note.id);
  assert.deepEqual(await ids("100%"), ["pct"], "%는 와일드카드가 아니다");
  assert.deepEqual(await ids("low_cut"), ["under"], "_는 와일드카드가 아니다");
  assert.deepEqual(await ids("c:\\music"), ["slash"], "\\도 글자 그대로");
  assert.deepEqual(await ids("%"), ["pct"]);
  assert.deepEqual(await ids("r&b"), ["amp"], "본문의 &amp;도 &로 찾는다");
  assert.deepEqual(await ids("필터", "student-1"), [], "학생 필터와 검색을 함께 건다");
  assert.deepEqual(await ids("필터", "student-2"), ["no-under", "under"]);
});

test("전체 노트는 학생이 100명을 넘어도 학생 id를 bind하지 않고 한 번에 읽으며 학생 계정은 읽을 수 없다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  await db.run(sql.raw(`
    INSERT INTO profiles (id, email, display_name, role)
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 120)
    SELECT printf('many-%03d', i), printf('many-%03d@example.com', i), printf('학생 %d', i), 'student' FROM n
  `));
  await db.run(sql.raw(`
    INSERT INTO private_notes (id, student_id, author_id, title, content_html, updated_at)
    SELECT 'note-' || id, id, id, '연습', '<p>연습</p>', 1790000000 FROM profiles WHERE id LIKE 'many-%'
  `));
  // 관리자 본인 노트처럼 학생이 아닌 대상의 노트는 섞이지 않는다.
  await db.insert(privateNotes).values({ id: "note-admin-target", studentId: "admin-1", authorId: "admin-1", title: "연습", contentHtml: "<p>연습</p>" });
  const all = await collectAllPages({ query: "연습" });
  assert.equal(all.ids.length, 120);
  assert.equal(all.ids.includes("note-admin-target"), false);
  const page = await notesActions.getAllStudentNotes();
  assert.equal(page.students.length, 122);

  activeSession = createSession("student-1", "student");
  await assert.rejects(() => notesActions.getAllStudentNotes());
  await assert.rejects(() => notesActions.getAllStudentNotes({ studentId: "student-1", query: "연습" }));
});
