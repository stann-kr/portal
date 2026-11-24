/**
 * @file src/lib/actions/guide.ts
 * @description 공용 가이드 페이지 server action. 관리자는 모두 읽고·만들고·고치고·순서를 바꾸고·지운다.
 * 학생은 Stann이 열어 준 범위(src/lib/guide-access.ts: 닫힘·전체·선택)만 읽는다. 열리지 않은 페이지는 없는 페이지와 같게 답한다.
 * 학생 질문 위치는 서버 query에서 본인 질문만(관리자는 전체) 고른다.
 */
"use server";

import { formatCollabDocKey } from "@/lib/collab/doc-key";
import {
  abortCollabRestore,
  applyCollabRestore,
  beginCollabRestore,
  closeCollabRoomAfterMutation,
  parseCollabSaveEpoch,
  STALE_COLLAB_SAVE_MESSAGE,
} from "@/lib/collab/server-env";
import { readGuideRestoreTarget } from "@/lib/collab/restore-targets";
import { revalidatePath } from "next/cache";
import { createDbContext } from "@/db/client";
import { requireAdmin, requireAuth, type AuthSession } from "@/lib/auth-guard";
import { canViewGuidePage, resolveGuideViewerAccess, type GuideViewerAccess } from "@/lib/guide-access";
import { readRuntimeEnv } from "@/lib/runtime-env";
import {
  CREATION_OPERATION_FIELD,
  deriveCreationResourceId,
  resolveCreationOperationId,
} from "@/lib/creation-operation";
import {
  GUIDE_BASE_REVISION_FIELD,
  GUIDE_CONTENT_MAX_BYTES,
  GUIDE_TITLE_MAX_LENGTH,
  extractGuideAssetIds,
  parseGuidePageId,
  prepareGuideHtml,
  unwrapClosedGuidePageLinks,
} from "@/lib/guide-content";
import {
  createGuidePageRecord,
  findGuidePage,
  listGuidePageRevisions,
  listGuidePageSummaries,
  listGuideQuestionAnchors,
  listTrashedGuidePages,
  purgeGuidePageRecord,
  reorderGuidePageRecords,
  restoreGuidePageRevisionRecord,
  restoreTrashedGuidePageRecord,
  trashGuidePageRecord,
  updateGuidePageRecord,
  type GuidePageRecord,
  type GuidePageRevisionRow,
  type TrashedGuidePage,
  type GuideQuestionAnchor,
  type GuideWriteFailureReason,
} from "@/lib/guide-store";

function revalidateGuide(): void {
  revalidatePath("/dashboard/guide", "layout");
}

function failureMessage(reason: GuideWriteFailureReason): string {
  switch (reason) {
    case "VERSION_CONFLICT":
      return "다른 화면에서 이 가이드가 먼저 바뀌었습니다. 현재 초안과 서버 최신본을 비교해 골라 주세요.";
    case "OPERATION_PAYLOAD_CONFLICT":
      return "같은 생성 요청이 다른 내용으로 이미 처리되었습니다. 새로고침한 뒤 다시 만들어 주세요.";
    case "NOT_FOUND":
      return "가이드 페이지를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.";
    case "STALE_ORDER":
      return "다른 화면에서 페이지 목록이 바뀌었습니다. 새로고침한 뒤 다시 정렬해 주세요.";
    case "NOT_TRASHED":
      return "휴지통에 있는 페이지만 영구 삭제할 수 있습니다.";
    case "COLLAB_STALE":
      return STALE_COLLAB_SAVE_MESSAGE;
    case "INTERNAL":
      return "가이드를 안전하게 저장하지 못했습니다. 현재 초안을 유지한 채 다시 시도해 주세요.";
  }
}

