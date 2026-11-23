/**
 * 알림·읽음에서 세는 학생과 "알림 꺼짐" 판단. 서버 action에서만 부른다.
 * - 세는 학생: 수강 중(ACTIVE)이고 로그인할 수 있는 학생. 가입 링크 hash만 가입 전으로 본다
 *   (storedCredentialState·학생 삭제 조건과 같은 기준).
 * - 알림 꺼짐: 알림 받을 기기(구독)가 없거나 공지 알림을 끈 학생. 공지·글 없는 알림 모두 announcement 종류로 보낸다.
 */
import { and, eq, inArray, isNull, notLike, or } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { profiles, pushMutedCategories, pushSubscriptions } from "@/db/schema";
import { INVITE_HASH_PREFIX } from "@/lib/password-storage";

/** D1 bind 상한(100)보다 작게 나눠 읽는다. */
const ID_CHUNK = 90;

export const activeSignedUpStudent = and(
  eq(profiles.role, "student"),
  eq(profiles.accountStatus, "ACTIVE"),
  or(isNull(profiles.passwordHash), notLike(profiles.passwordHash, `${INVITE_HASH_PREFIX}%`)),
);

/** 주어진 학생 중 알림을 받을 수 없는(기기 없음·공지 알림 끔) 학생 id. */
export async function findPushOffStudentIds(db: DrizzleDb, studentIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(studentIds)].filter(Boolean);
  const subscribed = new Set<string>();
  const muted = new Set<string>();
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const chunk = ids.slice(start, start + ID_CHUNK);
    const [subscriptionRows, mutedRows] = await Promise.all([
      db.selectDistinct({ id: pushSubscriptions.profileId }).from(pushSubscriptions).where(inArray(pushSubscriptions.profileId, chunk)),
      db
        .select({ id: pushMutedCategories.profileId })
        .from(pushMutedCategories)
        .where(and(inArray(pushMutedCategories.profileId, chunk), eq(pushMutedCategories.category, "announcement"))),
    ]);
    for (const row of subscriptionRows) subscribed.add(row.id);
    for (const row of mutedRows) muted.add(row.id);
  }
  return new Set(ids.filter((id) => !subscribed.has(id) || muted.has(id)));
}

/** 다시 알리기 사이 최소 간격(초). */
export const PUSH_REMINDER_COOLDOWN_SECONDS = 10 * 60;
