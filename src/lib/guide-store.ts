/**
 * 공용 가이드 페이지·질문 위치의 DB 읽기와 원자적 쓰기. 권한 검사는 호출하는 server action이 먼저 하고,
 * 여기서는 버전 조건·순서·연결 정리를 한 batch로 묶는다.
 */
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { DbContext } from "@/db/client";
import {
  guidePageRevisions,
  guidePages,
  profiles,
  qnaGuideAnchors,
  qnaThreads,
  type GuidePageRevisionReason,
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
  /** 휴지통으로 옮긴 시각(0039). 읽는 화면에는 휴지통 페이지가 오지 않는다. */
  deletedAt: Date | null;
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
  | "NOT_TRASHED"
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
    .where(isNull(guidePages.deletedAt))
    .orderBy(asc(guidePages.sortOrder), asc(guidePages.createdAt), asc(guidePages.id));
}

/**
 * 페이지 하나. 휴지통 페이지(0039)는 기본으로 없는 페이지와 같고, `includeTrashed`면 함께 읽는다
 * (만들기 재전송의 id 대조, 휴지통 화면의 되살리기·영구 삭제).
 */
export async function findGuidePage(
  context: DbContext,
  pageId: string,
  options: { includeTrashed?: boolean } = {},
): Promise<GuidePageRecord | null> {
  const page = await findGuidePageIncludingTrash(context, pageId);
  if (!page || (page.deletedAt && !options.includeTrashed)) return null;
  return page;
}