function parseRevision(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

type GuidePayload =
  | { ok: true; title: string; contentHtml: string; assetIds: string[] }
  | { ok: false; error: string };

function readGuidePayload(formData: FormData): GuidePayload {
  const title = String(formData.get("title") ?? "").replace(/\s+/gu, " ").trim();
  if (!title) return { ok: false, error: "제목을 입력해 주세요." };
  if (Array.from(title).length > GUIDE_TITLE_MAX_LENGTH) {
    return { ok: false, error: `제목은 ${GUIDE_TITLE_MAX_LENGTH}자까지 입력할 수 있습니다.` };
  }
  let contentHtml: string;
  try {
    contentHtml = prepareGuideHtml(String(formData.get("contentHtml") ?? ""));
  } catch {
    return { ok: false, error: "본문을 안전하게 정리하지 못했습니다. 붙여 넣은 내용을 줄여 다시 시도해 주세요." };
  }
  if (new TextEncoder().encode(contentHtml).byteLength > GUIDE_CONTENT_MAX_BYTES) {
    return { ok: false, error: "가이드 본문은 저장된 HTML 기준 800 KiB까지 저장할 수 있습니다. 페이지를 나누어 주세요." };
  }
  return { ok: true, title, contentHtml, assetIds: extractGuideAssetIds(contentHtml) };
}

function toClientPage(page: GuidePageRecord) {
  return { id: page.id, title: page.title, contentHtml: page.contentHtml, version: page.version };
}

export type GuideClientPage = ReturnType<typeof toClientPage>;

function viewerOf(session: AuthSession) {
  return { id: session.user.id, isAdmin: session.user.role === "admin" };
}

function viewerAccess(session: AuthSession): Promise<GuideViewerAccess> {
  return resolveGuideViewerAccess(createDbContext(), viewerOf(session));
}

/** 사이드 목록용 페이지 제목·순서. 학생은 열린 페이지만 받는다. */
export async function getGuidePages() {
  const session = await requireAuth();
  const context = createDbContext();
  const access = await resolveGuideViewerAccess(context, viewerOf(session));
  if (access.kind === "closed") return [];
  const pages = await listGuidePageSummaries(context);
  return access.kind === "all" ? pages : pages.filter((page) => access.pageIds.has(page.id));
}

/** 보는 사람에게 가이드가 닫혀 있는지(열린 페이지가 하나도 없음). 닫힌 학생에게는 안내만 보인다. */
export async function isGuideClosedForViewer(): Promise<boolean> {
  return (await viewerAccess(await requireAuth())).kind === "closed";
}

/**
 * 보는 사람에게 열린 페이지만 돌려준다. 일부 페이지만 열린("선택") 학생에게는 본문에서 열리지 않은 페이지로 가는
 * 링크를 글자로 바꿔 보낸다. 관리자와 "전체" 학생은 본문 그대로다.
 */
export async function getGuidePage(pageId: string): Promise<GuidePageRecord | null> {
  const session = await requireAuth();
  const id = parseGuidePageId(pageId);
  const access = await viewerAccess(session);
  if (!id || !canViewGuidePage(access, id)) return null;
  const page = await findGuidePage(createDbContext(), id);
  if (!page || access.kind !== "selected") return page;
  return {
    ...page,
    // 본문 기준 상대 주소는 이 페이지 주소로 읽고, 주소창에서 붙여 넣은 포탈 전체 주소(AUTH_URL origin) 링크도 같은 규칙을 따른다.
    contentHtml: unwrapClosedGuidePageLinks(
      page.contentHtml,
      (linked) => access.pageIds.has(linked),
      { currentPageId: id, portalOrigin: readRuntimeEnv("AUTH_URL") },
    ),
  };
}

/** 이 페이지에 걸린 질문 위치. 학생은 본인 질문만, 관리자는 학생 이름과 함께 전부. 열리지 않은 페이지는 빈 목록이다. */
export async function getGuideQuestions(pageId: string): Promise<GuideQuestionAnchor[]> {
  const session = await requireAuth();
  const id = parseGuidePageId(pageId);
  if (!id || !canViewGuidePage(await viewerAccess(session), id)) return [];
  return listGuideQuestionAnchors(createDbContext(), {
    pageId: id,
    viewer: viewerOf(session),
  });
}

export type CreateGuidePageState = {
  error?: string;
  success?: boolean;
  pageId?: string;
};

export async function createGuidePage(
  _prev: CreateGuidePageState,
  formData: FormData,
): Promise<CreateGuidePageState> {
  const session = await requireAdmin();
  const operationId = resolveCreationOperationId(formData.get(CREATION_OPERATION_FIELD));
  if (!operationId) return { error: "생성 식별자가 올바르지 않습니다. 페이지를 새로고침해 주세요." };
  const payload = readGuidePayload(formData);
  if (!payload.ok) return { error: payload.error };
  const result = await createGuidePageRecord(createDbContext(), {
    actorId: session.user.id,
    pageId: deriveCreationResourceId(operationId, JSON.stringify(["guide-page"])),
    title: payload.title,
    contentHtml: payload.contentHtml,
    assetIds: payload.assetIds,
    now: new Date(),
  });
  if (!result.ok) return { error: failureMessage(result.reason) };
  revalidateGuide();
  return { success: true, pageId: result.page.id };
}

export type UpdateGuidePageState = {
  error?: string;
  /** 공동 편집 room이 비워진 뒤의 옛 저장이라 반영하지 않았다. */
  collabStale?: boolean;
  success?: boolean;
  replayed?: boolean;
  conflictKind?: GuideWriteFailureReason;
  currentRevision?: number | null;
  conflictPage?: GuideClientPage;
  page?: GuideClientPage;
};

export async function updateGuidePage(
  pageId: string,
  _prev: UpdateGuidePageState,
  formData: FormData,
): Promise<UpdateGuidePageState> {
  const session = await requireAdmin();
  const id = parseGuidePageId(pageId);
  if (!id) return { error: failureMessage("NOT_FOUND"), conflictKind: "NOT_FOUND" };
  const baseVersion = parseRevision(formData.get(GUIDE_BASE_REVISION_FIELD));
  if (!baseVersion) {
    return { error: "저장 기준을 확인할 수 없습니다. 현재 초안을 유지한 채 페이지를 새로고침해 주세요." };
  }
  const payload = readGuidePayload(formData);
  if (!payload.ok) return { error: payload.error };
  // 공동 편집 저장은 room 세대(lifecycle 표지)를 싣는다. 되돌리기 전 세대의 저장은 아래 기록 단계가 거부한다.
  const collab = parseCollabSaveEpoch(formData);
  if (!collab.ok) return { error: STALE_COLLAB_SAVE_MESSAGE, collabStale: true };
  const result = await updateGuidePageRecord(createDbContext(), {
    actorId: session.user.id,
    pageId: id,
    baseVersion,
    title: payload.title,
    contentHtml: payload.contentHtml,
    assetIds: payload.assetIds,
    revisionId: crypto.randomUUID(),
    ...(collab.collabEpoch === undefined ? {} : { collabEpoch: collab.collabEpoch }),
    now: new Date(),
  });
  if (!result.ok) {
    if (result.reason === "COLLAB_STALE") return { error: STALE_COLLAB_SAVE_MESSAGE, collabStale: true };
    return {
      error: failureMessage(result.reason),
      conflictKind: result.reason,
      currentRevision: result.current?.version ?? null,
      conflictPage: result.reason === "VERSION_CONFLICT" && result.current ? toClientPage(result.current) : undefined,
    };
  }
  revalidateGuide();
  return {
    success: true,
    replayed: result.replayed,
    currentRevision: result.page.version,
    page: toClientPage(result.page),
  };
}

export type GuideMutationState = { ok: true } | { ok: false; error: string };

export async function reorderGuidePages(orderedIds: string[]): Promise<GuideMutationState> {
  await requireAdmin();
  if (!Array.isArray(orderedIds) || orderedIds.length > 500) {
    return { ok: false, error: failureMessage("STALE_ORDER") };
  }
  const ids = orderedIds.map(parseGuidePageId);
  if (ids.some((value) => value === null)) return { ok: false, error: failureMessage("STALE_ORDER") };
  const result = await reorderGuidePageRecords(createDbContext(), ids as string[]);
  if (!result.ok) return { ok: false, error: failureMessage(result.reason) };
  revalidateGuide();
  return { ok: true };
}

/** 페이지를 휴지통으로 옮긴다(0039). 휴지통에서 되살리거나 영구 삭제한다. */
export async function deleteGuidePage(pageId: string, baseVersion: number): Promise<GuideMutationState> {
  const session = await requireAdmin();
  const id = parseGuidePageId(pageId);
  const version = parseRevision(baseVersion);
  if (!id || !version) return { ok: false, error: failureMessage("NOT_FOUND") };
  const result = await trashGuidePageRecord(createDbContext(), {
    actorId: session.user.id,
    pageId: id,
    baseVersion: version,
    now: new Date(),
  });
  if (!result.ok) return { ok: false, error: failureMessage(result.reason) };
  // 열린 편집기 연결을 닫는다(휴지통 페이지는 토큰을 받지 못한다). 상태는 남겨 되살리면 그대로 이어진다.
  // 비우면 room 세대가 lifecycle 표지보다 앞서 되살린 뒤 다시 붙지 못한다.
  await closeCollabRoomAfterMutation(formatCollabDocKey({ kind: "guide", id }), true);
  revalidateGuide();
  return { ok: true };
}

/** 휴지통 페이지 목록(관리자). */
export async function getTrashedGuidePages(): Promise<TrashedGuidePage[]> {
  await requireAdmin();
  return listTrashedGuidePages(createDbContext());
}

export async function restoreTrashedGuidePage(pageId: string): Promise<GuideMutationState> {
  await requireAdmin();
  const id = parseGuidePageId(pageId);
  if (!id) return { ok: false, error: failureMessage("NOT_FOUND") };
  const result = await restoreTrashedGuidePageRecord(createDbContext(), { pageId: id });
  if (!result.ok) return { ok: false, error: failureMessage(result.reason) };
  revalidateGuide();
  return { ok: true };
}

/** 휴지통 페이지를 영구 삭제한다. 이 페이지에서 시작한 질문은 Q&A에 제목·인용과 함께 남는다. */
export async function purgeTrashedGuidePage(pageId: string): Promise<GuideMutationState> {
  await requireAdmin();
  const id = parseGuidePageId(pageId);
  if (!id) return { ok: false, error: failureMessage("NOT_FOUND") };
  const result = await purgeGuidePageRecord(createDbContext(), { pageId: id });
  if (!result.ok) return { ok: false, error: failureMessage(result.reason) };
  // 지운 페이지의 공동 편집 상태도 비운다.
  await closeCollabRoomAfterMutation(formatCollabDocKey({ kind: "guide", id }), false);
  revalidateGuide();
  return { ok: true };
}

/** 한 페이지의 이전 판(관리자). 휴지통 페이지는 없는 페이지와 같다. */
export async function getGuidePageHistory(
  pageId: string,
): Promise<{ page: GuidePageRecord; revisions: GuidePageRevisionRow[] } | null> {
  await requireAdmin();
  const id = parseGuidePageId(pageId);
  if (!id) return null;
  const context = createDbContext();
  const page = await findGuidePage(context, id);
  if (!page) return null;
  return { page, revisions: await listGuidePageRevisions(context, id) };
}

/**
 * 이전 판으로 되돌린다. 지금 판은 이력에 남아 다시 되돌릴 수 있다.
 * 열린 편집기에는 노트·게시물처럼 되돌린 본문을 같은 문서의 한 편집으로 적용한다(room 세대 = lifecycle 표지).
 * 편집기에 아직 저장되지 않은 입력이 있으면 되돌리지 않는다(자동 저장이 끝난 뒤 다시 시도).
 */
export async function restoreGuidePageRevision(
  pageId: string,
  revisionId: string,
  baseVersion: number,
): Promise<GuideMutationState> {
  const session = await requireAdmin();
  const id = parseGuidePageId(pageId);
  const version = parseRevision(baseVersion);
  if (!id || !version || typeof revisionId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/u.test(revisionId)) {
    return { ok: false, error: failureMessage("NOT_FOUND") };
  }
  const roomKey = formatCollabDocKey({ kind: "guide", id });
  const operationId = crypto.randomUUID();
  const prepared = await beginCollabRestore(roomKey, operationId);
  if (prepared.kind === "busy" || prepared.kind === "failed") {
    await abortCollabRestore(roomKey, operationId);
    return {
      ok: false,
      error: prepared.kind === "busy" ? "다른 화면에서 이미 되돌리는 중입니다. 잠시 뒤 다시 시도해 주세요." : "열린 편집 화면을 확인하지 못해 되돌리지 않았습니다. 잠시 뒤 다시 시도해 주세요.",
    };
  }
  if (prepared.kind === "ready" && !prepared.clean) {
    await abortCollabRestore(roomKey, operationId);
    return { ok: false, error: "편집 화면에 아직 저장되지 않은 입력이 있어 되돌리지 않았습니다. 저장된 뒤 다시 시도해 주세요." };
  }
  let result: Awaited<ReturnType<typeof restoreGuidePageRevisionRecord>>;
  try {
    result = await restoreGuidePageRevisionRecord(createDbContext(), {
      actorId: session.user.id,
      pageId: id,
      revisionId,
      baseVersion: version,
      snapshotId: crypto.randomUUID(),
      now: new Date(),
    });
  } catch (error) {
    await abortCollabRestore(roomKey, operationId);
    throw error;
  }
  if (!result.ok) {
    await abortCollabRestore(roomKey, operationId);
    return { ok: false, error: failureMessage(result.reason) };
  }
  // 이 되돌리기의 판 번호가 새 세대다. 재전송이면 이미 적용된 세대라 room이 건너뛴다.
  const target = await readGuideRestoreTarget(id);
  if (target && result.page.collabLifecycle > 0) await applyCollabRestore(roomKey, operationId, result.page.collabLifecycle, target);
  else await abortCollabRestore(roomKey, operationId);
  revalidateGuide();
  return { ok: true };
}
