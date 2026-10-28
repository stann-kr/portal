/**
 * 공용 가이드 페이지·질문 위치의 DB 읽기와 원자적 쓰기. 권한 검사는 호출하는 server action이 먼저 하고,
 * 여기서는 버전 조건·순서·연결 정리를 한 batch로 묶는다.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbContext } from "@/db/client";
import {
  guidePages,
  profiles,
  qnaGuideAnchors,
  qnaThreads,
  type QnaStatus,
} from "@/db/schema";
import {
  DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
  asDocumentReadDb,
  documentEpochSeconds,
  executeDocumentStatementsAtomically,
  type DocumentAtomicStatement,
} from "@/lib/document-lifecycle-atomic";
import { stripGuideBlockIds } from "@/lib/guide-content";

export type GuidePageSummary = {
  id: string;
  title: string;
  sortOrder: number;
  updatedAt: Date;
};

export type GuidePageRecord = GuidePageSummary & {
  contentHtml: string;
  version: number;
  createdAt: Date;
  updatedByName: string | null;
};

export type GuideViewer = { id: string; isAdmin: boolean };

export type GuideQuestionAnchor = {
  threadId: string;
  threadTitle: string;
  status: QnaStatus;
  studentId: string;
  studentName: string | null;
  blockId: string | null;
  quote: string;
  pageTitle: string;
  createdAt: Date;
};

export type GuideWriteFailureReason =
  | "VERSION_CONFLICT"
  | "OPERATION_PAYLOAD_CONFLICT"
  | "NOT_FOUND"
  | "STALE_ORDER"
  | "INTERNAL";

/** 재전송 비교: 제목과 블록 식별자를 뺀 본문이 모두 같아야 같은 요청이다. */
function samePayload(page: GuidePageRecord, title: string, contentHtml: string): boolean {
  return page.title === title && stripGuideBlockIds(page.contentHtml) === stripGuideBlockIds(contentHtml);
}

export type GuideWriteResult =
  | { ok: true; page: GuidePageRecord; replayed: boolean }
  | { ok: false; reason: GuideWriteFailureReason; current: GuidePageRecord | null };

export async function listGuidePageSummaries(context: DbContext): Promise<GuidePageSummary[]> {
  return asDocumentReadDb(context)
    .select({
      id: guidePages.id,
      title: guidePages.title,
      sortOrder: guidePages.sortOrder,
      updatedAt: guidePages.updatedAt,
    })
    .from(guidePages)
    .orderBy(asc(guidePages.sortOrder), asc(guidePages.createdAt), asc(guidePages.id));
}

export async function findGuidePage(
  context: DbContext,
  pageId: string,
): Promise<GuidePageRecord | null> {
  const [page] = await asDocumentReadDb(context)
    .select({
      id: guidePages.id,
      title: guidePages.title,
      sortOrder: guidePages.sortOrder,
      contentHtml: guidePages.contentHtml,
      version: guidePages.version,
      createdAt: guidePages.createdAt,
      updatedAt: guidePages.updatedAt,
      updatedByName: profiles.displayName,
    })
    .from(guidePages)
    .leftJoin(profiles, eq(guidePages.updatedById, profiles.id))
    .where(eq(guidePages.id, pageId))
    .limit(1);
  return page ?? null;
}

function claimAssetsStatement(pageId: string, assetIds: readonly string[]): DocumentAtomicStatement | null {
  if (assetIds.length === 0) return null;
  // 아직 어느 페이지에도 연결되지 않은 이미지만 이 페이지로 연결한다(다른 페이지로 복사한 이미지는 그대로 둔다).
  // D1은 statement당 bind 100개 제한이 있으므로 id 목록은 JSON 하나로 넘긴다.
  return {
    query: "UPDATE guide_assets SET guide_page_id = ? WHERE guide_page_id IS NULL AND id IN (SELECT value FROM json_each(?))",
    params: [pageId, JSON.stringify(assetIds)],
  };
}

