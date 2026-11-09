import assert from "node:assert/strict";
import { test } from "node:test";
import { profiles } from "@/db/schema";
import type { DrizzleDb } from "@/db/client";
import { listPushTargets, readMutedPushCategories, setPushCategoryEnabled, upsertPushSubscription } from "@/lib/push/store";
import { createIsolatedPortalD1 } from "@/test/isolated-d1";

const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };

test("구독 저장소: 끈 종류와 보낸 사람을 빼고, 테스트 알림(종류 없음)은 끈 종류를 보지 않는다", async (context) => {
  const isolated = await createIsolatedPortalD1();
  context.after(() => isolated.dispose());
  const db = isolated.db as unknown as DrizzleDb;
  await isolated.db.insert(profiles).values([
    { id: "admin-1", email: "a@example.com", displayName: "Stann", role: "admin" },
    { id: "student-1", email: "s1@example.com", displayName: "김학생", role: "student" },
    { id: "student-2", email: "s2@example.com", displayName: "이학생", role: "student" },
  ]);
  await upsertPushSubscription(db, "admin-1", { endpoint: "https://push.example.com/a", ...keys });
  await upsertPushSubscription(db, "student-1", { endpoint: "https://push.example.com/s1", ...keys });
  await upsertPushSubscription(db, "student-2", { endpoint: "https://push.example.com/s2", ...keys });

  await setPushCategoryEnabled(db, "student-2", "community_post", false);
  await setPushCategoryEnabled(db, "student-2", "community_post", false);
  assert.deepEqual(await readMutedPushCategories(db, "student-2"), ["community_post"]);

  const ids = async (...args: Parameters<typeof listPushTargets> extends [unknown, ...infer Rest] ? Rest : never) =>
    (await listPushTargets(db, ...args)).map((row) => row.profileId).sort();
  assert.deepEqual(await ids({ kind: "everyone" }, "student-1", "community_post"), ["admin-1"]);
  assert.deepEqual(await ids({ kind: "everyone" }, "student-1", "community_comment"), ["admin-1", "student-2"]);
  assert.deepEqual(await ids({ kind: "role", role: "student" }, undefined, "community_post"), ["student-1"]);
  assert.deepEqual(await ids({ kind: "profiles", profileIds: ["student-2"] }), ["student-2"], "종류 없는 테스트 알림");

  await setPushCategoryEnabled(db, "student-2", "community_post", true);
  assert.deepEqual(await readMutedPushCategories(db, "student-2"), []);
  assert.deepEqual(await ids({ kind: "everyone" }, "student-1", "community_post"), ["admin-1", "student-2"]);

  // 같은 기기에서 다른 계정이 켜면 그 계정으로 옮겨진다.
  await upsertPushSubscription(db, "student-1", { endpoint: "https://push.example.com/s2", ...keys });
  assert.deepEqual(await ids({ kind: "role", role: "student" }), ["student-1", "student-1"]);
});
