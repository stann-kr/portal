import assert from "node:assert/strict";
import { before, mock, test, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import { postReminders, posts, profiles, pushMutedCategories, pushNoticeRecipients, pushNotices, pushSubscriptions } from "@/db/schema";
import type { PushMessage } from "@/lib/push/messages";
import type { PushAudience } from "@/lib/push/notify";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

/**
 * 글 없이 보내는 알림(0037)과 공지 다시 알리기의 권한·받는 사람·읽음·10분 간격을 실제 D1 schema로 확인한다.
 * 실제 발송은 src/lib/push 단위 테스트가 맡고, 여기서는 누구에게 무엇을 보내는지만 본다.
 */
type PortalTestDb = IsolatedPortalD1["db"];
type SentPush = { audience: PushAudience; message: PushMessage; exclude?: string };

let activeDb: PortalTestDb | null = null;
let activeSession: AuthSession = createSession("admin-1", "admin");
let sent: SentPush[] = [];
let noticeActions: typeof import("@/lib/actions/pushNotices");
let postReadActions: typeof import("@/lib/actions/postReads");

function createSession(id: string, role: "admin" | "student"): AuthSession {
  return { expires: "2099-01-01T00:00:00.000Z", user: { id, role, name: id, email: `${id}@example.com`, image: null } };
}

function requireActiveDb(): PortalTestDb {
  if (!activeDb) throw new Error("격리 D1 테스트 DB가 준비되지 않았습니다.");
  return activeDb;
}

mock.module("@/auth", { namedExports: { auth: async () => activeSession } });
mock.module("@/db/client", {
  namedExports: {
    createDb: () => requireActiveDb(),
    createDbContext: () => ({ kind: "d1", db: requireActiveDb() }),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
mock.module("next/navigation", { namedExports: { redirect: (path: string) => { throw new Error(`예상하지 않은 redirect: ${path}`); } } });
mock.module("@/lib/push/notify", {
  namedExports: {
    notifyPush: async (audience: PushAudience, message: PushMessage, options: { excludeProfileId?: string } = {}) => {
      sent.push({ audience, message, exclude: options.excludeProfileId });
    },
  },
});

before(async () => {
  [noticeActions, postReadActions] = await Promise.all([
    import("@/lib/actions/pushNotices"),
    import("@/lib/actions/postReads"),
  ]);
});

async function setup(context: TestContext): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  sent = [];
  activeSession = createSession("admin-1", "admin");
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  const db = isolated.db;
  await db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "Stann", role: "admin" },
    { id: "student-1", email: "student-1@example.com", displayName: "김학생", role: "student" },
    { id: "student-2", email: "student-2@example.com", displayName: "박학생", role: "student" },
    { id: "student-3", email: "student-3@example.com", displayName: "이학생", role: "student" },
    // 수강 종료·가입 전 학생은 받는 사람이 아니다.
    { id: "student-archived", email: "archived@example.com", displayName: "종료학생", role: "student", accountStatus: "ARCHIVED", archivedAt: new Date() },
    { id: "student-invited", email: "invited@example.com", displayName: "가입전", role: "student", passwordHash: "invite:9999999999:$2a$10$abcdefghijklmnopqrstuv" },
  ]);
  // 학생 1만 알림 받을 기기가 있고, 학생 2는 기기가 있지만 공지 알림을 껐다. 학생 3은 기기가 없다.
  const now = new Date();
  await db.insert(pushSubscriptions).values([
    { id: "sub-1", profileId: "student-1", endpoint: "https://push.example/1", p256dh: "B".repeat(87), auth: "A".repeat(22), createdAt: now, updatedAt: now },
    { id: "sub-2", profileId: "student-2", endpoint: "https://push.example/2", p256dh: "B".repeat(87), auth: "A".repeat(22), createdAt: now, updatedAt: now },
  ]);
  await db.insert(pushMutedCategories).values({ profileId: "student-2", category: "announcement" });
  return db;
}