export async function createGuidePageRecord(
  context: DbContext,
  input: {
    actorId: string;
    pageId: string;
    title: string;
    contentHtml: string;
    assetIds: readonly string[];
    now: Date;
  },
): Promise<GuideWriteResult> {
  const existing = await findGuidePage(context, input.pageId);
  if (existing) {
    // 같은 생성 요청(제목·본문 모두 같음)의 재전송이면 그대로 돌려준다. 내용이 다르면 거부한다.
    return existing.version === 1 && samePayload(existing, input.title, input.contentHtml)
      ? { ok: true, page: existing, replayed: true }
      : { ok: false, reason: "OPERATION_PAYLOAD_CONFLICT", current: existing };
  }
  const epoch = documentEpochSeconds(input.now);
  const claim = claimAssetsStatement(input.pageId, input.assetIds);
  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          INSERT INTO guide_pages (
            id, title, sort_order, content_html, version,
            created_by_id, updated_by_id, created_at, updated_at
          )
          SELECT ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM guide_pages), 0), ?, 1,
                 (SELECT id FROM profiles WHERE id = ?), (SELECT id FROM profiles WHERE id = ?), ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM guide_pages WHERE id = ?)
        `,
        params: [
          input.pageId,
          input.title,
          input.contentHtml,
          input.actorId,
          input.actorId,
          epoch,
          epoch,
          input.pageId,
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ...(claim ? [claim] : []),
    ]);
  } catch {
    const raced = await findGuidePage(context, input.pageId);
    if (raced && raced.version === 1 && samePayload(raced, input.title, input.contentHtml)) {
      return { ok: true, page: raced, replayed: true };
    }
    return { ok: false, reason: raced ? "OPERATION_PAYLOAD_CONFLICT" : "INTERNAL", current: raced };
  }
  const page = await findGuidePage(context, input.pageId);
  return page
    ? { ok: true, page, replayed: false }
    : { ok: false, reason: "INTERNAL", current: null };
}

export async function updateGuidePageRecord(
  context: DbContext,
  input: {
    actorId: string;
    pageId: string;
    baseVersion: number;
    title: string;
    contentHtml: string;
    assetIds: readonly string[];
    now: Date;
  },
): Promise<GuideWriteResult> {
  const before = await findGuidePage(context, input.pageId);
  if (!before) return { ok: false, reason: "NOT_FOUND", current: null };
  if (before.version !== input.baseVersion) {
    // 저장 응답을 잃고 같은 내용을 다시 보낸 경우는 이미 반영된 저장으로 본다.
    if (before.version === input.baseVersion + 1 && samePayload(before, input.title, input.contentHtml)) {
      return { ok: true, page: before, replayed: true };
    }
    return { ok: false, reason: "VERSION_CONFLICT", current: before };
  }

  const claim = claimAssetsStatement(input.pageId, input.assetIds);
  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          UPDATE guide_pages
          SET title = ?, content_html = ?, version = version + 1,
              updated_by_id = (SELECT id FROM profiles WHERE id = ?),
              updated_at = MAX(created_at, ?)
          WHERE id = ? AND version = ?
        `,
        params: [
          input.title,
          input.contentHtml,
          input.actorId,
          documentEpochSeconds(input.now),
          input.pageId,
          input.baseVersion,
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ...(claim ? [claim] : []),
    ]);
  } catch {
    const current = await findGuidePage(context, input.pageId);
    return { ok: false, reason: current ? "VERSION_CONFLICT" : "NOT_FOUND", current };
  }
  const page = await findGuidePage(context, input.pageId);
  return page
    ? { ok: true, page, replayed: false }
    : { ok: false, reason: "NOT_FOUND", current: null };
}

/** 전체 순서를 한 번에 다시 쓴다. 화면이 본 목록과 서버 목록이 다르면 아무것도 바꾸지 않는다. */
export async function reorderGuidePageRecords(
  context: DbContext,
  orderedIds: readonly string[],
): Promise<{ ok: true } | { ok: false; reason: "STALE_ORDER" | "INTERNAL" }> {
  const current = await listGuidePageSummaries(context);
  const currentIds = new Set(current.map((page) => page.id));
  if (
    orderedIds.length !== current.length ||
    new Set(orderedIds).size !== orderedIds.length ||
    orderedIds.some((id) => !currentIds.has(id))
  ) {
    return { ok: false, reason: "STALE_ORDER" };
  }
  if (orderedIds.every((id, index) => current[index]?.id === id)) return { ok: true };
  try {
    await executeDocumentStatementsAtomically(
      context,
      orderedIds.flatMap((id, index) => [
        { query: "UPDATE guide_pages SET sort_order = ? WHERE id = ?", params: [index, id] },
        DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ]),
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: "STALE_ORDER" };
  }
}

