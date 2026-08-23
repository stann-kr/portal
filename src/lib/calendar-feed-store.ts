import { eq } from "drizzle-orm";
import {
  createDb,
  createDbContext,
  type DbContext,
  type DrizzleDb,
} from "@/db/client";
import { calendarFeedTokens } from "@/db/schema";
import {
  documentEpochSeconds,
  executeDocumentStatementsAtomically,
} from "@/lib/document-lifecycle-atomic";

/** calendar_feed_tokens schema 의존성을 이 adapter 한 곳에 격리한다. */
export async function findCalendarFeedTokenDigest(
  ownerId: string,
  db: DrizzleDb = createDb(),
): Promise<string | null> {
  const [row] = await db
    .select({ tokenDigest: calendarFeedTokens.tokenDigest })
    .from(calendarFeedTokens)
    .where(eq(calendarFeedTokens.ownerId, ownerId))
    .limit(1);
  return row?.tokenDigest ?? null;
}

export async function findCalendarFeedOwnerByDigest(
  tokenDigest: string,
  db: DrizzleDb = createDb(),
): Promise<string | null> {
  const [row] = await db
    .select({ ownerId: calendarFeedTokens.ownerId })
    .from(calendarFeedTokens)
    .where(eq(calendarFeedTokens.tokenDigest, tokenDigest))
    .limit(1);
  return row?.ownerId ?? null;
}

export async function replaceCalendarFeedTokenDigest(
  ownerId: string,
  tokenDigest: string,
  now: Date = new Date(),
  context: DbContext = createDbContext(),
): Promise<void> {
  const nowEpoch = documentEpochSeconds(now)!;
  await executeDocumentStatementsAtomically(context, [
    {
      query: `
        UPDATE calendar_feed_tokens
        SET token_digest = ?, updated_at = max(?, updated_at + 1)
        WHERE owner_id = ?
          AND EXISTS (
            SELECT 1 FROM profiles
            WHERE id = ? AND role = 'student'
          )
      `,
      params: [tokenDigest, nowEpoch, ownerId, ownerId],
    },
    {
      query: `
        INSERT INTO calendar_feed_tokens (
          owner_id, token_digest, created_at, updated_at
        )
        SELECT id, ?, ?, ?
        FROM profiles
        WHERE id = ? AND role = 'student'
          AND NOT EXISTS (
            SELECT 1 FROM calendar_feed_tokens WHERE owner_id = ?
          )
      `,
      params: [tokenDigest, nowEpoch, nowEpoch, ownerId, ownerId],
    },
    {
      query: `
        INSERT INTO document_batch_abort_guard (reason)
        SELECT 'CALENDAR_FEED_TOKEN_WRITE'
        WHERE NOT EXISTS (
          SELECT 1 FROM calendar_feed_tokens
          WHERE owner_id = ? AND token_digest = ?
        )
      `,
      params: [ownerId, tokenDigest],
    },
  ]);
}
