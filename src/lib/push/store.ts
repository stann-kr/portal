import { and, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { profiles, pushMutedCategories, pushSubscriptions } from "@/db/schema";
import type { PushCategory } from "./messages";
import type { PushSendOutcome, PushTarget } from "./send";

export type StoredPushTarget = PushTarget & { id: string; profileId: string };

/** 연속 실패가 이만큼 쌓이면 끊긴 구독으로 보고 지운다(기기는 다음에 화면을 열 때 다시 등록한다). */
export const PUSH_MAX_CONSECUTIVE_FAILURES = 10;

/**
 * 이 기기(endpoint)의 구독을 지금 계정에 저장한다. 같은 기기에서 다른 계정이 켜면 그 계정으로 옮긴다.
 */
export async function upsertPushSubscription(
  db: DrizzleDb,
  profileId: string,
  target: PushTarget,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      id: crypto.randomUUID(),
      profileId,
      endpoint: target.endpoint,
      p256dh: target.p256dh,
      auth: target.auth,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        profileId,
        p256dh: target.p256dh,
        auth: target.auth,
        updatedAt: now,
        failureCount: 0,
        // 다른 계정에서 옮겨 오면 처음 만든 시각을 새로 둔다(created_at <= updated_at 유지).
        createdAt: sql`CASE WHEN ${pushSubscriptions.profileId} = ${profileId} THEN ${pushSubscriptions.createdAt} ELSE ${Math.floor(now.getTime() / 1000)} END`,
      },
    });
}

/** 본인 계정의 이 기기 구독만 지운다. */
export async function deletePushSubscription(db: DrizzleDb, profileId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.profileId, profileId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function readPushSubscriptionState(
  db: DrizzleDb,
  profileId: string,
  endpoint: string | null,
): Promise<{ registered: boolean; deviceCount: number }> {
  const rows = await db
    .select({ endpoint: pushSubscriptions.endpoint })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.profileId, profileId));
  return {
    registered: endpoint !== null && rows.some((row) => row.endpoint === endpoint),
    deviceCount: rows.length,
  };
}

export async function findOwnPushTarget(db: DrizzleDb, profileId: string, endpoint: string): Promise<StoredPushTarget | null> {
  const [row] = await db
    .select({
      id: pushSubscriptions.id,
      profileId: pushSubscriptions.profileId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.profileId, profileId), eq(pushSubscriptions.endpoint, endpoint)))
    .limit(1);
  return row ?? null;
}

export type PushAudience =
  | { kind: "profiles"; profileIds: readonly string[] }
  | { kind: "role"; role: "admin" | "student" }
  | { kind: "everyone" };

/**
 * 받는 사람의 구독. 보낸 사람 본인(excludeProfileId)과 이 종류(category)를 끈 계정은 빼고, 지금 있는 계정만 고른다.
 * category가 없으면(테스트 알림) 끈 종류를 보지 않는다.
 */
export async function listPushTargets(
  db: DrizzleDb,
  audience: PushAudience,
  excludeProfileId?: string,
  category?: PushCategory,
): Promise<StoredPushTarget[]> {
  const columns = {
    id: pushSubscriptions.id,
    profileId: pushSubscriptions.profileId,
    endpoint: pushSubscriptions.endpoint,
    p256dh: pushSubscriptions.p256dh,
    auth: pushSubscriptions.auth,
  };
  let rows: StoredPushTarget[];
  if (audience.kind === "profiles") {
    const ids = [...new Set(audience.profileIds)].filter((id) => id && id !== excludeProfileId);
    if (ids.length === 0) return [];
    rows = await db
      .select(columns)
      .from(pushSubscriptions)
      .innerJoin(profiles, eq(profiles.id, pushSubscriptions.profileId))
      .where(inArray(pushSubscriptions.profileId, ids));
  } else if (audience.kind === "role") {
    rows = await db
      .select(columns)
      .from(pushSubscriptions)
      .innerJoin(profiles, eq(profiles.id, pushSubscriptions.profileId))
      .where(eq(profiles.role, audience.role));
  } else {
    rows = await db
      .select(columns)
      .from(pushSubscriptions)
      .innerJoin(profiles, eq(profiles.id, pushSubscriptions.profileId));
  }
  const candidates = excludeProfileId ? rows.filter((row) => row.profileId !== excludeProfileId) : rows;
  if (!category || candidates.length === 0) return candidates;
  const muted = await db
    .select({ profileId: pushMutedCategories.profileId })
    .from(pushMutedCategories)
    .where(and(
      eq(pushMutedCategories.category, category),
      inArray(pushMutedCategories.profileId, [...new Set(candidates.map((row) => row.profileId))]),
    ));
  if (muted.length === 0) return candidates;
  const mutedIds = new Set(muted.map((row) => row.profileId));
  return candidates.filter((row) => !mutedIds.has(row.profileId));
}

/** 이 계정이 끈 알림 종류. */
export async function readMutedPushCategories(db: DrizzleDb, profileId: string): Promise<PushCategory[]> {
  const rows = await db
    .select({ category: pushMutedCategories.category })
    .from(pushMutedCategories)
    .where(eq(pushMutedCategories.profileId, profileId));
  return rows.map((row) => row.category as PushCategory);
}

/** 이 계정의 알림 종류 하나를 켜거나 끈다(여러 번 불러도 같은 결과). */
export async function setPushCategoryEnabled(
  db: DrizzleDb,
  profileId: string,
  category: PushCategory,
  enabled: boolean,
): Promise<void> {
  if (enabled) {
    await db
      .delete(pushMutedCategories)
      .where(and(eq(pushMutedCategories.profileId, profileId), eq(pushMutedCategories.category, category)));
    return;
  }
  await db.insert(pushMutedCategories).values({ profileId, category }).onConflictDoNothing();
}

/** 보낸 결과를 남긴다. 사라진 구독과 실패가 계속 쌓인 구독은 지운다. */
export async function recordPushOutcome(db: DrizzleDb, id: string, outcome: PushSendOutcome, now: Date = new Date()): Promise<void> {
  if (outcome === "gone") {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
    return;
  }
  if (outcome === "sent") {
    await db
      .update(pushSubscriptions)
      .set({ lastSuccessAt: now, failureCount: 0 })
      .where(eq(pushSubscriptions.id, id));
    return;
  }
  await db
    .update(pushSubscriptions)
    .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
    .where(eq(pushSubscriptions.id, id));
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, id), sql`${pushSubscriptions.failureCount} >= ${PUSH_MAX_CONSECUTIVE_FAILURES}`));
}