/**
 * 페이지를 지운다. 질문 위치·이미지는 FK SET NULL에만 기대지 않고 같은 batch에서 먼저 연결을 끊어
 * 질문은 제목·인용과 함께 남는다.
 */
export async function deleteGuidePageRecord(
  context: DbContext,
  input: { pageId: string; baseVersion: number },
): Promise<{ ok: true } | { ok: false; reason: GuideWriteFailureReason; current: GuidePageRecord | null }> {
  const before = await findGuidePage(context, input.pageId);
  if (!before) return { ok: false, reason: "NOT_FOUND", current: null };
  if (before.version !== input.baseVersion) {
    return { ok: false, reason: "VERSION_CONFLICT", current: before };
  }
  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: "UPDATE qna_guide_anchors SET guide_page_id = NULL WHERE guide_page_id = ?",
        params: [input.pageId],
      },
      {
        query: "UPDATE guide_assets SET guide_page_id = NULL WHERE guide_page_id = ?",
        params: [input.pageId],
      },
      {
        query: "DELETE FROM guide_pages WHERE id = ? AND version = ?",
        params: [input.pageId, input.baseVersion],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
    return { ok: true };
  } catch {
    const current = await findGuidePage(context, input.pageId);
    return { ok: false, reason: current ? "VERSION_CONFLICT" : "NOT_FOUND", current };
  }
}

/**
 * 한 페이지의 질문 위치. 학생은 자기 질문만, 관리자는 모든 학생의 질문을 본다.
 * 휴지통에 있는 질문은 위치 표시에서 뺀다.
 */
export async function listGuideQuestionAnchors(
  context: DbContext,
  input: { pageId: string; viewer: GuideViewer },
): Promise<GuideQuestionAnchor[]> {
  return asDocumentReadDb(context)
    .select({
      threadId: qnaGuideAnchors.threadId,
      threadTitle: qnaThreads.title,
      status: qnaThreads.status,
      studentId: qnaThreads.studentId,
      studentName: profiles.displayName,
      blockId: qnaGuideAnchors.anchorBlockId,
      quote: qnaGuideAnchors.anchorQuote,
      pageTitle: qnaGuideAnchors.pageTitle,
      createdAt: qnaGuideAnchors.createdAt,
    })
    .from(qnaGuideAnchors)
    .innerJoin(qnaThreads, eq(qnaGuideAnchors.threadId, qnaThreads.id))
    .leftJoin(profiles, eq(qnaThreads.studentId, profiles.id))
    .where(
      and(
        eq(qnaGuideAnchors.guidePageId, input.pageId),
        isNull(qnaThreads.deletedAt),
        input.viewer.isAdmin ? undefined : eq(qnaThreads.studentId, input.viewer.id),
      ),
    )
    .orderBy(asc(qnaGuideAnchors.createdAt), asc(qnaGuideAnchors.threadId));
}

/** Q&A 상세가 보여 줄 가이드 위치. 스레드 권한은 호출자가 이미 확인했다. */
export async function findGuideAnchorForThread(
  context: DbContext,
  threadId: string,
): Promise<{ guidePageId: string | null; pageTitle: string; blockId: string | null; quote: string } | null> {
  const [anchor] = await asDocumentReadDb(context)
    .select({
      guidePageId: qnaGuideAnchors.guidePageId,
      pageTitle: qnaGuideAnchors.pageTitle,
      blockId: qnaGuideAnchors.anchorBlockId,
      quote: qnaGuideAnchors.anchorQuote,
    })
    .from(qnaGuideAnchors)
    .where(eq(qnaGuideAnchors.threadId, threadId))
    .limit(1);
  return anchor ?? null;
}
