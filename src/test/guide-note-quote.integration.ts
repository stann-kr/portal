/**
 * 가이드 글을 노트에 담기(2026-11-16): 담을 노트 목록·페이지 함께 열기·편집기 "가이드 인용" 페이지 목록의
 * 대상 사용자·데이터 소유권 경계와 결정 C(전체 그대로 · 선택 더하기 · 닫힘은 이 페이지만)를 실제 D1에서 확인한다.
 */
import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import { guideAccess, guideAccessPages, guidePages, lessonGroupMembers, lessonGroups, privateNotes, profiles } from "@/db/schema";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession: AuthSession | null = null;
let quote: typeof import("@/lib/actions/guideNoteQuote");

function session(id: string, role: "admin" | "student"): AuthSession {
  return { expires: "2099-01-01T00:00:00.000Z", user: { id, role, name: id, email: `${id}@example.com`, image: null } };
}

function requireActiveDb(): PortalTestDb {
  if (!activeDb) throw new Error("격리 D1 테스트 DB가 준비되지 않았습니다.");
  return activeDb;
}

mock.module("@/auth", { namedExports: { auth: async () => activeSession, signIn: async () => "/dashboard" } });
mock.module("@/db/client", {
  namedExports: {
    createDb: () => requireActiveDb(),
    createDbContext: () => ({ kind: "d1", db: requireActiveDb() }),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });

before(async () => {
  quote = await import("@/lib/actions/guideNoteQuote");
});
after(() => mock.restoreAll());

async function setup(context: TestContext): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  const db = isolated.db;
  await db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "Stann", role: "admin" },
    { id: "student-a", email: "a@example.com", displayName: "학생 A", role: "student" },
    { id: "student-b", email: "b@example.com", displayName: "학생 B", role: "student" },
    { id: "student-c", email: "c@example.com", displayName: "학생 C", role: "student" },
  ]);
  // A: 전체, B: 선택(guide-2만), C: 닫힘(옛 선택 guide-2가 남아 있음).
  await db.insert(guideAccess).values([
    { studentId: "student-a", mode: "ALL" },
    { studentId: "student-b", mode: "SELECTED" },
  ]);
  await db.insert(guidePages).values([
    { id: "guide-1", title: "장비 이해", sortOrder: 0, contentHtml: '<p data-block-id="b1">헤드폰 큐</p>' },
    { id: "guide-2", title: "비트매칭", sortOrder: 1, contentHtml: '<p data-block-id="c1">템포</p>' },
  ]);
  await db.insert(guideAccessPages).values([
    { studentId: "student-b", guidePageId: "guide-2" },
    { studentId: "student-c", guidePageId: "guide-2" },
  ]);
  await db.insert(lessonGroups).values({ id: "group-ab", name: "화요일 2:1" });
  await db.insert(lessonGroupMembers).values([
    { studentId: "student-a", groupId: "group-ab" },
    { studentId: "student-b", groupId: "group-ab" },
  ]);
  await db.insert(privateNotes).values([
    { id: "note-a-own", studentId: "student-a", authorId: "student-a", title: "A 복습", contentHtml: "<p>x</p>" },
    { id: "note-a-stann", studentId: "student-a", authorId: "admin-1", title: "Stann 수업 노트", contentHtml: "<p>x</p>" },
    { id: "note-a-trash", studentId: "student-a", authorId: "student-a", title: "휴지통", contentHtml: "<p>x</p>", deletedAt: new Date() },
    { id: "note-group", studentId: "student-b", authorId: "student-b", groupId: "group-ab", title: "그룹 노트", contentHtml: "<p>x</p>" },
    { id: "note-b-own", studentId: "student-b", authorId: "student-b", title: "B 복습", contentHtml: "<p>x</p>" },
  ]);
  return db;
}