test("알림 보내기: 관리자만, 수강 중이고 가입한 학생에게, 같은 요청은 한 번만 보낸다", { concurrency: false }, async (context) => {
  const db = await setup(context);
  const operationId = crypto.randomUUID();

  activeSession = createSession("student-1", "student");
  await assert.rejects(noticeActions.sendPushNotice({ body: "안녕", studentIds: null, operationId }), /Unauthorized|Forbidden|admin/iu);
  await assert.rejects(noticeActions.listPushNotices(), /Unauthorized|Forbidden|admin/iu);
  await assert.rejects(noticeActions.listPushNoticeStudents(), /Unauthorized|Forbidden|admin/iu);
  activeSession = createSession("admin-1", "admin");

  assert.equal((await noticeActions.sendPushNotice({ body: "   ", studentIds: null, operationId })).success, false);
  assert.equal((await noticeActions.sendPushNotice({ body: "가".repeat(121), studentIds: null, operationId })).success, false);
  assert.equal((await noticeActions.sendPushNotice({ body: "안녕", studentIds: [], operationId })).success, false);
  assert.equal((await noticeActions.sendPushNotice({ body: "안녕", studentIds: null, operationId: "not-uuid" })).success, false);
  assert.equal(sent.length, 0);
  assert.equal((await db.select().from(pushNotices)).length, 0);

  assert.deepEqual(
    (await noticeActions.listPushNoticeStudents()).map((student) => student.id),
    ["student-1", "student-2", "student-3"],
    "고르기 목록은 수강 중이고 가입한 학생(이름순)",
  );

  const body = "  내일 레슨은 30분 늦게\n7시 30분에 시작해요.  ";
  const result = await noticeActions.sendPushNotice({ body, studentIds: null, operationId });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.recipientCount, 3);
  assert.deepEqual(sent, [{
    audience: { kind: "profiles", profileIds: ["student-1", "student-2", "student-3"] },
    message: {
      category: "announcement",
      title: "Stann의 알림",
      body: "내일 레슨은 30분 늦게\n7시 30분에 시작해요.",
      url: `/dashboard/student?notice=${result.noticeId}`,
      tag: `notice:${result.noticeId}`,
    },
    exclude: "admin-1",
  }]);

  // 두 번 눌러도(같은 operationId) 알림은 하나, 발송도 한 번.
  const replay = await noticeActions.sendPushNotice({ body, studentIds: null, operationId });
  assert.deepEqual(replay, { success: true, noticeId: result.noticeId, recipientCount: 3 });
  assert.equal(sent.length, 1);
  assert.equal((await db.select().from(pushNotices)).length, 1);

  // 고르기: 받을 수 없는 학생·없는 id는 빠진다.
  const picked = await noticeActions.sendPushNotice({
    body: "B룸 공사",
    studentIds: ["student-2", "student-archived", "student-invited", "admin-1", "missing"],
    operationId: crypto.randomUUID(),
  });
  assert.equal(picked.success && picked.recipientCount, 1);
  assert.deepEqual(sent[1]?.audience, { kind: "profiles", profileIds: ["student-2"] });
  const none = await noticeActions.sendPushNotice({ body: "아무도", studentIds: ["student-archived"], operationId: crypto.randomUUID() });
  assert.equal(none.success, false, "받을 학생이 없으면 저장하지 않는다");
  assert.equal((await db.select().from(pushNotices)).length, 2);

  // 받는 사람은 보낸 순간으로 고정한다: 나중에 가입한 학생은 세지 않는다.
  await db.update(profiles).set({ passwordHash: null }).where(eq(profiles.id, "student-invited"));
  const [row] = (await noticeActions.listPushNotices()).filter((notice) => notice.id === result.noticeId);
  assert.equal(row?.recipientCount, 3);
  assert.equal(row?.readCount, 0);
});

