/**
 * 그룹 노트(private_notes.group_id) 접근 경계. 2026-11-15/16 사용자 결정:
 * 읽기·쓰기(함께 고치기·휴지통·복원·되돌리기·이력·매체 읽기)는 관리자 또는 지금 그 그룹 멤버이고,
 * student_id·author_id(만든 사람)로 정하지 않는다. 개인 노트 목록에는 그룹 노트가 섞이지 않는다.
 */
import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import { instructorMemos, mediaObjects, privateNoteRevisions, privateNotes, profiles } from "@/db/schema";
import { CREATION_OPERATION_FIELD } from "@/lib/creation-operation";
import { PRIVATE_NOTE_BASE_REVISION_FIELD, PRIVATE_NOTE_GROUP_FIELD } from "@/lib/private-note-continuity";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeBinding: IsolatedPortalD1["binding"] | null = null;
let activeSession: AuthSession | null = null;
let notes: typeof import("@/lib/actions/privateNotes");
let groups: typeof import("@/lib/actions/lessonGroups");
let atomic: typeof import("@/lib/private-note-atomic");
let collab: typeof import("@/lib/collab/authorize");
let mediaRead: typeof import("@/lib/media-read-access");
let noteAccess: typeof import("@/lib/note-access");
let memos: typeof import("@/lib/actions/instructorMemos");

function createSession(id: string, role: "admin" | "student"): AuthSession {
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
mock.module("next/navigation", {
  namedExports: {
    redirect: (path: string) => {
      throw new Error(`예상하지 않은 redirect: ${path}`);
    },
  },
});

before(async () => {
  [notes, groups, atomic, collab, mediaRead, noteAccess, memos] = await Promise.all([
    import("@/lib/actions/privateNotes"),
    import("@/lib/actions/lessonGroups"),
    import("@/lib/private-note-atomic"),
    import("@/lib/collab/authorize"),
    import("@/lib/media-read-access"),
    import("@/lib/note-access"),
    import("@/lib/actions/instructorMemos"),
  ]);
});
after(() => mock.restoreAll());

async function setupDatabase(context: TestContext): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  activeBinding = isolated.binding;
  activeSession = null;
  context.after(async () => {
    activeDb = null;
    activeBinding = null;
    await isolated.dispose();
  });
  await isolated.db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "Stann", role: "admin" },
    { id: "student-a", email: "a@example.com", displayName: "김학생", role: "student" },
    { id: "student-b", email: "b@example.com", displayName: "이학생", role: "student" },
    { id: "student-c", email: "c@example.com", displayName: "박학생", role: "student" },
  ]);
  return isolated.db;
}

function as(id: string, role: "admin" | "student" = "student"): void {
  activeSession = createSession(id, role);
}

async function createGroup(memberIds: string[], name = "화요일반"): Promise<string> {
  as("admin-1", "admin");
  const created = await groups.saveLessonGroupAction({ groupId: null, name, memberIds });
  assert.equal(created.ok, true);
  return created.ok ? created.id! : "";
}

function createForm(title: string, contentHtml: string, groupId: string | null, operationId = crypto.randomUUID()): FormData {
  const formData = new FormData();
  formData.set(CREATION_OPERATION_FIELD, operationId);
  formData.set("title", title);
  formData.set("contentHtml", contentHtml);
  formData.set("noteDate", "2026-11-16");
  if (groupId) formData.set(PRIVATE_NOTE_GROUP_FIELD, groupId);
  return formData;
}

function updateForm(title: string, contentHtml: string, baseRevision: number): FormData {
  const formData = new FormData();
  formData.set(CREATION_OPERATION_FIELD, crypto.randomUUID());
  formData.set(PRIVATE_NOTE_BASE_REVISION_FIELD, String(baseRevision));
  formData.set("title", title);
  formData.set("contentHtml", contentHtml);
  formData.set("noteDate", "2026-11-16");
  return formData;
}

const collabLoaders = () => ({
  async findNote(id: string) {
    const [row] = await requireActiveDb()
      .select({ studentId: privateNotes.studentId, authorId: privateNotes.authorId, groupId: privateNotes.groupId, studentReadOnly: privateNotes.studentReadOnly, deletedAt: privateNotes.deletedAt })
      .from(privateNotes)
      .where(eq(privateNotes.id, id))
      .limit(1);
    return row ? { ...row, lifecycle: 0 } : null;
  },
  findPost: async () => null,
  findGuidePage: async () => null,
  findQnaThread: async () => null,
  findQnaReply: async () => null,
  isActiveStudent: async () => true,
  isGroupMember: (studentId: string, groupId: string) =>
    noteAccess.isCurrentLessonGroupMember({ kind: "d1", db: requireActiveDb() } as never, studentId, groupId),
});

