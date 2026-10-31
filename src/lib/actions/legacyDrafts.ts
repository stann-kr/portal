"use server";

import { and, desc, eq, gt } from "drizzle-orm";
import { createDbContext, type DrizzleDb } from "@/db/client";
import { documentServerDrafts, type DocumentServerDraftKind } from "@/db/schema";
import { requireAuth } from "@/lib/auth-guard";
import { parseLegacyServerDraftPayload } from "@/lib/legacy-draft-content";
import { sanitizeHtml } from "@/lib/sanitize-html";

/** 보관함이 보이는 계정 서버 초안 한 건. 삭제에는 `draftVersion`을 그대로 `discardDocumentServerDraft`에 넘긴다. */
export type LegacyServerDraft = {
  sourceKey: string;
  kind: DocumentServerDraftKind;
  updatedAt: string;
  draftVersion: number;
  title: string;
  /** sanitizeHtml을 통과한 본문 HTML. */
  contentHtml: string;
};

/**
 * 현재 로그인 사용자의 만료되지 않은 계정 서버 초안을 읽기 전용으로 돌려준다.
 * 소유자는 세션 id로만 정해 질의에서 강제하고, 이 함수는 어떤 저장소에도 쓰지 않는다(만료 정리도 하지 않는다).
 */
export async function listLegacyServerDrafts(): Promise<LegacyServerDraft[]> {
  const session = await requireAuth();
  const db = createDbContext().db as unknown as DrizzleDb;
  const rows = await db
    .select({
      sourceKey: documentServerDrafts.sourceKey,
      kind: documentServerDrafts.documentKind,
      payloadJson: documentServerDrafts.payloadJson,
      draftVersion: documentServerDrafts.draftVersion,
      updatedAt: documentServerDrafts.updatedAt,
    })
    .from(documentServerDrafts)
    .where(and(
      eq(documentServerDrafts.ownerId, session.user.id),
      gt(documentServerDrafts.expiresAt, new Date()),
    ))
    .orderBy(desc(documentServerDrafts.updatedAt));

  return rows.map((row) => {
    const content = parseLegacyServerDraftPayload(row.payloadJson);
    return {
      sourceKey: row.sourceKey,
      kind: row.kind,
      updatedAt: row.updatedAt.toISOString(),
      draftVersion: row.draftVersion,
      title: content.title,
      contentHtml: sanitizeHtml(content.contentHtml),
    };
  });
}