test("학생: 자기에게 온 알림만 보고 읽음으로 바꾸며, 관리자는 읽은 학생과 알림 꺼짐을 본다", { concurrency: false }, async (context) => {
  const db = await setup(context);
  const all = await noticeActions.sendPushNotice({ body: "전체 알림", studentIds: null, operationId: crypto.randomUUID() });
  const onlyTwo = await noticeActions.sendPushNotice({ body: "2만", studentIds: ["student-2"], operationId: crypto.randomUUID() });
  assert.ok(all.success && onlyTwo.success);

  activeSession = createSession("student-1", "student");
  assert.deepEqual((await noticeActions.getMyUnreadPushNotices()).map((notice) => notice.body), ["전체 알림"]);
  await assert.rejects(noticeActions.getPushNoticeSummary(all.noticeId), /Unauthorized|Forbidden|admin/iu);
  await assert.rejects(noticeActions.remindPushNotice(all.noticeId), /Unauthorized|Forbidden|admin/iu);
  await assert.rejects(noticeActions.deletePushNotice(all.noticeId), /Unauthorized|Forbidden|admin/iu);
  // 받지 않은 알림을 읽음으로 바꿔도 아무 기록이 생기지 않는다.
  await noticeActions.markPushNoticeRead(onlyTwo.noticeId);
  assert.equal((await db.select().from(pushNoticeRecipients).where(eq(pushNoticeRecipients.noticeId, onlyTwo.noticeId))).length, 1);
  await noticeActions.markPushNoticeRead(all.noticeId);
  const [firstRead] = await db.select().from(pushNoticeRecipients).where(eq(pushNoticeRecipients.studentId, "student-1"));
  assert.ok(firstRead?.readAt instanceof Date);
  await noticeActions.markPushNoticeRead(all.noticeId);
  const [again] = await db.select().from(pushNoticeRecipients).where(eq(pushNoticeRecipients.studentId, "student-1"));
  assert.equal(again?.readAt?.getTime(), firstRead.readAt.getTime(), "처음 읽은 시각을 유지한다");
  assert.deepEqual(await noticeActions.getMyUnreadPushNotices(), []);

  // 관리자가 읽음으로 바꿔도 아무것도 바뀌지 않고, 관리자의 학생 홈 알림은 빈 목록이다.
  activeSession = createSession("admin-1", "admin");
  await noticeActions.markPushNoticeRead(onlyTwo.noticeId);
  assert.deepEqual(await noticeActions.getMyUnreadPushNotices(), []);

  const summary = await noticeActions.getPushNoticeSummary(all.noticeId);
  assert.deepEqual(summary?.readers.map((reader) => reader.id), ["student-1"]);
  assert.deepEqual(summary?.unread, [
    { id: "student-2", name: "박학생", pushOff: true },
    { id: "student-3", name: "이학생", pushOff: true },
  ], "공지 알림을 껐거나 기기가 없는 학생은 알림 꺼짐");
  const [listed] = (await noticeActions.listPushNotices()).filter((notice) => notice.id === all.noticeId);
  assert.equal(listed?.readCount, 1);
  assert.equal(listed?.recipientCount, 3);

  // 지우면 받은 기록도 사라지고 학생 홈에서도 사라진다.
  assert.equal((await noticeActions.deletePushNotice(onlyTwo.noticeId)).success, true);
  assert.equal((await db.select().from(pushNoticeRecipients).where(eq(pushNoticeRecipients.noticeId, onlyTwo.noticeId))).length, 0);
  activeSession = createSession("student-2", "student");
  assert.deepEqual((await noticeActions.getMyUnreadPushNotices()).map((notice) => notice.body), ["전체 알림"]);
});

