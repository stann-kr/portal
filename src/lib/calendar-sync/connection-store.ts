/**
 * 연결 자격 증명 저장(관리자·provider당 연결 하나). server action이 아닌 일반 module이라 권한을 검사하지 않는다
 * (호출하는 action·route가 먼저 관리자를 검증한다). 자격 증명 원문은 돌려주지 않는다.
 */
import { and, eq } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import { calendarConnections, calendarMappings, type ExternalCalendarProvider } from "@/db/schema";
import { executeDocumentStatementsAtomically, type DocumentAtomicStatement } from "@/lib/document-lifecycle-atomic";
import { decryptConnectionCredentials, encryptConnectionCredentials, type ConnectionCredentials } from "./credentials";
import { revokeGoogleToken } from "./google";
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
 * Google 계정이 바뀌었으면 새 연결을 저장한 뒤 이전 계정의 token을 폐기한다(연결 해제와 같은 revoke, best-effort).
 * 같은 계정·확인하지 못한 계정은 폐기하지 않는다. Google revoke는 그 계정의 grant 전체를 끊으므로 같은 계정의
 * 이전 token을 폐기하면 방금 받은 새 token까지 죽는다. 한계: 직전 연결이 계정을 확인하지 못한 채 저장됐고 그것이
 * 실은 지금 연결하는 계정이었다면(표시 이름은 그 전 계정으로 남아 있다) 새 token도 함께 끊겨 한 번 더 연결해야 한다.
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
  deps: { revokeGoogleToken?: (token: string) => Promise<void> } = {},
): Promise<void> {
  const db = ctx.db as unknown as DrizzleDb;
  const [existing] = await db
    .select({
      id: calendarConnections.id,
      accountLabel: calendarConnections.accountLabel,
      encryptedCredentials: calendarConnections.encryptedCredentials,
      credentialsIv: calendarConnections.credentialsIv,
    })
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
    // 이전 Google token은 자격 증명을 바꾸기 전에 읽어 둔다(바꾼 뒤에는 읽을 수 없다). 못 읽으면 폐기를 건너뛴다.
    const previousGoogleToken = accountChanged && input.provider === "GOOGLE"
      ? await decryptConnectionCredentials({
        connectionId: id,
        provider: "GOOGLE",
        encryptedCredentials: existing.encryptedCredentials,
        credentialsIv: existing.credentialsIv,
        key: input.key,
      }).then((credentials) => credentials.refreshToken, () => null)
      : null;
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
    if (previousGoogleToken) {
      // 새 연결을 저장한 뒤에 폐기한다. 실패(이미 무효·네트워크)는 새 연결을 막지 않는다.
      const revoke = deps.revokeGoogleToken ?? ((token: string) => revokeGoogleToken({ token }));
      await revoke(previousGoogleToken).catch(() => undefined);
    }
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
