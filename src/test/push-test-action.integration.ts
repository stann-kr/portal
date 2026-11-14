import assert from "node:assert/strict";
import { before, mock, test, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import { profiles, pushSubscriptions } from "@/db/schema";
import type { AuthSession } from "@/lib/auth-guard";
import { PUSH_MAX_CONSECUTIVE_FAILURES, recordPushOutcomes, upsertPushSubscription } from "@/lib/push/store";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

/** 테스트 알림 action이 계정별 한도를 넘으면 푸시 서비스로 요청하지 않는지 확인한다. */
type PortalTestDb = IsolatedPortalD1["db"];

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1";
const KEYS = {
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};
const LIMITED = "테스트 알림을 너무 자주 보냈습니다. 1분 뒤 다시 시도해 주세요.";

let activeDb: PortalTestDb | null = null;
let allowed = true;
let limitedFor: string[] = [];
let sendCount = 0;
let pushActions: typeof import("@/lib/actions/push");

const session: AuthSession = {
  expires: "2099-01-01T00:00:00.000Z",
  user: { id: "student-1", role: "student", name: "김학생", email: "student-1@example.com", image: null },
};

function requireActiveDb(): PortalTestDb {
  if (!activeDb) throw new Error("격리 D1 테스트 DB가 준비되지 않았습니다.");
  return activeDb;
}

mock.module("@/auth", { namedExports: { auth: async () => session } });
mock.module("@/db/client", {
  namedExports: {
    createDb: () => requireActiveDb(),
    createDbContext: () => ({ kind: "d1", db: requireActiveDb() }),
  },
});
mock.module("@/lib/push/config", {
  namedExports: { readPushConfig: () => ({ publicKey: "public", privateKey: "private", subject: "https://portal.example" }) },
});
mock.module("@/lib/push/send", {
  namedExports: {
    isAllowedPushEndpoint: () => true,
    sendWebPush: async () => {
      sendCount += 1;
      return "sent";
    },
  },
});
mock.module("@/lib/push/test-push-limit", {
  namedExports: {
    TEST_PUSH_LIMITED_MESSAGE: LIMITED,
    isTestPushAllowed: async (profileId: string) => {
      limitedFor.push(profileId);
      return allowed;
    },
  },
});

before(async () => {
  pushActions = await import("@/lib/actions/push");
});

async function setup(context: TestContext): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  allowed = true;
  limitedFor = [];
  sendCount = 0;
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  await isolated.db.insert(profiles).values({ id: "student-1", email: "student-1@example.com", displayName: "김학생", role: "student" });
  await upsertPushSubscription(isolated.db, "student-1", { endpoint: ENDPOINT, ...KEYS });
  return isolated.db;
}

test("테스트 알림: 계정 한도 안에서는 보내고, 한도를 넘으면 보내지 않고 안내한다", { concurrency: false }, async (context) => {
  await setup(context);

  assert.deepEqual(await pushActions.sendTestPush(ENDPOINT), { ok: true });
  assert.equal(sendCount, 1);

  allowed = false;
  assert.deepEqual(await pushActions.sendTestPush(ENDPOINT), { ok: false, error: LIMITED });
  assert.equal(sendCount, 1, "한도를 넘은 요청은 푸시 서비스로 가지 않는다");
  assert.deepEqual(limitedFor, ["student-1", "student-1"]);
});

test("발송 결과 기록: 여러 기기의 결과를 종류별로 묶어 남기고, 사라진 구독과 실패가 쌓인 구독만 지운다", { concurrency: false }, async (context) => {
  const db = await setup(context);
  await db.delete(pushSubscriptions);
  const now = new Date("2026-11-14T12:00:00.000Z");
  const seed = (id: string, failureCount: number) => ({
    id, profileId: "student-1", endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, ...KEYS, failureCount,
  });
  await db.insert(pushSubscriptions).values([
    seed("sent-1", 4), seed("sent-2", 0), seed("gone-1", 0), seed("failed-new", 0),
    seed("failed-last", PUSH_MAX_CONSECUTIVE_FAILURES - 1), seed("untouched", 3),
  ]);

  await recordPushOutcomes(db, [
    { id: "sent-1", outcome: "sent" }, { id: "sent-2", outcome: "sent" }, { id: "gone-1", outcome: "gone" },
    { id: "failed-new", outcome: "failed" }, { id: "failed-last", outcome: "failed" },
    // 그 사이 지워진 구독의 결과가 섞여도 나머지 기록을 막지 않는다.
    { id: "already-deleted", outcome: "failed" },
  ], now);

  const rows = await db
    .select({ id: pushSubscriptions.id, failureCount: pushSubscriptions.failureCount, lastSuccessAt: pushSubscriptions.lastSuccessAt })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.profileId, "student-1"));
  assert.deepEqual(
    rows.map((row) => [row.id, row.failureCount, row.lastSuccessAt?.toISOString() ?? null]).sort(),
    [
      ["failed-new", 1, null],
      ["sent-1", 0, now.toISOString()],
      ["sent-2", 0, now.toISOString()],
      ["untouched", 3, null],
    ],
  );
  // 결과가 없으면 아무 것도 하지 않는다.
  await recordPushOutcomes(db, [], now);
});
