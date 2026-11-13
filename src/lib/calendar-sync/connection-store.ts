/**
 * 연결 자격 증명 저장(관리자·provider당 연결 하나). server action이 아닌 일반 module이라 권한을 검사하지 않는다
 * (호출하는 action·route가 먼저 관리자를 검증한다). 자격 증명 원문은 돌려주지 않는다.
 */
import { and, eq } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import { calendarConnections, calendarMappings, type ExternalCalendarProvider } from "@/db/schema";
import { executeDocumentStatementsAtomically, type DocumentAtomicStatement } from "@/lib/document-lifecycle-atomic";
import { encryptConnectionCredentials, type ConnectionCredentials } from "./credentials";
import { stopGoogleWatchChannelsFor } from "./push-channels";

const MAX_LABEL_LENGTH = 200;
/** Google 계정 주소를 읽지 못했을 때의 표시 이름. 이 값은 계정을 알 수 없는 것으로 본다. */
export const GOOGLE_ACCOUNT_FALLBACK_LABEL = "Google 계정";

function normalizeAccount(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized && normalized !== GOOGLE_ACCOUNT_FALLBACK_LABEL.toLowerCase() ? normalized : null;
}

function toStatement(query: { toSQL(): { sql: string; params: unknown[] } }): DocumentAtomicStatement {
  const { sql, params } = query.toSQL();
  return { query: sql, params };
}

/**
 * 같은 관리자·provider 연결이 있으면 그 id를 재사용해 자격 증명을 바꾸고 없으면 새로 만든다.
 * 같은 계정이면 매핑을 유지한다. 계정(accountId)이 바뀌었으면 이전 계정의 캘린더 매핑은 새 계정에서 쓸 수 없으므로
 * 이전 자격 증명으로 알림 channel을 먼저 중지하고(best-effort) 매핑을 지운다(cursor·link·series·channel은 cascade).
 * 포탈 레슨·일정은 남는다. accountId가 없으면(계정을 확인하지 못함) 바뀌었는지 알 수 없어 지금처럼 유지한다.
 */
export async function upsertCalendarConnection<P extends ExternalCalendarProvider>(
  ctx: DbContext,
  input: {
    ownerId: string;
    provider: P;
    accountLabel: string;
    /** 계정 식별 값(Google 이메일, Apple ID). 대소문자·앞뒤 공백은 무시한다. null이면 확인하지 못한 계정이다. */
    accountId: string | null;
    credentials: ConnectionCredentials<P>;
    key: Uint8Array;
  },
): Promise<void> {
  const db = ctx.db as unknown as DrizzleDb;
  const [existing] = await db
    .select({ id: calendarConnections.id, accountLabel: calendarConnections.accountLabel })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.ownerId, input.ownerId), eq(calendarConnections.provider, input.provider)))
    .limit(1);
  const id = existing?.id ?? crypto.randomUUID();
  const encrypted = await encryptConnectionCredentials({
    connectionId: id,
    provider: input.provider,
    credentials: input.credentials,
    key: input.key,
  });
  const nextAccount = normalizeAccount(input.accountId);
  if (existing) {
    const previousAccount = normalizeAccount(existing.accountLabel);
    const accountChanged = nextAccount !== null && previousAccount !== null && nextAccount !== previousAccount;
    // 확인하지 못한 계정은 이전 표시 이름(실제 주소)을 덮지 않는다.
    const accountLabel = nextAccount === null ? existing.accountLabel : input.accountLabel.slice(0, MAX_LABEL_LENGTH);
    if (accountChanged) {
      // 자격 증명을 바꾸기 전에 중지한다(이전 계정의 channel은 이전 자격 증명으로만 멈출 수 있다).
      await stopGoogleWatchChannelsFor(ctx, { connectionId: id });
    }
    await executeDocumentStatementsAtomically(ctx, [
      ...(accountChanged ? [toStatement(db.delete(calendarMappings).where(eq(calendarMappings.connectionId, id)))] : []),
      toStatement(db
        .update(calendarConnections)
        .set({ ...encrypted, accountLabel, status: "ACTIVE", lastError: null, updatedAt: new Date() })
        .where(eq(calendarConnections.id, id))),
    ]);
    return;
  }
  await db.insert(calendarConnections).values({
    id,
    ownerId: input.ownerId,
    provider: input.provider,
    accountLabel: input.accountLabel.slice(0, MAX_LABEL_LENGTH),
    ...encrypted,
    status: "ACTIVE",
  });
}