test("다시 알리기: 안 읽은 수강 중 학생에게만, 10분에 한 번, 모두 읽으면 보내지 않는다", { concurrency: false }, async (context) => {
  const db = await setup(context);
  const notice = await noticeActions.sendPushNotice({ body: "다시 알릴 알림", studentIds: null, operationId: crypto.randomUUID() });
  assert.ok(notice.success);
  activeSession = createSession("student-1", "student");
  await noticeActions.markPushNoticeRead(notice.noticeId);
  // 보낸 뒤 수강 종료한 학생은 다시 알리지 않는다.
  await db.update(profiles).set({ accountStatus: "ARCHIVED", archivedAt: new Date() }).where(eq(profiles.id, "student-3"));
  activeSession = createSession("admin-1", "admin");
  sent = [];

  const reminded = await noticeActions.remindPushNotice(notice.noticeId);
  assert.ok(reminded.success);
  assert.equal(reminded.sentTo, 1);
  assert.deepEqual(sent.map((push) => [push.audience, push.message.tag, push.exclude]), [
    [{ kind: "profiles", profileIds: ["student-2"] }, `notice:${notice.noticeId}`, "admin-1"],
  ]);
  const blocked = await noticeActions.remindPushNotice(notice.noticeId);
  assert.equal(blocked.success, false, "10분 안에 다시 누르면 보내지 않는다");
  assert.equal(sent.length, 1);
  assert.equal((await noticeActions.getPushNoticeSummary(notice.noticeId))?.lastRemindedAt?.getTime(), reminded.remindedAt.getTime());

  await db.update(pushNotices).set({ lastRemindedAt: new Date(Date.now() - 11 * 60 * 1000) }).where(eq(pushNotices.id, notice.noticeId));
  assert.equal((await noticeActions.remindPushNotice(notice.noticeId)).success, true, "10분이 지나면 다시 보낼 수 있다");
  assert.equal(sent.length, 2);

  activeSession = createSession("student-2", "student");
  await noticeActions.markPushNoticeRead(notice.noticeId);
  activeSession = createSession("admin-1", "admin");
  await db.update(pushNotices).set({ lastRemindedAt: null }).where(eq(pushNotices.id, notice.noticeId));
  assert.equal((await noticeActions.remindPushNotice(notice.noticeId)).success, false, "모두 읽었으면 보내지 않는다");
  assert.equal(sent.length, 2);
});

test("공지 게시물 다시 알리기: 공지만, 안 읽은 학생에게, 10분에 한 번", { concurrency: false }, async (context) => {
  const db = await setup(context);
  const createdAt = new Date();
  await db.insert(posts).values([
    { id: "notice-post", authorId: "admin-1", category: "", boardType: "ANNOUNCEMENT" as const, title: "11월 레슨 일정", contentHtml: "<p>x</p>", createdAt },
    { id: "general-post", authorId: "student-1", category: "general", boardType: "GENERAL" as const, title: "자유 글", contentHtml: "<p>x</p>", createdAt },
  ]);
  activeSession = createSession("student-1", "student");
  await postReadActions.recordPostRead("notice-post");
  await assert.rejects(postReadActions.remindPostUnread("notice-post"), /Unauthorized|Forbidden|admin/iu);

  activeSession = createSession("admin-1", "admin");
  const summary = await postReadActions.getPostReadSummary("notice-post");
  assert.equal(summary?.canRemind, true);
  assert.equal(summary?.lastRemindedAt, null);
  assert.deepEqual(summary?.unread.map((student) => [student.id, student.pushOff]), [["student-2", true], ["student-3", true]]);
  assert.equal((await postReadActions.getPostReadSummary("general-post"))?.canRemind, false);
  assert.equal((await postReadActions.remindPostUnread("general-post")).success, false, "자유 게시판 글은 다시 알리지 않는다");

  const reminded = await postReadActions.remindPostUnread("notice-post");
  assert.ok(reminded.success);
  assert.equal(reminded.sentTo, 2);
  assert.deepEqual(sent, [{
    audience: { kind: "profiles", profileIds: ["student-2", "student-3"] },
    message: { category: "announcement", title: "아직 확인하지 않은 공지", body: "‘11월 레슨 일정’", url: "/community/notice-post", tag: "announcement:notice-post" },
    exclude: "admin-1",
  }]);
  assert.equal((await postReadActions.remindPostUnread("notice-post")).success, false, "10분 안에 다시 누르면 보내지 않는다");
  assert.equal(sent.length, 1);
  assert.equal((await postReadActions.getPostReadSummary("notice-post"))?.lastRemindedAt?.getTime(), reminded.remindedAt.getTime());

  await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, "notice-post"));
  await db.update(postReminders).set({ lastRemindedAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(postReminders.postId, "notice-post"));
  assert.equal((await postReadActions.remindPostUnread("notice-post")).success, false, "휴지통에 있는 공지는 다시 알리지 않는다");
});
