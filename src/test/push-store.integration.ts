import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle, type AnyD1Database } from "drizzle-orm/d1";
import * as portalSchema from "@/db/schema";
import { profiles, pushSubscriptions } from "@/db/schema";
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

test("구독 저장소: 알림을 켠 계정이 100개를 넘어도 statement 하나에 bind를 100개 넘게 싣지 않는다", async (context) => {
  const isolated = await createIsolatedPortalD1();
  context.after(() => isolated.dispose());
  // 격리 D1(miniflare)은 bind 100개 제한을 재현하지 않으므로, 보낸 statement의 bind 수를 직접 잰다.
  let maxBind = { count: 0, query: "" };
  const binding = isolated.binding;
  type Prepared = ReturnType<typeof binding.prepare>;
  const wrap = (prepared: Prepared, query: string): Prepared =>
    new Proxy(prepared, {
      get(inner, key) {
        const value = Reflect.get(inner, key);
        if (key === "bind") {
          return (...args: unknown[]) => {
            if (args.length > maxBind.count) maxBind = { count: args.length, query };
            return wrap(value.apply(inner, args), query);
          };
        }
        return typeof value === "function" ? value.bind(inner) : value;
      },
    });
  const counting = new Proxy(binding, {
    get(target, prop) {
      if (prop === "prepare") return (query: string) => wrap(target.prepare(query), query);
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as AnyD1Database;
  const db = drizzle(counting, { schema: portalSchema }) as unknown as DrizzleDb;

  const studentIds = Array.from({ length: 130 }, (_, index) => `student-${String(index).padStart(3, "0")}`);
  for (let start = 0; start < studentIds.length; start += 10) {
    const chunk = studentIds.slice(start, start + 10);
    await isolated.db.insert(profiles).values(chunk.map((id) => ({ id, email: `${id}@example.com`, displayName: id, role: "student" as const })));
    await isolated.db.insert(pushSubscriptions).values(chunk.map((id) => ({
      id: `sub-${id}`, profileId: id, endpoint: `https://push.example.com/${id}`, ...keys,
    })));
  }
  await setPushCategoryEnabled(db, "student-005", "community_post", false);
  await setPushCategoryEnabled(db, "student-125", "community_post", false);
  maxBind = { count: 0, query: "" };

  const expected = studentIds.filter((id) => id !== "student-000" && id !== "student-005" && id !== "student-125");
  const everyone = await listPushTargets(db, { kind: "everyone" }, "student-000", "community_post");
  assert.deepEqual(everyone.map((row) => row.profileId).sort(), expected);
  const byRole = await listPushTargets(db, { kind: "role", role: "student" }, "student-000", "community_post");
  assert.deepEqual(byRole.map((row) => row.profileId).sort(), expected);
  // 댓글 참여자처럼 받는 사람 id를 직접 넘기는 경우도 100개를 넘을 수 있다.
  const byIds = await listPushTargets(db, { kind: "profiles", profileIds: studentIds }, "student-000", "community_post");
  assert.deepEqual(byIds.map((row) => row.profileId).sort(), expected);
  assert.ok(maxBind.count <= 100, `bind ${maxBind.count}개: ${maxBind.query.slice(0, 120)}`);
});
