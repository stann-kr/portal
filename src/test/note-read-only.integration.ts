/**
 * 노트 학생 편집 막기(0036 `student_read_only`, 2026-11-23 사용자 결정)와 공동 편집 버전의 실제 편집자(`contributor_ids`).
 * 기본은 함께 쓰기이고, 관리자가 만든 노트만 관리자가 읽기 전용으로 바꾼다. 막으면 학생(그룹 멤버)은 읽기만 하고
 * 저장·휴지통 이동·날짜 이동이 원자 쓰기 안에서 거절된다. 관리자와 작성자 본인은 그대로 쓴다.
 */
import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import { privateNotes, profiles } from "@/db/schema";
import { CREATION_OPERATION_FIELD } from "@/lib/creation-operation";
import { PRIVATE_NOTE_BASE_REVISION_FIELD, PRIVATE_NOTE_GROUP_FIELD } from "@/lib/private-note-continuity";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession: AuthSession | null = null;
let notes: typeof import("@/lib/actions/privateNotes");
let access: typeof import("@/lib/actions/noteStudentAccess");
let groups: typeof import("@/lib/actions/lessonGroups");
let atomic: typeof import("@/lib/private-note-atomic");

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
mock.module("next/navigation", {
  namedExports: {
    redirect: (path: string) => {
      throw new Error(`예상하지 않은 redirect: ${path}`);
    },
  },
});

before(async () => {
  [notes, access, groups, atomic] = await Promise.all([
    import("@/lib/actions/privateNotes"),
    import("@/lib/actions/noteStudentAccess"),
    import("@/lib/actions/lessonGroups"),
    import("@/lib/private-note-atomic"),
  ]);
});
after(() => mock.restoreAll());

async function setupDatabase(context: TestContext): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  activeSession = null;
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  await isolated.db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "Stann", role: "admin" },
    { id: "student-a", email: "a@example.com", displayName: "김학생", role: "student" },
    { id: "student-b", email: "b@example.com", displayName: "이학생", role: "student" },
  ]);
  return isolated.db;
}

function as(id: string, role: "admin" | "student" = "student"): void {
  activeSession = { expires: "2099-01-01T00:00:00.000Z", user: { id, role, name: id, email: `${id}@example.com`, image: null } };
}

function createForm(title: string, groupId: string | null = null): FormData {
  const formData = new FormData();
  formData.set(CREATION_OPERATION_FIELD, crypto.randomUUID());
  formData.set("title", title);
  formData.set("contentHtml", "<p>처음</p>");
  formData.set("noteDate", "2026-11-23");
  if (groupId) formData.set(PRIVATE_NOTE_GROUP_FIELD, groupId);
  return formData;
}

function updateForm(contentHtml: string, baseRevision: number): FormData {
  const formData = new FormData();
  formData.set(CREATION_OPERATION_FIELD, crypto.randomUUID());
  formData.set(PRIVATE_NOTE_BASE_REVISION_FIELD, String(baseRevision));
  formData.set("title", "수업 노트");
  formData.set("contentHtml", contentHtml);
  formData.set("noteDate", "2026-11-23");
  return formData;
}

async function headVersion(db: PortalTestDb, noteId: string): Promise<number> {
  const [row] = await db.select({ version: privateNotes.version }).from(privateNotes).where(eq(privateNotes.id, noteId));
  return row.version;
}

test("읽기 전용: 기본은 함께 쓰기이고, 관리자가 막으면 학생은 읽기만 하며 저장·휴지통 이동이 거절되고 풀면 다시 쓴다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  as("admin-1", "admin");
  const created = await notes.createPrivateNote("student-a", {}, createForm("수업 노트"));
  assert.equal(created.success, true, created.error);
  const noteId = created.note!.id;

  as("student-a");
  assert.equal((await notes.getPrivateNote(noteId))?.access, "write", "기본은 함께 쓰기");

  // 학생은 바꿀 수 없다(관리자만).
  await assert.rejects(access.setNoteStudentReadOnly(noteId, true));

  as("admin-1", "admin");
  assert.deepEqual(await access.setNoteStudentReadOnly(noteId, true), { ok: true, studentReadOnly: true });

  as("student-a");
  const locked = await notes.getPrivateNote(noteId);
  assert.equal(locked?.access, "read", "읽기 전용");
  assert.equal(locked?.canManageLifecycle, false);
  const denied = await notes.updatePrivateNote(noteId, {}, updateForm("<p>학생이 고침</p>", await headVersion(db, noteId)));
  assert.equal(denied.success, undefined);
  assert.equal(denied.conflictKind, "NOT_FOUND_OR_FORBIDDEN");
  // 원자 쓰기도 같은 규칙으로 거절한다(미리 읽은 판단을 건너뛰어도).
  const raw = await atomic.updatePrivateNoteAtomically({ kind: "d1", db } as never, {
    actor: { id: "student-a", isAdmin: false },
    noteId,
    operationId: crypto.randomUUID(),
    baseRevision: await headVersion(db, noteId),
    title: "수업 노트",
    contentHtml: "<p>우회</p>",
    noteDate: new Date("2026-11-23T00:00:00Z"),
    now: new Date(),
  });
  assert.equal(raw.ok, false);

  // 관리자는 그대로 쓴다.
  as("admin-1", "admin");
  const adminSave = await notes.updatePrivateNote(noteId, {}, updateForm("<p>Stann이 고침</p>", await headVersion(db, noteId)));
  assert.equal(adminSave.success, true, adminSave.error);

  assert.deepEqual(await access.setNoteStudentReadOnly(noteId, false), { ok: true, studentReadOnly: false });
  as("student-a");
  assert.equal((await notes.getPrivateNote(noteId))?.access, "write", "풀면 다시 함께 쓰기");
  const saved = await notes.updatePrivateNote(noteId, {}, updateForm("<p>학생이 다시 고침</p>", await headVersion(db, noteId)));
  assert.equal(saved.success, true, saved.error);
});