async function seedNoteImage(db: PortalTestDb, noteId: string, ownerId: string): Promise<string> {
  // 이 테스트는 매체 읽기 경계만 본다. 업로드 수명주기는 media-lifecycle 테스트가 지키므로
  // 이 격리 DB에서만 insert guard를 빼고 첨부 완료 행을 바로 넣는다.
  await activeBinding!.prepare("DROP TRIGGER IF EXISTS `media_objects_before_insert_guard`").run();
  const id = crypto.randomUUID();
  const now = new Date("2026-11-16T00:00:00Z");
  await db.insert(mediaObjects).values({
    id,
    ownerId,
    purpose: "DOCUMENT_IMAGE",
    objectKey: `media/document-image/${crypto.randomUUID()}`,
    uploadObjectKey: `media-upload/document-image/${id}`,
    state: "ATTACHED",
    expectedContentType: "image/png",
    expectedSizeBytes: 10,
    actualSizeBytes: 10,
    etag: "etag",
    draftOperationId: crypto.randomUUID(),
    resourceType: "PRIVATE_NOTE",
    resourceId: noteId,
    uploadExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    readyAt: now,
    attachedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

test("그룹 노트: 멤버 A가 만들고 멤버 B·관리자는 같은 결과로 읽고 고치고 휴지통·복원·되돌리기를 한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  const groupId = await createGroup(["student-a", "student-b"]);

  // A가 본인 공간에서 그룹 노트로 만든다: student_id = author_id = A, group_id = 그룹.
  as("student-a");
  const created = await notes.createPrivateNote("student-a", {}, createForm("그룹 수업", "<p>A가 쓴 본문</p>", groupId));
  assert.equal(created.success, true, created.error);
  const noteId = created.note!.id;
  const [row] = await db.select().from(privateNotes).where(eq(privateNotes.id, noteId));
  assert.deepEqual([row.studentId, row.authorId, row.groupId], ["student-a", "student-a", groupId]);

  // A와 B가 읽는 결과가 같다(쓰기 권한·그룹 이름·멤버 포함).
  const readAs = async (id: string, role: "admin" | "student" = "student") => {
    as(id, role);
    const note = await notes.getPrivateNote(noteId);
    return note && { title: note.title, contentHtml: note.contentHtml, version: note.version, access: note.access, group: note.group };
  };
  const seenByA = await readAs("student-a");
  assert.equal(seenByA?.access, "write");
  assert.deepEqual(seenByA?.group, { id: groupId, name: "화요일반", members: [{ id: "student-a", name: "김학생" }, { id: "student-b", name: "이학생" }] });
  assert.deepEqual(await readAs("student-b"), seenByA);
  assert.deepEqual(await readAs("admin-1", "admin"), seenByA);
  as("student-b");
  assert.equal((await notes.getPrivateNoteHead(noteId))?.version, 1);
  assert.equal((await notes.getPrivateNoteCollabSeed(noteId)).status, "ok");

  // B가 고친다(만든 사람이 아니어도 멤버면 쓴다). 이력의 actor는 B다.
  const updated = await notes.updatePrivateNote(noteId, {}, updateForm("그룹 수업", "<p>B가 고친 본문</p>", 1));
  assert.equal(updated.success, true, updated.error);
  assert.equal(updated.currentRevision, 2);
  as("student-a");
  assert.equal((await notes.getPrivateNote(noteId))?.contentHtml, "<p>B가 고친 본문</p>");
  const revisions = await db.select().from(privateNoteRevisions).where(eq(privateNoteRevisions.noteId, noteId));
  assert.deepEqual(revisions.map((revision) => revision.actorId).sort(), ["student-a", "student-b"]);
  as("student-b");
  assert.equal((await notes.getPrivateNoteRevisions(noteId)).length, 2, "B도 이력을 본다");

  // B가 휴지통으로 옮기고, A가 휴지통에서 보고 되살린다.
  as("student-b");
  assert.equal((await notes.trashPrivateNote(noteId, crypto.randomUUID(), 2)).success, true);
  as("student-a");
  const trashA = await notes.getTrashedPrivateNotes("student-a");
  assert.deepEqual(trashA.map((note) => [note.id, note.groupName, note.canWrite]), [[noteId, "화요일반", true]]);
  as("student-b");
  assert.deepEqual((await notes.getTrashedPrivateNotes("student-b")).map((note) => note.id), [noteId], "B의 휴지통에도 같은 그룹 노트");
  as("student-a");
  assert.equal((await notes.restorePrivateNote(noteId, crypto.randomUUID(), 3)).success, true);

  // B가 첫 버전으로 되돌린다.
  as("student-b");
  const restored = await notes.restorePrivateNoteRevision(noteId, crypto.randomUUID(), 4, 1);
  assert.equal(restored.success, true, restored.error);
  as("student-a");
  assert.equal((await notes.getPrivateNote(noteId))?.contentHtml, "<p>A가 쓴 본문</p>");

  // 관리자도 고친다.
  as("admin-1", "admin");
  const adminUpdate = await notes.updatePrivateNote(noteId, {}, updateForm("그룹 수업", "<p>Stann 메모</p>", 5));
  assert.equal(adminUpdate.success, true, adminUpdate.error);

  // 같은 operation을 B가 다시 보내도(응답 유실) 영수증으로 같은 결과를 받는다.
  as("student-b");
  const replayForm = updateForm("그룹 수업", "<p>B 재전송</p>", 6);
  const first = await notes.updatePrivateNote(noteId, {}, replayForm);
  const replay = await notes.updatePrivateNote(noteId, {}, replayForm);
  assert.equal(first.success, true, first.error);
  assert.equal(replay.success, true, replay.error);
  assert.equal(replay.replayed, true);
  assert.equal(replay.currentRevision, first.currentRevision);
});

test("그룹 노트: 멤버 아닌 학생과 그룹을 떠난 학생은 읽기·쓰기·공동 편집·매체 모두 거부된다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  const groupId = await createGroup(["student-a", "student-b"]);
  as("student-a");
  const created = await notes.createPrivateNote("student-a", {}, createForm("그룹 노트", "<p>본문</p>", groupId));
  const noteId = created.note!.id;
  const imageId = await seedNoteImage(db, noteId, "student-a");

  const expectDenied = async (studentId: string, label: string) => {
    as(studentId);
    await assert.rejects(notes.getPrivateNote(noteId), /Unauthorized/, `${label} 읽기`);
    assert.equal((await notes.getPrivateNoteCollabSeed(noteId)).status, "missing", `${label} 시드`);
    await assert.rejects(notes.getPrivateNoteHead(noteId), /Unauthorized/, `${label} head`);
    const update = await notes.updatePrivateNote(noteId, {}, updateForm("x", "<p>침범</p>", 1));
    assert.equal(update.conflictKind, "NOT_FOUND_OR_FORBIDDEN", `${label} 고치기`);
    assert.equal((await notes.trashPrivateNote(noteId, crypto.randomUUID(), 1)).conflictKind, "NOT_FOUND_OR_FORBIDDEN", `${label} 휴지통`);
    // 미리 읽기를 건너뛴 원자 쓰기도 같은 batch의 멤버십 조건이 막는다.
    const direct = await atomic.updatePrivateNoteAtomically({ kind: "d1", db } as never, {
      actor: { id: studentId, isAdmin: false },
      noteId,
      operationId: crypto.randomUUID(),
      baseRevision: 1,
      title: "x",
      contentHtml: "<p>침범</p>",
      noteDate: null,
      now: new Date(),
    });
    assert.deepEqual(direct, { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" }, `${label} 원자 쓰기`);
    assert.deepEqual(
      await collab.authorizeCollabRequest({ id: studentId, isAdmin: false }, { key: `note:${noteId}` }, collabLoaders()),
      { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" },
      `${label} 공동 편집`,
    );
    assert.equal(await mediaRead.loadReadableMedia(db, { id: studentId, role: "student" }, imageId), null, `${label} 매체`);
    const [row] = await db.select({ contentHtml: privateNotes.contentHtml, version: privateNotes.version }).from(privateNotes).where(eq(privateNotes.id, noteId));
    assert.deepEqual(row, { contentHtml: "<p>본문</p>", version: 1 }, `${label} 뒤에도 그대로`);
  };

  // 지금 멤버 B·관리자는 공동 편집 쓰기·매체를 받는다.
  assert.deepEqual(
    await collab.authorizeCollabRequest({ id: "student-b", isAdmin: false }, { key: `note:${noteId}` }, collabLoaders()),
    { ok: true, key: `note:${noteId}`, mode: "write", lifecycle: 0 },
  );
  assert.ok(await mediaRead.loadReadableMedia(db, { id: "student-b", role: "student" }, imageId));
  assert.ok(await mediaRead.loadReadableMedia(db, { id: "admin-1", role: "admin" }, imageId));

  await expectDenied("student-c", "멤버 아님");

  // A(만든 사람)를 그룹에서 빼면 A는 접근을 잃고 노트는 그룹에 남는다. 새로 들어온 C는 접근한다.
  as("admin-1", "admin");
  assert.equal((await groups.saveLessonGroupAction({ groupId, name: "화요일반", memberIds: ["student-b", "student-c"] })).ok, true);
  await expectDenied("student-a", "떠난 만든 사람");
  as("student-a");
  assert.deepEqual((await notes.getTrashedPrivateNotes("student-a")).length, 0);
  assert.equal(await notes.getStudentGroupNotes("student-a"), null);
  as("student-c");
  assert.equal((await notes.getPrivateNote(noteId))?.access, "write");
  assert.deepEqual((await notes.getStudentGroupNotes("student-c"))?.notes.map((note) => note.id), [noteId]);
  const [row] = await db.select({ groupId: privateNotes.groupId }).from(privateNotes).where(eq(privateNotes.id, noteId));
  assert.equal(row.groupId, groupId);
});

test("그룹 노트 만들기: 학생은 본인 그룹만, 관리자는 어느 그룹이든(관리자 이름으로), 개인 목록에는 섞이지 않는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  const groupId = await createGroup(["student-a", "student-b"]);

  // 멤버 아닌 학생 C는 이 그룹 노트를 만들 수 없다(같은 INSERT 안에서 막힌다).
  as("student-c");
  const denied = await notes.createPrivateNote("student-c", {}, createForm("남의 그룹", "<p>x</p>", groupId));
  assert.equal(denied.conflictKind, "NOT_FOUND_OR_FORBIDDEN");
  // 없는 그룹도 거부한다.
  as("student-a");
  assert.equal((await notes.createPrivateNote("student-a", {}, createForm("없는 그룹", "<p>x</p>", "missing-group"))).conflictKind, "NOT_FOUND_OR_FORBIDDEN");
  assert.equal((await db.select().from(privateNotes)).length, 0);

  // 개인 노트 하나와 그룹 노트 하나.
  as("student-a");
  const personal = await notes.createPrivateNote("student-a", {}, createForm("내 노트", "<p>개인</p>", null));
  const groupNote = await notes.createPrivateNote("student-a", {}, createForm("그룹 노트", "<p>함께</p>", groupId));
  assert.equal(personal.success && groupNote.success, true);

  // 같은 operation으로 저장 위치만 바꿔 다시 보내면 다른 요청이다.
  const reusedOperation = crypto.randomUUID();
  as("student-a");
  assert.equal((await notes.createPrivateNote("student-a", {}, createForm("위치", "<p>x</p>", null, reusedOperation))).success, true);
  assert.equal(
    (await notes.createPrivateNote("student-a", {}, createForm("위치", "<p>x</p>", groupId, reusedOperation))).conflictKind,
    "OPERATION_PAYLOAD_CONFLICT",
  );

  // 관리자가 B의 공간에서 그룹 노트를 쓰면 student_id·author_id는 관리자다.
  as("admin-1", "admin");
  const adminGroupNote = await notes.createPrivateNote("student-b", {}, createForm("Stann 그룹 노트", "<p>수업 정리</p>", groupId));
  assert.equal(adminGroupNote.success, true, adminGroupNote.error);
  const [adminRow] = await db.select().from(privateNotes).where(eq(privateNotes.id, adminGroupNote.note!.id));
  assert.deepEqual([adminRow.studentId, adminRow.authorId, adminRow.groupId], ["admin-1", "admin-1", groupId]);

  // 개인 목록에는 그룹 노트가 없다(A·B 모두). 그룹 노트 보기에는 둘 다 같은 그룹 노트가 보인다.
  as("student-a");
  assert.deepEqual((await notes.getPrivateNotes("student-a")).map((note) => note.title).sort(), ["내 노트", "위치"]);
  as("student-b");
  assert.deepEqual((await notes.getPrivateNotes("student-b")).map((note) => note.title), []);
  const groupViewB = await notes.getStudentGroupNotes("student-b");
  as("student-a");
  const groupViewA = await notes.getStudentGroupNotes("student-a");
  assert.deepEqual(groupViewA?.notes.map((note) => note.title).sort(), ["Stann 그룹 노트", "그룹 노트"]);
  assert.deepEqual(groupViewB, groupViewA);
  // 관리자의 학생 노트 화면도 같은 둘을 본다.
  as("admin-1", "admin");
  assert.deepEqual((await notes.getPrivateNotes("student-a")).map((note) => note.title).sort(), ["내 노트", "위치"]);
  assert.deepEqual((await notes.getStudentGroupNotes("student-b"))?.notes.length, 2);
  // 학생은 다른 학생 공간의 그룹 노트 목록을 부를 수 없다.
  as("student-c");
  await assert.rejects(notes.getStudentGroupNotes("student-a"), /Unauthorized/);

  // 관리자가 만든 그룹 노트도 멤버 B가 고친다.
  as("student-b");
  const update = await notes.updatePrivateNote(adminGroupNote.note!.id, {}, updateForm("Stann 그룹 노트", "<p>B 보탬</p>", 1));
  assert.equal(update.success, true, update.error);

  // 그룹 노트가 남아 있으면(휴지통 포함) 그룹을 해제하지 않는다.
  as("admin-1", "admin");
  const blocked = await groups.deleteLessonGroupAction(groupId);
  assert.equal(blocked.ok, false);
});

test("계정 삭제: 떠난 멤버가 남의 그룹 노트에 올린 이미지는 노트와 함께 남고, 개인 노트 이미지는 지운다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  const groupId = await createGroup(["student-a", "student-b"]);
  as("student-a");
  const groupNote = await notes.createPrivateNote("student-a", {}, createForm("그룹 노트", "<p>함께</p>", groupId));
  as("student-b");
  const personal = await notes.createPrivateNote("student-b", {}, createForm("B 개인", "<p>개인</p>", null));
  assert.equal(groupNote.success && personal.success, true);
  const keptImage = await seedNoteImage(db, groupNote.note!.id, "student-b");
  const removedImage = await seedNoteImage(db, personal.note!.id, "student-b");

  const deleted = await (await import("@/lib/account-privacy-atomic")).deleteStudentAccountAtomically({ kind: "d1", db } as never, {
    actorId: "student-b",
    operationId: crypto.randomUUID(),
    initiatingCleanupTokenDigest: "b".repeat(64),
    useEphemeralCleanupDigest: true,
    now: new Date("2026-11-16T01:00:00Z"),
  });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  const stateOf = async (id: string) =>
    (await db.select({ state: mediaObjects.state }).from(mediaObjects).where(eq(mediaObjects.id, id)))[0]?.state ?? "GONE";
  assert.equal(await stateOf(keptImage), "ATTACHED", "그룹 노트 이미지는 남는다");
  const [kept] = await db.select({ ownerId: mediaObjects.ownerId }).from(mediaObjects).where(eq(mediaObjects.id, keptImage));
  assert.equal(kept.ownerId, "student-a", "남는 이미지는 그 노트의 주인에게 넘어간다");
  assert.notEqual(await stateOf(removedImage), "ATTACHED", "개인 노트 이미지는 지울 대상이 된다");
  assert.equal((await db.select().from(privateNotes).where(eq(privateNotes.id, groupNote.note!.id))).length, 1);
  as("student-a");
  assert.ok(await mediaRead.loadReadableMedia(db, { id: "student-a", role: "student" }, keptImage), "남은 멤버가 계속 읽는다");
});

test("그룹 노트 이 수업 메모(캔버스 UxReview1120Policies ⑪)는 관리자만, 노트의 student_id에 붙어 학생 메모와 섞이지 않고 만든 학생 상태와 관계없이 노트와 함께 산다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  const groupId = await createGroup(["student-a", "student-b"]);
  as("student-a");
  const byA = await notes.createPrivateNote("student-a", {}, createForm("A가 만든 그룹 노트", "<p>a</p>", groupId));
  as("student-b");
  const byB = await notes.createPrivateNote("student-b", {}, createForm("B가 만든 그룹 노트", "<p>b</p>", groupId));
  as("admin-1", "admin");
  const byAdmin = await notes.createPrivateNote("student-a", {}, createForm("Stann 그룹 노트", "<p>s</p>", groupId));
  assert.equal(byA.success && byB.success && byAdmin.success, true);
  const [noteA, noteB, noteAdmin] = [byA.note!.id, byB.note!.id, byAdmin.note!.id];

  const save = (scope: Parameters<typeof memos.saveInstructorMemoAction>[0], contentHtml: string, baseVersion = 0) =>
    memos.saveInstructorMemoAction(scope, { contentHtml, baseVersion });
  for (const [noteId, text] of [[noteA, "A 노트 메모"], [noteB, "B 노트 메모"], [noteAdmin, "Stann 노트 메모"]] as const) {
    const saved = await save({ kind: "note", noteId }, `<p>${text}</p>`);
    assert.equal(saved.ok, true, JSON.stringify(saved));
  }
  // 멤버 탭은 그 학생 전체 메모(개인 노트의 학생 메모와 같은 행)다.
  assert.equal((await save({ kind: "student", studentId: "student-a" }, "<p>A 전체</p>")).ok, true);
  const memoRows = await db
    .select({ studentId: instructorMemos.studentId, noteId: instructorMemos.noteId, contentHtml: instructorMemos.contentHtml })
    .from(instructorMemos);
  assert.deepEqual(
    memoRows.map((row) => [row.studentId, row.noteId, row.contentHtml]).sort((a, b) => String(a[2]).localeCompare(String(b[2]))),
    [
      ["student-a", noteA, "<p>A 노트 메모</p>"],
      ["student-a", null, "<p>A 전체</p>"],
      ["student-b", noteB, "<p>B 노트 메모</p>"],
      ["admin-1", noteAdmin, "<p>Stann 노트 메모</p>"],
    ].sort((a, b) => String(a[2]).localeCompare(String(b[2]))),
    "그룹 노트 메모는 노트의 student_id(만든 사람)에 붙고, 학생 전체 메모와 다른 행이다",
  );
  assert.equal((await memos.getInstructorMemo({ kind: "student", studentId: "student-a" }))?.contentHtml, "<p>A 전체</p>");

  // 멤버 학생은 그룹 노트를 고칠 수 있어도 메모는 읽지도 쓰지도 못한다.
  as("student-a");
  await assert.rejects(memos.getInstructorMemo({ kind: "note", noteId: noteA }), /Admin only|Unauthorized/);
  await assert.rejects(save({ kind: "note", noteId: noteA }, "<p>덮어쓰기</p>", 1), /Admin only|Unauthorized/);

  // 만든 학생 A가 수강을 종료해도 그룹 노트 메모는 그대로 읽고 쓴다(개인 노트 메모는 수강 중 학생만).
  await db.update(profiles).set({ accountStatus: "ARCHIVED", archivedAt: new Date("2026-11-17T00:00:00Z") }).where(eq(profiles.id, "student-a"));
  as("admin-1", "admin");
  assert.equal((await memos.getInstructorMemo({ kind: "note", noteId: noteA }))?.contentHtml, "<p>A 노트 메모</p>");
  assert.equal((await save({ kind: "note", noteId: noteA }, "<p>A 노트 메모 2</p>", 1)).ok, true);

  // 휴지통의 그룹 노트에는 메모를 붙이지 않는다.
  as("student-b");
  assert.equal((await notes.trashPrivateNote(noteAdmin, crypto.randomUUID(), 1)).success, true);
  as("admin-1", "admin");
  assert.equal(await memos.getInstructorMemo({ kind: "note", noteId: noteAdmin }), null);

  // B가 계정을 지우면 B가 만든 그룹 노트와 그 메모가 함께 지워지고, 다른 그룹 노트의 메모는 남는다.
  const deleted = await (await import("@/lib/account-privacy-atomic")).deleteStudentAccountAtomically({ kind: "d1", db } as never, {
    actorId: "student-b",
    operationId: crypto.randomUUID(),
    initiatingCleanupTokenDigest: "c".repeat(64),
    useEphemeralCleanupDigest: true,
    now: new Date("2026-11-18T01:00:00Z"),
  });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.equal((await db.select().from(privateNotes).where(eq(privateNotes.id, noteB))).length, 0);
  assert.deepEqual(
    (await db.select({ noteId: instructorMemos.noteId }).from(instructorMemos)).map((row) => row.noteId).sort(),
    [noteA, noteAdmin, null].sort(),
  );
});

test("영구 삭제는 그룹 노트도 관리자만 한다(멤버는 휴지통·복원까지)", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  const groupId = await createGroup(["student-a", "student-b"]);
  as("student-a");
  const created = await notes.createPrivateNote("student-a", {}, createForm("지울 노트", "<p>x</p>", groupId));
  const noteId = created.note!.id;
  assert.equal((await notes.trashPrivateNote(noteId, crypto.randomUUID(), 1)).success, true);
  // B가 되살렸다 다시 휴지통으로 옮긴다. 되살리기 operation은 나중에 응답을 못 받은 재전송으로 다시 보낸다.
  as("student-b");
  const restoreOperation = crypto.randomUUID();
  assert.equal((await notes.restorePrivateNote(noteId, restoreOperation, 2)).success, true);
  assert.equal((await notes.trashPrivateNote(noteId, crypto.randomUUID(), 3)).success, true);
  // 보존 기간이 지난 것처럼 휴지통 시각을 옮긴다.
  await db.update(privateNotes).set({ deletedAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(privateNotes.id, noteId));
  assert.equal((await notes.purgePrivateNote(noteId, crypto.randomUUID(), 4)).conflictKind, "NOT_FOUND_OR_FORBIDDEN");
  as("admin-1", "admin");
  assert.equal((await notes.purgePrivateNote(noteId, crypto.randomUUID(), 4)).success, true);
  assert.equal((await db.select().from(privateNotes)).length, 0);
  // 지금 멤버는 PURGED, 멤버 아닌 학생은 존재를 모른다(NOT_FOUND_OR_FORBIDDEN).
  // (화면 action은 읽기 단계에서 먼저 NOT_FOUND로 거르므로, 원자 쓰기의 판정을 직접 본다.)
  const atomicUpdate = (studentId: string) => atomic.updatePrivateNoteAtomically({ kind: "d1", db } as never, {
    actor: { id: studentId, isAdmin: false },
    noteId,
    operationId: crypto.randomUUID(),
    baseRevision: 4,
    title: "x",
    contentHtml: "<p>x</p>",
    noteDate: null,
    now: new Date(),
  });
  assert.deepEqual(await atomicUpdate("student-b"), { ok: false, reason: "PURGED", noteId });
  assert.deepEqual(await atomicUpdate("student-c"), { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" });
  const replay = await atomic.restoreTrashedPrivateNoteAtomically({ kind: "d1", db } as never, {
    actor: { id: "student-b", isAdmin: false },
    noteId,
    operationId: restoreOperation,
    baseRevision: 2,
    now: new Date(),
  });
  assert.deepEqual(replay, { ok: false, reason: "PURGED", noteId }, "B 영수증 재전송");
  assert.deepEqual(await groups.deleteLessonGroupAction(groupId), { ok: true }, "그룹 노트가 사라지면 해제된다");
});

test("Stann이 만든 개인 노트(2026-11-23 사용자 결정): 노트 주인 학생은 함께 고치고 되돌리지만 휴지통·복원·영구 삭제는 못 하고, 다른 학생은 그대로 막힌다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  as("admin-1", "admin");
  const created = await notes.createPrivateNote("student-a", {}, createForm("수업 노트", "<p>Stann 본문</p>", null));
  assert.equal(created.success, true, created.error);
  const noteId = created.note!.id;
  const [row] = await db.select().from(privateNotes).where(eq(privateNotes.id, noteId));
  assert.deepEqual([row.studentId, row.authorId, row.groupId], ["student-a", "admin-1", null]);

  // 학생 A: 쓰기 권한(이전에는 "read")이지만 휴지통 이동·복원 권한은 없다. 공동 편집도 쓰기로 붙는다.
  as("student-a");
  const seen = await notes.getPrivateNote(noteId);
  assert.equal(seen?.access, "write");
  assert.equal(seen?.canManageLifecycle, false);
  assert.deepEqual(
    await collab.authorizeCollabRequest({ id: "student-a", isAdmin: false }, { key: `note:${noteId}` }, collabLoaders()),
    { ok: true, key: `note:${noteId}`, mode: "write", lifecycle: 0 },
  );

  // A가 고친다. 이력의 actor는 A다.
  const updated = await notes.updatePrivateNote(noteId, {}, updateForm("수업 노트", "<p>A가 덧붙인 본문</p>", 1));
  assert.equal(updated.success, true, updated.error);
  assert.equal(updated.currentRevision, 2);
  const revisions = await db.select().from(privateNoteRevisions).where(eq(privateNoteRevisions.noteId, noteId));
  assert.deepEqual(revisions.map((revision) => revision.actorId).sort(), ["admin-1", "student-a"]);
  assert.equal((await notes.getPrivateNoteRevisions(noteId)).length, 2, "A도 이력을 본다");

  // A가 첫 버전으로 되돌린다(이력 복원은 편집과 같다).
  const restored = await notes.restorePrivateNoteRevision(noteId, crypto.randomUUID(), 2, 1);
  assert.equal(restored.success, true, restored.error);
  assert.equal((await notes.getPrivateNote(noteId))?.contentHtml, "<p>Stann 본문</p>");
  const version = (await notes.getPrivateNote(noteId))!.version;

  // 미리 읽기를 건너뛴 원자 쓰기도 같은 batch 조건(그 학생 본인)으로 통과한다.
  const direct = await atomic.updatePrivateNoteAtomically({ kind: "d1", db } as never, {
    actor: { id: "student-a", isAdmin: false },
    noteId,
    operationId: crypto.randomUUID(),
    baseRevision: version,
    title: "수업 노트",
    contentHtml: "<p>A 원자 쓰기</p>",
    noteDate: null,
    now: new Date(),
  });
  assert.equal(direct.ok, true, JSON.stringify(direct));
  const afterDirect = (await notes.getPrivateNote(noteId))!.version;

  // A는 휴지통으로 옮기지 못한다(작성자·관리자만). 원자 쓰기도 같은 판단이다.
  assert.equal((await notes.trashPrivateNote(noteId, crypto.randomUUID(), afterDirect)).conflictKind, "NOT_FOUND_OR_FORBIDDEN");
  assert.deepEqual(
    await atomic.trashPrivateNoteAtomically({ kind: "d1", db } as never, {
      actor: { id: "student-a", isAdmin: false },
      noteId,
      operationId: crypto.randomUUID(),
      baseRevision: afterDirect,
      now: new Date(),
    }),
    { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" },
  );
  const [stillActive] = await db.select({ deletedAt: privateNotes.deletedAt }).from(privateNotes).where(eq(privateNotes.id, noteId));
  assert.equal(stillActive.deletedAt, null);

  // 수업 메모는 노트를 고칠 수 있어도 관리자만이다.
  await assert.rejects(memos.getInstructorMemo({ kind: "note", noteId }), /Admin only|Unauthorized/);
  await assert.rejects(
    memos.saveInstructorMemoAction({ kind: "note", noteId }, { contentHtml: "<p>침범</p>", baseVersion: 0 }),
    /Admin only|Unauthorized/,
  );

  // 다른 학생 B는 읽기·쓰기·되돌리기·공동 편집 모두 거부된다.
  as("student-b");
  await assert.rejects(notes.getPrivateNote(noteId), /Unauthorized/);
  assert.equal((await notes.updatePrivateNote(noteId, {}, updateForm("x", "<p>침범</p>", afterDirect))).conflictKind, "NOT_FOUND_OR_FORBIDDEN");
  assert.equal((await notes.restorePrivateNoteRevision(noteId, crypto.randomUUID(), afterDirect, 1)).success, undefined);
  assert.deepEqual(
    await atomic.updatePrivateNoteAtomically({ kind: "d1", db } as never, {
      actor: { id: "student-b", isAdmin: false },
      noteId,
      operationId: crypto.randomUUID(),
      baseRevision: afterDirect,
      title: "x",
      contentHtml: "<p>침범</p>",
      noteDate: null,
      now: new Date(),
    }),
    { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" },
  );
  assert.deepEqual(
    await collab.authorizeCollabRequest({ id: "student-b", isAdmin: false }, { key: `note:${noteId}` }, collabLoaders()),
    { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" },
  );
  const [untouched] = await db.select({ contentHtml: privateNotes.contentHtml }).from(privateNotes).where(eq(privateNotes.id, noteId));
  assert.equal(untouched.contentHtml, "<p>A 원자 쓰기</p>");

  // 관리자가 휴지통으로 옮기면 A는 휴지통에서 보지만 복원하지 못한다.
  as("admin-1", "admin");
  assert.equal((await notes.trashPrivateNote(noteId, crypto.randomUUID(), afterDirect)).success, true);
  as("student-a");
  assert.deepEqual((await notes.getTrashedPrivateNotes("student-a")).map((note) => [note.id, note.canWrite]), [[noteId, false]]);
  assert.equal((await notes.getPrivateNoteIncludingTrash(noteId))?.canManageLifecycle, false);
  assert.equal((await notes.restorePrivateNote(noteId, crypto.randomUUID(), afterDirect + 1)).conflictKind, "NOT_FOUND_OR_FORBIDDEN");
  // 관리자는 휴지통에서 되살렸다가 다시 옮긴다.
  as("admin-1", "admin");
  assert.equal((await notes.restorePrivateNote(noteId, crypto.randomUUID(), afterDirect + 1)).success, true);
  assert.equal((await notes.trashPrivateNote(noteId, crypto.randomUUID(), afterDirect + 2)).success, true);
  as("student-a");
  // 영구 삭제는 관리자만이다(보존 기간이 지난 것처럼 옮겨도).
  await db.update(privateNotes).set({ deletedAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(privateNotes.id, noteId));
  assert.equal((await notes.purgePrivateNote(noteId, crypto.randomUUID(), afterDirect + 3)).conflictKind, "NOT_FOUND_OR_FORBIDDEN");
  assert.equal((await db.select().from(privateNotes).where(eq(privateNotes.id, noteId))).length, 1);

  // 학생이 직접 만든 개인 노트는 지금처럼 본인이 휴지통으로 옮긴다.
  as("student-a");
  const own = await notes.createPrivateNote("student-a", {}, createForm("내 노트", "<p>내 본문</p>", null));
  assert.equal(own.success, true, own.error);
  assert.equal((await notes.getPrivateNote(own.note!.id))?.canManageLifecycle, true);
  assert.equal((await notes.trashPrivateNote(own.note!.id, crypto.randomUUID(), 1)).success, true);
});

test("그룹 해제(감사 보완 #8): 휴지통 노트만 남으면 그룹을 해제 표시로 두고 노트는 30일 보존, 관리자만 그룹 휴지통을 열며 되살리지 못하고 기한 뒤 영구 삭제하면 그룹도 사라진다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  const groupId = await createGroup(["student-a", "student-b"]);
  as("student-a");
  const created = await notes.createPrivateNote("student-a", {}, createForm("남길 노트", "<p>x</p>", groupId));
  const noteId = created.note!.id;

  // 쓰이는 그룹 노트가 있으면 해제하지 않는다.
  as("admin-1", "admin");
  const blocked = await groups.deleteLessonGroupAction(groupId);
  assert.equal(blocked.ok, false);
  assert.match(blocked.ok ? "" : blocked.error, /휴지통에 넣은 뒤 해제/u);

  as("student-a");
  assert.equal((await notes.trashPrivateNote(noteId, crypto.randomUUID(), 1)).success, true);
  as("admin-1", "admin");
  assert.deepEqual(await groups.deleteLessonGroupAction(groupId), { ok: true, keptTrashedNotes: 1 });
  assert.deepEqual(await groups.getLessonGroups(), [], "해제한 그룹은 목록에서 빠진다");
  assert.equal((await db.select().from(privateNotes)).length, 1, "휴지통 노트는 보존된다");
  // 해제한 그룹을 다시 고치거나 그 그룹에 노트를 만들 수 없고, 멤버는 다른 그룹에 들어갈 수 있다.
  assert.equal((await groups.saveLessonGroupAction({ groupId, name: "되살리기", memberIds: ["student-a", "student-b"] })).ok, false);
  const regroup = await groups.saveLessonGroupAction({ groupId: null, name: "새 반", memberIds: ["student-a", "student-b"] });
  assert.equal(regroup.ok, true);
  as("student-a");
  assert.ok((await notes.createPrivateNote("student-a", {}, createForm("옛 그룹에", "<p>x</p>", groupId))).error, "해제한 그룹에는 노트를 만들 수 없다");

  // 그룹 휴지통: 관리자만, 해제 표시와 함께. 학생은 막힌다.
  await assert.rejects(notes.getTrashedGroupNotes(groupId));
  await assert.rejects(notes.getTrashGroupChoices());
  as("admin-1", "admin");
  const trash = await notes.getTrashedGroupNotes(groupId);
  assert.ok(trash);
  assert.deepEqual([trash.group.dissolved, trash.notes.map((note) => note.id)], [true, [noteId]]);
  const choices = await notes.getTrashGroupChoices();
  assert.deepEqual(choices.map((group) => [group.id, group.dissolved, group.trashedCount]), [[groupId, true, 1]]);

  // 해제한 그룹의 노트는 관리자도 되살리지 못한다(어느 목록에도 보이지 않게 된다).
  assert.notEqual((await notes.restorePrivateNote(noteId, crypto.randomUUID(), 2)).success, true);
  // 기한 전 영구 삭제는 보존 기간 때문에 거절된다.
  assert.notEqual((await notes.purgePrivateNote(noteId, crypto.randomUUID(), 2)).success, true);
  await db.update(privateNotes).set({ deletedAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(privateNotes.id, noteId));
  assert.equal((await notes.purgePrivateNote(noteId, crypto.randomUUID(), 2)).success, true);
  assert.equal(await notes.getTrashedGroupNotes(groupId), null, "마지막 노트를 영구 삭제하면 해제한 그룹도 지운다");
  assert.deepEqual(await notes.getTrashGroupChoices(), []);
});