async function findGuidePageIncludingTrash(context: DbContext, pageId: string): Promise<GuidePageRecord | null> {
  const [page] = await asDocumentReadDb(context)
    .select({
      id: guidePages.id,
      title: guidePages.title,
      sortOrder: guidePages.sortOrder,
      contentHtml: guidePages.contentHtml,
      version: guidePages.version,
      createdAt: guidePages.createdAt,
      updatedAt: guidePages.updatedAt,
      deletedAt: guidePages.deletedAt,
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
  const existing = await findGuidePage(context, input.pageId, { includeTrashed: true });
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
    const raced = await findGuidePage(context, input.pageId, { includeTrashed: true });
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
    /** 고치기 전 판을 이력에 남길 때 쓸 id. */
    revisionId: string;
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
  const epoch = documentEpochSeconds(input.now)!;
  try {
    await executeDocumentStatementsAtomically(context, [
      // 고치기 전 판을 이력에 남긴다. 공동 편집은 자주 저장하므로 10분 안에 남긴 판이 있으면 건너뛴다.
      guideRevisionSnapshotStatement({
        revisionId: input.revisionId,
        pageId: input.pageId,
        baseVersion: input.baseVersion,
        reason: "EDIT",
        epoch,
        coalesceSeconds: GUIDE_REVISION_COALESCE_SECONDS,
      }),
      {
        query: `
          UPDATE guide_pages
          SET title = ?, content_html = ?, version = version + 1,
              updated_by_id = (SELECT id FROM profiles WHERE id = ?),
              updated_at = MAX(created_at, ?)
          WHERE id = ? AND version = ? AND deleted_at IS NULL
        `,
        params: [
          input.title,
          input.contentHtml,
          input.actorId,
          epoch,
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

/** 이 시간 안에 남긴 판이 있으면 고치기 전 판을 다시 남기지 않는다(초). */
export const GUIDE_REVISION_COALESCE_SECONDS = 10 * 60;

/**
 * 지금 판(`baseVersion`일 때만)을 이력 한 줄로 남기는 문장. 남길 판이 없으면 0행이라 batch를 멈추지 않는다.
 * actor는 그 판을 마지막으로 고친 사람이다.
 */
function guideRevisionSnapshotStatement(input: {
  revisionId: string;
  pageId: string;
  baseVersion: number;
  reason: GuidePageRevisionReason;
  epoch: number;
  coalesceSeconds?: number;
}): DocumentAtomicStatement {
  const coalesce = input.coalesceSeconds
    ? "AND NOT EXISTS (SELECT 1 FROM guide_page_revisions AS recent WHERE recent.page_id = page.id AND recent.created_at > ?)"
    : "";
  return {
    query: `
      INSERT INTO guide_page_revisions (id, page_id, page_version, title, content_html, reason, actor_id, created_at)
      SELECT ?, page.id, page.version, page.title, page.content_html, ?, page.updated_by_id, ?
      FROM guide_pages AS page
      WHERE page.id = ? AND page.version = ? AND page.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM guide_page_revisions AS same WHERE same.page_id = page.id AND same.page_version = page.version)
        ${coalesce}
    `,
    params: [
      input.revisionId,
      input.reason,
      input.epoch,
      input.pageId,
      input.baseVersion,
      ...(input.coalesceSeconds ? [input.epoch - input.coalesceSeconds] : []),
    ],
  };
}

type GuideMutationResult = { ok: true } | { ok: false; reason: GuideWriteFailureReason; current: GuidePageRecord | null };

/**
 * 페이지를 휴지통으로 옮긴다(0039). 질문 위치·이미지·학생에게 열어 준 표시는 그대로 두어 되살리면 다시 이어진다.
 * 휴지통에 있는 동안 목록·읽기·열람 범위·질문 위치 링크에서 빠진다.
 */
export async function trashGuidePageRecord(
  context: DbContext,
  input: { actorId: string; pageId: string; baseVersion: number; now: Date },
): Promise<GuideMutationResult> {
  const before = await findGuidePage(context, input.pageId);
  if (!before) return { ok: false, reason: "NOT_FOUND", current: null };
  if (before.version !== input.baseVersion) {
    return { ok: false, reason: "VERSION_CONFLICT", current: before };
  }
  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          UPDATE guide_pages
          SET deleted_at = ?, deleted_by_id = (SELECT id FROM profiles WHERE id = ?), version = version + 1
          WHERE id = ? AND version = ? AND deleted_at IS NULL
        `,
        params: [documentEpochSeconds(input.now), input.actorId, input.pageId, input.baseVersion],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
    return { ok: true };
  } catch {
    const current = await findGuidePage(context, input.pageId);
    return { ok: false, reason: current ? "VERSION_CONFLICT" : "NOT_FOUND", current };
  }
}

/** 휴지통 페이지를 되살린다. 순서 자리는 지우기 전 그대로다. 같은 요청을 다시 보내도 결과가 같다. */
export async function restoreTrashedGuidePageRecord(
  context: DbContext,
  input: { pageId: string },
): Promise<GuideMutationResult> {
  const before = await findGuidePage(context, input.pageId, { includeTrashed: true });
  if (!before) return { ok: false, reason: "NOT_FOUND", current: null };
  if (!before.deletedAt) return { ok: true };
  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          UPDATE guide_pages SET deleted_at = NULL, deleted_by_id = NULL, version = version + 1
          WHERE id = ? AND version = ? AND deleted_at IS NOT NULL
        `,
        params: [input.pageId, before.version],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
    return { ok: true };
  } catch {
    const current = await findGuidePage(context, input.pageId, { includeTrashed: true });
    if (current && !current.deletedAt) return { ok: true };
    return { ok: false, reason: current ? "VERSION_CONFLICT" : "NOT_FOUND", current };
  }
}

/**
 * 휴지통 페이지를 영구 삭제한다. 질문 위치·이미지는 FK SET NULL에만 기대지 않고 같은 batch에서 먼저 연결을 끊어
 * 질문은 제목·인용과 함께 남는다. 이력도 함께 지운다(FK cascade).
 */
export async function purgeGuidePageRecord(
  context: DbContext,
  input: { pageId: string },
): Promise<GuideMutationResult> {
  const before = await findGuidePage(context, input.pageId, { includeTrashed: true });
  if (!before) return { ok: true };
  if (!before.deletedAt) return { ok: false, reason: "NOT_TRASHED", current: before };
  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: "UPDATE qna_guide_anchors SET guide_page_id = NULL WHERE guide_page_id = ? AND EXISTS (SELECT 1 FROM guide_pages WHERE id = ? AND deleted_at IS NOT NULL)",
        params: [input.pageId, input.pageId],
      },
      {
        query: "UPDATE guide_assets SET guide_page_id = NULL WHERE guide_page_id = ? AND EXISTS (SELECT 1 FROM guide_pages WHERE id = ? AND deleted_at IS NOT NULL)",
        params: [input.pageId, input.pageId],
      },
      {
        // 학생에게 열어 준 표시도 함께 지운다(FK cascade에만 기대지 않는다).
        query: "DELETE FROM guide_access_pages WHERE guide_page_id = ? AND EXISTS (SELECT 1 FROM guide_pages WHERE id = ? AND deleted_at IS NOT NULL)",
        params: [input.pageId, input.pageId],
      },
      {
        query: "DELETE FROM guide_pages WHERE id = ? AND deleted_at IS NOT NULL",
        params: [input.pageId],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
    return { ok: true };
  } catch {
    const current = await findGuidePage(context, input.pageId, { includeTrashed: true });
    if (!current) return { ok: true };
    return { ok: false, reason: current.deletedAt ? "INTERNAL" : "NOT_TRASHED", current };
  }
}

export type TrashedGuidePage = { id: string; title: string; deletedAt: Date; deletedByName: string | null };

/** 휴지통 페이지 목록(최근 지운 순). */
export async function listTrashedGuidePages(context: DbContext): Promise<TrashedGuidePage[]> {
  const rows = await asDocumentReadDb(context)
    .select({
      id: guidePages.id,
      title: guidePages.title,
      deletedAt: guidePages.deletedAt,
      deletedByName: profiles.displayName,
    })
    .from(guidePages)
    .leftJoin(profiles, eq(guidePages.deletedById, profiles.id))
    .where(isNotNull(guidePages.deletedAt))
    .orderBy(desc(guidePages.deletedAt), asc(guidePages.id));
  return rows.flatMap((row) => (row.deletedAt ? [{ ...row, deletedAt: row.deletedAt }] : []));
}

export type GuidePageRevisionRow = {
  id: string;
  pageVersion: number;
  title: string;
  contentHtml: string;
  reason: GuidePageRevisionReason;
  actorName: string | null;
  createdAt: Date;
};

/** 한 페이지의 이전 판(최근 순). */
export async function listGuidePageRevisions(context: DbContext, pageId: string): Promise<GuidePageRevisionRow[]> {
  return asDocumentReadDb(context)
    .select({
      id: guidePageRevisions.id,
      pageVersion: guidePageRevisions.pageVersion,
      title: guidePageRevisions.title,
      contentHtml: guidePageRevisions.contentHtml,
      reason: guidePageRevisions.reason,
      actorName: profiles.displayName,
      createdAt: guidePageRevisions.createdAt,
    })
    .from(guidePageRevisions)
    .leftJoin(profiles, eq(guidePageRevisions.actorId, profiles.id))
    .where(eq(guidePageRevisions.pageId, pageId))
    .orderBy(desc(guidePageRevisions.pageVersion), desc(guidePageRevisions.createdAt));
}

/**
 * 이전 판으로 되돌린다. 지금 판을 먼저 이력에 남기고(RESTORE, 되돌리기도 되돌릴 수 있게) 그 판의 제목·본문을 새 판으로 쓴다.
 * `baseVersion`이 지금 판과 다르면 덮지 않는다.
 */
export async function restoreGuidePageRevisionRecord(
  context: DbContext,
  input: { actorId: string; pageId: string; revisionId: string; baseVersion: number; snapshotId: string; now: Date },
): Promise<GuideWriteResult> {
  const before = await findGuidePage(context, input.pageId);
  if (!before) return { ok: false, reason: "NOT_FOUND", current: null };
  const [revision] = await asDocumentReadDb(context)
    .select({ title: guidePageRevisions.title, contentHtml: guidePageRevisions.contentHtml })
    .from(guidePageRevisions)
    .where(and(eq(guidePageRevisions.id, input.revisionId), eq(guidePageRevisions.pageId, input.pageId)))
    .limit(1);
  if (!revision) return { ok: false, reason: "NOT_FOUND", current: before };
  if (before.version !== input.baseVersion) {
    // 응답을 잃고 다시 보낸 같은 되돌리기면 이미 반영된 것으로 본다.
    if (before.version === input.baseVersion + 1 && samePayload(before, revision.title, revision.contentHtml)) {
      return { ok: true, page: before, replayed: true };
    }
    return { ok: false, reason: "VERSION_CONFLICT", current: before };
  }
  const epoch = documentEpochSeconds(input.now)!;
  try {
    await executeDocumentStatementsAtomically(context, [
      guideRevisionSnapshotStatement({
        revisionId: input.snapshotId,
        pageId: input.pageId,
        baseVersion: input.baseVersion,
        reason: "RESTORE",
        epoch,
      }),
      {
        query: `
          UPDATE guide_pages
          SET title = ?, content_html = ?, version = version + 1,
              updated_by_id = (SELECT id FROM profiles WHERE id = ?),
              updated_at = MAX(created_at, ?)
          WHERE id = ? AND version = ? AND deleted_at IS NULL
        `,
        params: [revision.title, revision.contentHtml, input.actorId, epoch, input.pageId, input.baseVersion],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
  } catch {
    const current = await findGuidePage(context, input.pageId);
    return { ok: false, reason: current ? "VERSION_CONFLICT" : "NOT_FOUND", current };
  }
  const page = await findGuidePage(context, input.pageId);
  return page ? { ok: true, page, replayed: false } : { ok: false, reason: "NOT_FOUND", current: null };
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
      pageDeletedAt: guidePages.deletedAt,
      pageTitle: qnaGuideAnchors.pageTitle,
      blockId: qnaGuideAnchors.anchorBlockId,
      quote: qnaGuideAnchors.anchorQuote,
    })
    .from(qnaGuideAnchors)
    .leftJoin(guidePages, eq(qnaGuideAnchors.guidePageId, guidePages.id))
    .where(eq(qnaGuideAnchors.threadId, threadId))
    .limit(1);
  if (!anchor) return null;
  // 휴지통 페이지로 가는 링크는 빼고 제목·인용만 보인다(되살리면 다시 이어진다).
  const { pageDeletedAt, ...rest } = anchor;
  return pageDeletedAt ? { ...rest, guidePageId: null } : rest;
}