test("읽기 전용: 학생이 만든 노트는 막을 수 없고, 그룹 노트를 막으면 멤버는 읽기만 하고 관리자는 그대로 쓴다", { concurrency: false }, async (context) => {
  await setupDatabase(context);
  as("student-a");
  const own = await notes.createPrivateNote("student-a", {}, createForm("내 노트"));
  assert.equal(own.success, true, own.error);
  as("admin-1", "admin");
  const refused = await access.setNoteStudentReadOnly(own.note!.id, true);
  assert.equal(refused.ok, false);
  as("student-a");
  assert.equal((await notes.getPrivateNote(own.note!.id))?.access, "write");

  as("admin-1", "admin");
  const group = await groups.saveLessonGroupAction({ groupId: null, name: "화요 그룹", memberIds: ["student-a", "student-b"] });
  assert.equal(group.ok, true);
  const groupId = group.ok ? group.id! : "";
  const groupNote = await notes.createPrivateNote("student-a", {}, createForm("그룹 수업", groupId));
  assert.equal(groupNote.success, true, groupNote.error);
  assert.deepEqual(await access.setNoteStudentReadOnly(groupNote.note!.id, true), { ok: true, studentReadOnly: true });
  for (const member of ["student-a", "student-b"]) {
    as(member);
    const read = await notes.getPrivateNote(groupNote.note!.id);
    assert.equal(read?.access, "read", member);
    assert.equal(read?.canManageLifecycle, false, member);
  }
  as("admin-1", "admin");
  assert.equal((await notes.getPrivateNote(groupNote.note!.id))?.access, "write");
});

test("버전 편집자: 공동 편집 저장은 저장 담당이 아니라 room이 기록한 편집자 이름을 이력에 보이고, 그 전 버전은 저장한 사람이다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  as("admin-1", "admin");
  const created = await notes.createPrivateNote("student-a", {}, createForm("수업 노트"));
  assert.equal(created.success, true, created.error);
  const noteId = created.note!.id;

  // 학생이 고친 내용을 Stann의 탭이 저장 담당으로 저장한다.
  const saved = await atomic.updatePrivateNoteAtomically({ kind: "d1", db } as never, {
    actor: { id: "admin-1", isAdmin: true },
    noteId,
    operationId: crypto.randomUUID(),
    baseRevision: await headVersion(db, noteId),
    title: "수업 노트",
    contentHtml: "<p>학생이 쓴 줄</p>",
    noteDate: new Date("2026-11-23T00:00:00Z"),
    contributorIds: ["student-a"],
    now: new Date(),
  });
  assert.equal(saved.ok, true);
  const both = await atomic.updatePrivateNoteAtomically({ kind: "d1", db } as never, {
    actor: { id: "admin-1", isAdmin: true },
    noteId,
    operationId: crypto.randomUUID(),
    baseRevision: await headVersion(db, noteId),
    title: "수업 노트",
    contentHtml: "<p>둘이 쓴 줄</p>",
    noteDate: new Date("2026-11-23T00:00:00Z"),
    contributorIds: ["student-a", "admin-1"],
    now: new Date(),
  });
  assert.equal(both.ok, true);

  const revisions = await notes.getPrivateNoteRevisions(noteId);
  assert.deepEqual(
    revisions.map((revision) => [revision.revisionNumber, revision.actorId, revision.actorName]),
    [
      [3, "admin-1", "김학생, Stann"],
      [2, "admin-1", "김학생"],
      [1, "admin-1", "Stann"],
    ],
    "저장 영수증의 actor는 그대로 저장한 사람이고, 보이는 이름만 실제 편집자다",
  );
});