test("학생: 내가 고칠 수 있는 노트(내가 쓴 내 노트·그룹 노트)만, 열리지 않은 페이지는 거절", { concurrency: false }, async (context) => {
  await setup(context);
  activeSession = session("student-a", "student");
  const result = await quote.getGuideQuoteDestinations("guide-1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.spaces, null);
  assert.equal(result.value.newNoteStudentId, "student-a");
  assert.deepEqual(result.value.notes.map((note) => note.id).sort(), ["note-a-own", "note-group"]);
  // 그룹 멤버 B에게 guide-1이 닫혀 있어 그룹 노트에는 담을 수 없다. 학생에게 다른 학생의 열람 상태 이름은 주지 않는다.
  assert.equal(result.value.groupBlocked, true);
  assert.deepEqual(result.value.closedStudents, []);
  // 학생이 다른 공간을 요청해도 본인 공간으로 답한다.
  const spoofed = await quote.getGuideQuoteDestinations("guide-1", { kind: "student", id: "student-b" });
  assert.equal(spoofed.ok && spoofed.value.space.id, "student-a");

  activeSession = session("student-c", "student");
  assert.equal((await quote.getGuideQuoteDestinations("guide-1")).ok, false);
  await assert.rejects(quote.openGuidePageForQuote("guide-1", { kind: "student", id: "student-c" }), /Admin only/);
});

test("관리자: 학생·그룹을 고르고, 볼 수 없는 학생을 알려 준다", { concurrency: false }, async (context) => {
  await setup(context);
  activeSession = session("admin-1", "admin");
  const forA = await quote.getGuideQuoteDestinations("guide-1", { kind: "student", id: "student-a" });
  assert.ok(forA.ok);
  assert.deepEqual(forA.value.spaces?.students.map((student) => student.id), ["student-a", "student-b", "student-c"]);
  assert.deepEqual(forA.value.spaces?.groups.map((group) => [group.id, group.studentId]), [["group-ab", "student-a"]]);
  // 관리자는 학생의 개인 노트를 모두 고친다(휴지통·그룹 노트는 빠진다).
  assert.deepEqual(forA.value.notes.map((note) => note.id).sort(), ["note-a-own", "note-a-stann"]);
  assert.deepEqual(forA.value.closedStudents, []);

  const forGroup = await quote.getGuideQuoteDestinations("guide-1", { kind: "group", id: "group-ab" });
  assert.ok(forGroup.ok);
  assert.deepEqual(forGroup.value.notes.map((note) => note.id), ["note-group"]);
  assert.deepEqual(forGroup.value.closedStudents, [{ id: "student-b", name: "학생 B" }]);
  assert.equal(forGroup.value.newNoteStudentId, "student-a");

  const forC = await quote.getGuideQuoteDestinations("guide-1", { kind: "student", id: "student-c" });
  assert.deepEqual(forC.ok && forC.value.closedStudents, [{ id: "student-c", name: "학생 C" }]);
  assert.equal((await quote.getGuideQuoteDestinations("guide-1", { kind: "student", id: "admin-1" })).ok, false);
  assert.equal((await quote.getGuideQuoteDestinations("guide-1", { kind: "group", id: "group-none" })).ok, false);
  assert.equal((await quote.getGuideQuoteDestinations("guide-missing")).ok, false);
});

test("함께 열기: 전체는 그대로, 선택은 이 페이지를 더하고, 닫힘은 옛 선택을 비우고 이 페이지만 연다", { concurrency: false }, async (context) => {
  const db = await setup(context);
  activeSession = session("admin-1", "admin");
  const opened = await quote.openGuidePageForQuote("guide-1", { kind: "group", id: "group-ab" });
  assert.deepEqual(opened, { ok: true, value: { opened: 1 } });
  const openedC = await quote.openGuidePageForQuote("guide-1", { kind: "student", id: "student-c" });
  assert.deepEqual(openedC, { ok: true, value: { opened: 1 } });
  // 다시 보내도 결과가 같다.
  assert.deepEqual(await quote.openGuidePageForQuote("guide-1", { kind: "student", id: "student-c" }), { ok: true, value: { opened: 0 } });

  const modes = Object.fromEntries((await db.select().from(guideAccess)).map((row) => [row.studentId, row.mode]));
  assert.deepEqual(modes, { "student-a": "ALL", "student-b": "SELECTED", "student-c": "SELECTED" });
  const pages = (await db.select().from(guideAccessPages)).map((row) => `${row.studentId}:${row.guidePageId}`).sort();
  assert.deepEqual(pages, ["student-b:guide-1", "student-b:guide-2", "student-c:guide-1"]);
  assert.equal((await quote.openGuidePageForQuote("guide-missing", { kind: "student", id: "student-c" })).ok, false);
});

test("편집기 가이드 인용: 노트의 학생(그룹은 멤버 모두)과 보는 사람에게 열린 페이지만, 쓰기 권한이 없으면 거절", { concurrency: false }, async (context) => {
  const db = await setup(context);
  activeSession = session("student-a", "student");
  const own = await quote.getGuideQuotePickerPages({ kind: "note", noteId: "note-a-own" });
  assert.deepEqual(own.ok && own.value.map((page) => page.id), ["guide-1", "guide-2"]);
  // 그룹 노트: B는 guide-2만 열려 있다.
  const group = await quote.getGuideQuotePickerPages({ kind: "note", noteId: "note-group" });
  assert.deepEqual(group.ok && group.value.map((page) => page.id), ["guide-2"]);
  assert.equal((await quote.getGuideQuotePickerPage({ kind: "note", noteId: "note-group" }, "guide-1")).ok, false);
  assert.equal((await quote.getGuideQuotePickerPage({ kind: "note", noteId: "note-group" }, "guide-2")).ok, true);
  // Stann이 쓴 내 노트(읽기 전용)·다른 학생 노트·휴지통 노트는 거절한다.
  assert.equal((await quote.getGuideQuotePickerPages({ kind: "note", noteId: "note-a-stann" })).ok, false);
  assert.equal((await quote.getGuideQuotePickerPages({ kind: "note", noteId: "note-b-own" })).ok, false);
  assert.equal((await quote.getGuideQuotePickerPages({ kind: "note", noteId: "note-a-trash" })).ok, false);
  // 만들기 전 공간: 본인·내 그룹만.
  assert.equal((await quote.getGuideQuotePickerPages({ kind: "student", id: "student-a" })).ok, true);
  assert.equal((await quote.getGuideQuotePickerPages({ kind: "student", id: "student-b" })).ok, false);
  assert.equal((await quote.getGuideQuotePickerPages({ kind: "group", id: "group-ab" })).ok, true);

  // 그룹을 떠나면 그룹 노트에서 불러올 수 없다.
  await db.delete(lessonGroupMembers).where(eq(lessonGroupMembers.studentId, "student-a"));
  assert.equal((await quote.getGuideQuotePickerPages({ kind: "note", noteId: "note-group" })).ok, false);

  activeSession = session("admin-1", "admin");
  const stann = await quote.getGuideQuotePickerPages({ kind: "note", noteId: "note-a-stann" });
  assert.deepEqual(stann.ok && stann.value.map((page) => page.id), ["guide-1", "guide-2"]);
  const forC = await quote.getGuideQuotePickerPages({ kind: "student", id: "student-c" });
  assert.deepEqual(forC.ok && forC.value, []);
});
