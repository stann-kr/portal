/** Community post query와 revision/trash lifecycle server action. */
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
import { canonicalServerHtml } from "@/lib/collab/server-restore";
import { postRoomFields, readPostRestoreTarget, type PostHeadRow } from "@/lib/collab/restore-targets";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDb, createDbContext } from "@/db/client";
import { categories, comments, postRevisions, posts, profiles, type BoardType } from "@/db/schema";
import { assertOwnerOrAdmin, requireAuth } from "@/lib/auth-guard";
import {
  CREATION_OPERATION_FIELD,
  deriveCreationResourceId,
  resolveCreationOperationId,
} from "@/lib/creation-operation";
import {
  DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD,
  createDocumentSnapshotFingerprint,
  isDocumentSnapshotFingerprint,
} from "@/lib/document-snapshot-fingerprint";
import {
  createPostAtomically,
  preflightLegacyPostCreateReplay,
  purgePostAtomically,
  readPostLifecycleMarker,
  restorePostRevisionAtomically,
  restoreTrashedPostAtomically,
  setPostPinAtomically,
  trashPostAtomically,
  updatePostAtomically,
  type PostMutationFailureReason,
  type PostMutationResult,
  postLifecycleSql,
} from "@/lib/post-atomic";
import {
  POST_BASE_REVISION_FIELD,
  POST_MAX_CONTENT_LABEL,
  POST_MAX_TITLE_LENGTH,
  POST_TRASH_RETENTION_SECONDS,
  isPostContentWithinLimit,
  parsePostRevision,
} from "@/lib/post-continuity";
import {
  COMMUNITY_PAGE_SIZE,
  COMMUNITY_PREVIEW_SOURCE_CHARS,
  decodeCommunityPostCursor,
  encodeCommunityPostCursor,
} from "@/lib/community-post-page";
import { isMixsetLinkUrl, MIXSET_LINK_FIELD, normalizeMixsetLinkUrl } from "@/lib/community-mixset-media";
import {
  COMMUNITY_SEARCH_RESULT_LIMIT,
  communitySearchFilter,
  getCommunitySearchWords,
  matchesCommunityPostSearch,
  type CommunitySearchScope,
} from "@/lib/community-search";
import { isRichTextEmpty } from "@/lib/rich-text";
import { safeReturnPath } from "@/lib/safe-return-path";
import { sanitizeHtml } from "@/lib/sanitize-html";
import {
  findOwnedMediaObject,
  processMediaDeletionOutboxBestEffort,
} from "@/lib/media-lifecycle-atomic";
import { mediaDeliveryPath, parseMediaUuidV4 } from "@/lib/media-lifecycle";
import { publicAuthorName } from "@/lib/public-author-name";
import { pushMessages } from "@/lib/push/messages";
import { notifyPush } from "@/lib/push/notify";

const VALID_BOARD_TYPES: readonly BoardType[] = ["ANNOUNCEMENT", "GENERAL", "FEEDBACK"];

const POST_SELECT = {
  id: posts.id,
  authorId: posts.authorId,
  category: posts.category,
  boardType: posts.boardType,
  isPinned: posts.isPinned,
  mediaUrl: posts.mediaUrl,
  mediaObjectId: posts.mediaObjectId,
  title: posts.title,
  contentHtml: posts.contentHtml,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
  version: posts.version,
  deletedAt: posts.deletedAt,
  authorName: publicAuthorName,
} as const;

function lifecycleError(reason: PostMutationFailureReason): string {
  switch (reason) {
    case "COLLAB_STALE":
      return "문서가 복원되어 최신 내용으로 다시 불러옵니다. 이 저장은 반영하지 않았습니다.";
    case "VERSION_CONFLICT":
      return "다른 화면에서 이 게시물이 먼저 변경되었습니다. 현재 초안은 유지됩니다.";
    case "TRASHED":
      return "이 게시물은 휴지통에 있습니다.";
    case "PURGED":
      return "이 게시물은 영구 삭제되어 다시 저장할 수 없습니다.";
    case "OPERATION_PAYLOAD_CONFLICT":
      return "같은 작업 식별자가 다른 내용에 이미 사용되었습니다.";
    case "OPERATION_VERSION_UNSUPPORTED":
      return "오래된 저장 요청을 확인할 수 없습니다. 페이지를 새로고침해 주세요.";
    case "RETENTION_NOT_EXPIRED":
      return "휴지통 보존 기간이 끝난 뒤에만 영구 삭제할 수 있습니다.";
    case "RETENTION_EXPIRED":
      return "복원 가능 기간이 지났습니다.";
    case "NOT_FOUND_OR_FORBIDDEN":
      return "게시물을 찾을 수 없거나 권한이 없습니다.";
    case "INTERNAL_INVARIANT_FAILURE":
      return "게시물 상태를 안전하게 변경하지 못했습니다. 다시 시도해 주세요.";
  }
}

function actor(session: Awaited<ReturnType<typeof requireAuth>>) {
  return { id: session.user.id!, isAdmin: session.user.role === "admin" };
}

function revalidatePostPaths(postId?: string) {
  revalidatePath("/community");
  revalidatePath("/community/trash");
  if (postId) {
    revalidatePath(`/community/${postId}`);
    revalidatePath(`/community/${postId}/history`);
  }
  revalidatePath("/dashboard/student");
  revalidatePath("/dashboard/admin");
}

const POST_SUMMARY_SELECT = {
  id: posts.id,
  title: posts.title,
  boardType: posts.boardType,
  isPinned: posts.isPinned,
  createdAt: posts.createdAt,
  authorName: publicAuthorName,
} as const;

const POST_SUMMARY_MAX_LIMIT = 50;

function clampSummaryLimit(limit: number): number {
  return Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), POST_SUMMARY_MAX_LIMIT) : 1;
}

/** 학생 오늘 화면용: 고정 공지 우선·최신순 공지 제목만 개수 제한해 읽는다. */
export async function getAnnouncementSummaries(limit = 3) {
  await requireAuth();
  return createDb()
    .select(POST_SUMMARY_SELECT)
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(and(eq(posts.boardType, "ANNOUNCEMENT"), isNull(posts.deletedAt)))
    .orderBy(desc(posts.isPinned), desc(posts.createdAt))
    .limit(clampSummaryLimit(limit));
}

/**
 * 커뮤니티 목록 한 페이지. 공지·믹스셋은 고정 우선, 자유 게시판은 채널별 최신순이며
 * (고정 여부, 작성 시각, ID) keyset으로 다음 페이지를 이어 읽는다. 본문은 미리보기에 필요한 앞부분만,
 * 댓글은 개수만 보낸다(고정 공지 미리보기도 앞 3줄이라 본문 전체가 필요 없다).
 */
export async function getCommunityPostPage(input: {
  boardType: BoardType;
  category?: string | null;
  cursor?: string | null;
}) {
  await requireAuth();
  const { boardType } = input;
  if (!VALID_BOARD_TYPES.includes(boardType)) throw new Error("Invalid board type");
  const cursor = input.cursor ? decodeCommunityPostCursor(input.cursor) : null;
  if (input.cursor && !cursor) throw new Error("Invalid community cursor");
  const category = boardType === "GENERAL" ? input.category?.trim() ?? "" : "";
  if (boardType === "GENERAL" && !category) return { posts: [], nextCursor: null };

  const ordersByPin = boardType !== "GENERAL";
  const pinnedKey = sql<number>`(CASE WHEN ${posts.isPinned} THEN 1 ELSE 0 END)`;
  const createdKey = sql<number>`coalesce(${posts.createdAt}, 0)`;
  const afterCreated = cursor
    ? sql`(${createdKey} < ${cursor.createdAt} OR (${createdKey} = ${cursor.createdAt} AND ${posts.id} < ${cursor.id}))`
    : undefined;
  const afterCursor = cursor && ordersByPin
    ? sql`(${pinnedKey} < ${cursor.pinned} OR (${pinnedKey} = ${cursor.pinned} AND ${afterCreated}))`
    : afterCreated;

  const rows = await createDb()
    .select({
      ...POST_SELECT,
      contentHtml: sql<string>`substr(${posts.contentHtml}, 1, ${COMMUNITY_PREVIEW_SOURCE_CHARS})`,
      commentCount: sql<number>`(SELECT count(*) FROM ${comments} WHERE ${comments.postId} = ${posts.id})`.mapWith(Number),
      pinnedKey,
      createdKey,
    })
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(and(
      eq(posts.boardType, boardType),
      isNull(posts.deletedAt),
      category ? eq(posts.category, category) : undefined,
      afterCursor,
    ))
    .orderBy(...(ordersByPin ? [desc(pinnedKey)] : []), desc(createdKey), desc(posts.id))
    .limit(COMMUNITY_PAGE_SIZE + 1);

  const pageRows = rows.slice(0, COMMUNITY_PAGE_SIZE);
  const last = pageRows.at(-1);
  return {
    posts: pageRows.map(({ pinnedKey, createdKey, ...post }) => {
      void pinnedKey;
      void createdKey;
      return post;
    }),
    nextCursor: rows.length > COMMUNITY_PAGE_SIZE && last
      ? encodeCommunityPostCursor({
        pinned: ordersByPin && Number(last.pinnedKey) === 1 ? 1 : 0,
        createdAt: Number(last.createdKey),
        id: last.id,
      })
      : null,
  };
}

/**
 * 커뮤니티 게시물 검색(Q&A 검색과 같은 규칙). 목록과 같은 보이기 규칙(로그인·휴지통 제외)을 쓰고,
 * 지금 게시판·채널(scope current) 또는 전체(scope all)에서 최신순으로 최대 50개를 돌려준다.
 * 긴 본문을 한 번에 메모리에 올리지 않도록 고정된 크기로 나눠 읽는다.
 */
export async function searchCommunityPosts(input: {
  boardType: BoardType;
  category?: string | null;
  query: string;
  scope?: CommunitySearchScope;
}) {
  await requireAuth();
  if (!VALID_BOARD_TYPES.includes(input.boardType)) throw new Error("Invalid board type");
  const words = getCommunitySearchWords(input.query);
  if (words.length === 0) return { posts: [] };
  const filter = communitySearchFilter({
    scope: input.scope ?? "current",
    boardType: input.boardType,
    category: input.category?.trim() ?? "",
  });
  if (filter.boardType === "GENERAL" && !filter.category) return { posts: [] };

  const createdKey = sql<number>`coalesce(${posts.createdAt}, 0)`;
  const batchSize = 64;
  const matched: Awaited<ReturnType<typeof getCommunityPostPage>>["posts"] = [];
  const db = createDb();
  const readBatch = (cursor: { createdAt: number; id: string } | null) => db
    .select({
      ...POST_SELECT,
      commentCount: sql<number>`(SELECT count(*) FROM ${comments} WHERE ${comments.postId} = ${posts.id})`.mapWith(Number),
      createdKey,
    })
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(and(
      isNull(posts.deletedAt),
      filter.boardType ? eq(posts.boardType, filter.boardType) : undefined,
      filter.category ? eq(posts.category, filter.category) : undefined,
      cursor
        ? sql`(${createdKey} < ${cursor.createdAt} OR (${createdKey} = ${cursor.createdAt} AND ${posts.id} < ${cursor.id}))`
        : undefined,
    ))
    .orderBy(desc(createdKey), desc(posts.id))
    .limit(batchSize);
  let cursor: { createdAt: number; id: string } | null = null;
  while (matched.length < COMMUNITY_SEARCH_RESULT_LIMIT) {
    const rows = await readBatch(cursor);
    for (const { createdKey: rowCreatedKey, ...post } of rows) {
      void rowCreatedKey;
      if (!matchesCommunityPostSearch(post, words)) continue;
      // 목록 줄은 앞부분만 쓰므로 목록과 같은 길이로 줄여 보낸다.
      matched.push({ ...post, contentHtml: post.contentHtml.slice(0, COMMUNITY_PREVIEW_SOURCE_CHARS) });
      if (matched.length >= COMMUNITY_SEARCH_RESULT_LIMIT) break;
    }
    if (rows.length < batchSize) break;
    const last = rows[rows.length - 1]!;
    cursor = { createdAt: Number(last.createdKey), id: last.id };
  }
  return { posts: matched };
}

export async function getPostById(postId: string) {
  await requireAuth();
  const [post] = await createDb()
    .select(POST_SELECT)
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .limit(1);
  return post ?? null;
}

/** 게시물 수정 작업본 시드용 게시본 + lifecycle 표지(한 조회). 작성자·관리자만. 휴지통·없음은 null. */
export async function getPostCollabSeed(postId: string) {
  const session = await requireAuth();
  const [post] = await createDb()
    .select({
      ...POST_SELECT,
      lifecycle: postLifecycleSql,
    })
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .limit(1);
  if (!post) return null;
  try {
    assertOwnerOrAdmin(session, post.authorId);
  } catch {
    return null;
  }
  return { ...post, lifecycle: Number(post.lifecycle) };
}

export async function getPostIncludingTrash(postId: string) {
  const session = await requireAuth();
  const [post] = await createDb()
    .select(POST_SELECT)
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(eq(posts.id, postId))
    .limit(1);
  if (!post) return null;
  if (post.deletedAt) assertOwnerOrAdmin(session, post.authorId);
  return post;
}

export async function getTrashedPosts() {
  const session = await requireAuth();
  const isAdmin = session.user.role === "admin";
  const rows = await createDb()
    .select(POST_SELECT)
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(
      isAdmin
        ? isNotNull(posts.deletedAt)
        : and(eq(posts.authorId, session.user.id!), isNotNull(posts.deletedAt)),
    )
    .orderBy(desc(posts.deletedAt));
  return rows.map((post) => ({
    ...post,
    purgeEligibleAt: post.deletedAt
      ? new Date(post.deletedAt.getTime() + POST_TRASH_RETENTION_SECONDS * 1000)
      : null,
  }));
}

export async function getPostRevisions(postId: string) {
  const session = await requireAuth();
  const post = await getPostIncludingTrash(postId);
  if (!post) return [];
  assertOwnerOrAdmin(session, post.authorId);
  return createDb()
    .select({
      id: postRevisions.id,
      revisionNumber: postRevisions.revisionNumber,
      changeType: postRevisions.changeType,
      category: postRevisions.category,
      boardType: postRevisions.boardType,
      isPinned: postRevisions.isPinned,
      mediaUrl: postRevisions.mediaUrl,
      mediaObjectId: postRevisions.mediaObjectId,
      title: postRevisions.title,
      contentHtml: postRevisions.contentHtml,
      restoredFromRevision: postRevisions.restoredFromRevision,
      actorId: postRevisions.actorId,
      actorName: profiles.displayName,
      createdAt: postRevisions.createdAt,
    })
    .from(postRevisions)
    .leftJoin(profiles, eq(postRevisions.actorId, profiles.id))
    .where(eq(postRevisions.postId, postId))
    .orderBy(desc(postRevisions.revisionNumber));
}

export type CreatePostState = {
  error?: string;
  success?: boolean;
  postId?: string;
  currentRevision?: number;
  operationConflict?: boolean;
  conflictedOperationId?: string;
  existingId?: string;
};

export async function createPost(
  _prev: CreatePostState,
  formData: FormData,
): Promise<CreatePostState> {
  const session = await requireAuth();
  const authorId = session.user.id!;
  const title = String(formData.get("title") ?? "").trim();
  const rawHtml = String(formData.get("contentHtml") ?? "");
  const categoryInput = String(formData.get("category") ?? "").trim();
  const boardTypeInput = String(formData.get("boardType") ?? "GENERAL");
  const returnTo = String(formData.get("returnTo") ?? "") || null;
  if (!VALID_BOARD_TYPES.includes(boardTypeInput as BoardType)) {
    return { error: "올바른 게시판 유형을 선택해 주세요." };
  }
  const boardType = boardTypeInput as BoardType;
  if (!title || isRichTextEmpty(rawHtml)) return { error: "제목과 내용은 필수입니다." };
  if (title.length > POST_MAX_TITLE_LENGTH) {
    return { error: `제목은 ${POST_MAX_TITLE_LENGTH}자 이하로 입력해 주세요.` };
  }
  const contentHtml = sanitizeHtml(rawHtml);
  if (isRichTextEmpty(contentHtml)) return { error: "유효한 내용을 입력해 주세요." };
  if (!isPostContentWithinLimit(contentHtml)) {
    return { error: `게시물 본문은 ${POST_MAX_CONTENT_LABEL} 이하로 저장할 수 있습니다.` };
  }
  if (boardType === "ANNOUNCEMENT" && session.user.role !== "admin") {
    return { error: "공지 작성은 Stann만 가능합니다." };
  }
  const operationId = resolveCreationOperationId(formData.get(CREATION_OPERATION_FIELD));
  if (!operationId) {
    return { error: "문서 생성 식별자가 올바르지 않습니다. 페이지를 새로고침해 주세요." };
  }

  let category = boardType.toLowerCase();
  if (boardType === "GENERAL") {
    const [existingCategory] = await createDb()
      .select({ slug: categories.slug })
      .from(categories)
      .where(eq(categories.slug, categoryInput))
      .limit(1);
    if (!existingCategory) return { error: "존재하는 커뮤니티 채널을 선택해 주세요." };
    category = existingCategory.slug;
  }
  const isPinnedRaw = formData.get("isPinned");
  const isPinned =
    boardType === "ANNOUNCEMENT" &&
    (isPinnedRaw === "on" || isPinnedRaw === "true");
  const postId = deriveCreationResourceId(
    operationId,
    JSON.stringify(["community-post", authorId]),
  );
  const rawMediaObjectId = String(formData.get("mediaObjectId") ?? "").trim();
  const submittedLegacyUrl = String(formData.get("mediaUrl") ?? "").trim();
  const rawLinkUrl = formData.get(MIXSET_LINK_FIELD);
  const submittedLinkUrl = typeof rawLinkUrl === "string" ? rawLinkUrl.trim() : "";
  if (boardType !== "FEEDBACK" && (rawMediaObjectId || submittedLegacyUrl || submittedLinkUrl)) {
    return { error: "믹스셋 게시물에서만 오디오나 링크를 첨부할 수 있습니다." };
  }
  if (submittedLinkUrl && (rawMediaObjectId || submittedLegacyUrl)) {
    return { error: "오디오 파일과 링크 중 하나만 첨부할 수 있습니다." };
  }
  let linkUrl: string | null = null;
  if (submittedLinkUrl) {
    const normalized = normalizeMixsetLinkUrl(submittedLinkUrl);
    if (!normalized.ok) return { error: normalized.error };
    linkUrl = normalized.url;
  }

  const mediaObjectId = rawMediaObjectId
    ? parseMediaUuidV4(rawMediaObjectId)
    : null;
  if (rawMediaObjectId && !mediaObjectId) {
    return { error: "첨부 오디오 식별자가 올바르지 않습니다. 다시 업로드해 주세요." };
  }

  const context = createDbContext();
  const postActor = actor(session);
  let mediaUrl: string | null = linkUrl;
  if (submittedLegacyUrl && !mediaObjectId) {
    const isExactLegacyReplay = await preflightLegacyPostCreateReplay(context, {
      actor: postActor,
      postId,
      operationId,
      snapshot: {
        category,
        boardType,
        isPinned,
        mediaUrl: submittedLegacyUrl,
        mediaObjectId: null,
        title,
        contentHtml,
      },
    });
    if (!isExactLegacyReplay) {
      return { error: "이전 방식의 업로드는 소유권을 확인할 수 없습니다. 파일을 다시 업로드해 주세요." };
    }
    mediaUrl = submittedLegacyUrl;
  } else if (mediaObjectId) {
    const media = await findOwnedMediaObject(context, authorId, mediaObjectId);
    const historicalAttachment =
      media?.resourceType === "COMMUNITY_POST" && media.resourceId === postId;
    if (
      !media ||
      media.purpose !== "COMMUNITY_POST_AUDIO" ||
      media.draftOperationId !== operationId ||
      (media.state !== "READY" && !historicalAttachment)
    ) {
      return { error: "첨부 오디오의 소유권이나 업로드 상태를 확인할 수 없습니다." };
    }
    mediaUrl = mediaDeliveryPath(mediaObjectId);
  }

  const result = await createPostAtomically(context, {
    actor: postActor,
    postId,
    operationId,
    snapshot: {
      category,
      boardType,
      isPinned,
      mediaUrl,
      mediaObjectId,
      title,
      contentHtml,
    },
    now: new Date(),
  });
  if (!result.ok) {
    if (result.reason === "OPERATION_PAYLOAD_CONFLICT") {
      return {
        error: "이 초안은 다른 내용으로 이미 게시되었습니다. 기존 게시물을 열거나 별도 게시물로 분리해 주세요.",
        operationConflict: true,
        conflictedOperationId: operationId,
        existingId: result.postId,
      };
    }
    return { error: lifecycleError(result.reason) };
  }

  if (!result.replayed) {
    // 공지는 학생에게, 그 밖의 커뮤니티 새 글은 글쓴이를 뺀 모든 계정에 알린다.
    await notifyPush(
      boardType === "ANNOUNCEMENT" ? { kind: "role", role: "student" } : { kind: "everyone" },
      boardType === "ANNOUNCEMENT"
        ? pushMessages.announcementPosted({ postId: result.postId, title })
        : pushMessages.communityPostCreated({ postId: result.postId, authorName: session.user.name ?? null, title }),
      { excludeProfileId: authorId },
    );
  }
  revalidatePostPaths(result.postId);
  if (returnTo === "student-portal" || returnTo === "community-editor") {
    return {
      success: true,
      postId: result.postId,
      currentRevision: result.currentRevision ?? undefined,
    };
  }
  redirect(`/community/${result.postId}`);
}

export type UpdatePostState = {
  error?: string;
  /** 수정 작업본 room이 비워진 뒤의 옛 저장이라 반영하지 않았다. */
  collabStale?: boolean;
  success?: boolean;
  conflictKind?: PostMutationFailureReason;
  currentRevision?: number;
  replayed?: boolean;
  post?: { id: string; title: string; contentHtml: string; version: number; mediaUrl?: string | null };
  conflictPost?: { id: string; title: string; contentHtml: string; version: number; mediaUrl?: string | null };
};

export async function updatePostContent(
  postId: string,
  _prev: UpdatePostState,
  formData: FormData,
): Promise<UpdatePostState> {
  const session = await requireAuth();
  const [existing] = await createDb()
    .select({
      id: posts.id,
      authorId: posts.authorId,
      title: posts.title,
      contentHtml: posts.contentHtml,
      version: posts.version,
      deletedAt: posts.deletedAt,
      boardType: posts.boardType,
      mediaUrl: posts.mediaUrl,
      mediaObjectId: posts.mediaObjectId,
    })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!existing) return { error: "게시물을 찾을 수 없습니다." };
  assertOwnerOrAdmin(session, existing.authorId);
  if (existing.deletedAt) return { error: "휴지통 게시물은 수정할 수 없습니다." };
  const collab = parseCollabSaveEpoch(formData);
  if (!collab.ok) return { error: STALE_COLLAB_SAVE_MESSAGE, collabStale: true };
  // 아래 기준본 대조가 VERSION_CONFLICT를 내기 전에, 복원 뒤 옛 generation 저장은 재시도 없는 COLLAB_STALE로 끝낸다.
  // 최종 판정은 원자 쓰기 조건이 한다.
  if (
    collab.collabEpoch !== undefined &&
    (await readPostLifecycleMarker(createDbContext(), existing.id)) !== collab.collabEpoch
  ) {
    return {
      error: lifecycleError("COLLAB_STALE"),
      collabStale: true,
      conflictKind: "COLLAB_STALE",
      currentRevision: existing.version,
    };
  }

  const operationId = resolveCreationOperationId(formData.get(CREATION_OPERATION_FIELD));
  const baseRevision = parsePostRevision(formData.get(POST_BASE_REVISION_FIELD));
  if (!operationId || !baseRevision) {
    return { error: "저장 작업 정보를 확인할 수 없습니다. 페이지를 새로고침해 주세요." };
  }
  const baseFingerprint = formData.get(DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD);
  if (!isDocumentSnapshotFingerprint(baseFingerprint)) {
    return { error: "편집 기준 정보를 확인할 수 없습니다. 페이지를 새로고침해 주세요." };
  }
  if (
    baseRevision === existing.version &&
    baseFingerprint !==
      createDocumentSnapshotFingerprint({
        kind: "community-post",
        id: existing.id,
        title: existing.title,
        contentHtml: existing.contentHtml,
        noteDate: null,
      })
  ) {
    return {
      error: "다른 기준본에서 시작한 초안입니다. 서버 최신본과 현재 초안 중 하나를 선택해 주세요.",
      conflictKind: "VERSION_CONFLICT",
      currentRevision: existing.version,
      conflictPost: {
        id: existing.id,
        title: existing.title,
        contentHtml: existing.contentHtml,
        version: existing.version,
        mediaUrl: existing.mediaUrl,
      },
    };
  }

  const title = String(formData.get("title") ?? "").trim();
  const rawHtml = String(formData.get("contentHtml") ?? "");
  if (!title || isRichTextEmpty(rawHtml)) return { error: "제목과 내용은 필수입니다." };
  if (title.length > POST_MAX_TITLE_LENGTH) {
    return { error: `제목은 ${POST_MAX_TITLE_LENGTH}자 이하로 입력해 주세요.` };
  }
  const contentHtml = sanitizeHtml(rawHtml);
  if (isRichTextEmpty(contentHtml)) return { error: "유효한 게시물 내용을 입력해 주세요." };
  if (!isPostContentWithinLimit(contentHtml)) {
    return { error: `게시물 본문은 ${POST_MAX_CONTENT_LABEL} 이하로 저장할 수 있습니다.` };
  }
  // 링크 칸은 링크 믹스셋 게시물의 수정 form에만 있다. 칸이 없으면 매체를 바꾸지 않는다.
  let mediaLinkUrl: string | undefined;
  if (formData.has(MIXSET_LINK_FIELD)) {
    if (existing.boardType !== "FEEDBACK" || existing.mediaObjectId || !isMixsetLinkUrl(existing.mediaUrl)) {
      return { error: "링크로 올린 믹스셋 게시물에서만 링크를 바꿀 수 있습니다." };
    }
    const normalized = normalizeMixsetLinkUrl(formData.get(MIXSET_LINK_FIELD));
    if (!normalized.ok) return { error: normalized.error };
    mediaLinkUrl = normalized.url;
  }

  const result = await updatePostAtomically(createDbContext(), {
    actor: actor(session),
    postId,
    operationId,
    baseRevision,
    title,
    contentHtml,
    ...(mediaLinkUrl === undefined ? {} : { mediaLinkUrl }),
    ...(collab.collabEpoch === undefined ? {} : { collabEpoch: collab.collabEpoch }),
    now: new Date(),
  });
  if (!result.ok && result.reason === "COLLAB_STALE") {
    return {
      error: lifecycleError("COLLAB_STALE"),
      collabStale: true,
      conflictKind: "COLLAB_STALE",
      currentRevision: result.currentRevision,
    };
  }
  if (!result.ok) {
    let conflictPost: UpdatePostState["conflictPost"];
    if (result.reason === "VERSION_CONFLICT") {
      [conflictPost] = await createDb()
        .select({ id: posts.id, title: posts.title, contentHtml: posts.contentHtml, version: posts.version, mediaUrl: posts.mediaUrl })
        .from(posts)
        .where(and(
          eq(posts.id, postId),
          isNull(posts.deletedAt),
          session.user.role === "admin" ? undefined : eq(posts.authorId, session.user.id),
        ))
        .limit(1);
    }
    return {
      error: lifecycleError(result.reason),
      conflictKind: result.reason,
      currentRevision: result.currentRevision,
      conflictPost,
    };
  }
  revalidatePostPaths(postId);
  return {
    success: true,
    currentRevision: result.currentRevision ?? undefined,
    replayed: result.replayed,
    post: {
      id: postId,
      title,
      contentHtml,
      version: result.currentRevision ?? baseRevision,
      mediaUrl: mediaLinkUrl ?? existing.mediaUrl,
    },
  };
}

export type PostLifecycleState = {
  success: boolean;
  error?: string;
  conflictKind?: PostMutationFailureReason;
  currentRevision?: number;
  purged?: boolean;
};

function lifecycleState(result: PostMutationResult): PostLifecycleState {
  return result.ok
    ? {
        success: true,
        currentRevision: result.currentRevision ?? undefined,
        purged: result.resourceState === "PURGED",
      }
    : {
        success: false,
        error: lifecycleError(result.reason),
        conflictKind: result.reason,
        currentRevision: result.currentRevision,
      };
}

async function runPostLifecycle(
  kind: "trash" | "restore" | "purge",
  postId: string,
  operationId: string,
  baseRevision: number,
): Promise<PostLifecycleState> {
  const session = await requireAuth();
  const write = {
    actor: actor(session),
    postId,
    operationId,
    baseRevision,
    now: new Date(),
  };
  const result =
    kind === "trash"
      ? await trashPostAtomically(createDbContext(), write)
      : kind === "restore"
        ? await restoreTrashedPostAtomically(createDbContext(), write)
        : await purgePostAtomically(createDbContext(), write);
  if (result.ok) {
    // 휴지통 이동은 게시본을 바꾸지 않으므로 수정 작업본을 남긴 채 연결만 닫는다(복구하면 이어진다). 영구 삭제는 비운다.
    const roomKey = formatCollabDocKey({ kind: "post", id: postId });
    if (kind === "trash") await closeCollabRoomAfterMutation(roomKey, true);
    if (kind === "purge") await closeCollabRoomAfterMutation(roomKey, false);
    revalidatePostPaths(postId);
    if (kind === "purge") {
      await processMediaDeletionOutboxBestEffort(createDbContext(), { limit: 2 });
    }
  }
  return lifecycleState(result);
}

export async function trashPost(postId: string, operationId: string, baseRevision: number) {
  return runPostLifecycle("trash", postId, operationId, baseRevision);
}

export async function restorePost(postId: string, operationId: string, baseRevision: number) {
  return runPostLifecycle("restore", postId, operationId, baseRevision);
}

export async function purgePost(postId: string, operationId: string, baseRevision: number) {
  return runPostLifecycle("purge", postId, operationId, baseRevision);
}

/**
 * 휴지통 이동 뒤 목록으로 이동한다. 실패는 throw 대신 상태로 돌려
 * production에서도 화면이 서버의 한국어 안내를 그대로 보여 줄 수 있게 한다.
 */
export async function deletePost(
  postId: string,
  operationId: string,
  baseRevision: number,
  returnTo = "/community",
): Promise<PostLifecycleState> {
  const result = await trashPost(postId, operationId, baseRevision);
  if (!result.success) {
    return { ...result, error: result.error ?? "게시물을 휴지통으로 이동하지 못했습니다." };
  }
  redirect(safeReturnPath(returnTo, "/community"));
}

export async function restorePostRevision(
  postId: string,
  operationId: string,
  baseRevision: number,
  revisionNumber: number,
): Promise<PostLifecycleState> {
  const session = await requireAuth();
  const roomKey = formatCollabDocKey({ kind: "post", id: postId });
  const [before] = await createDb()
    .select({ ...POST_SELECT })
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(eq(posts.id, postId))
    .limit(1);
  // 쓸 수 있는 사람의 요청만 room에 복원 준비를 남긴다(권한 없는 요청이 다른 복원을 막지 못하게).
  const mayRestore = Boolean(before && !before.deletedAt && (session.user.role === "admin" || before.authorId === session.user.id));
  if (mayRestore && before) {
    // 수정 작업본(room)은 게시하지 않은 편집을 담는다. 준비 시점에 게시본과 다르면 되돌리지 않는다(작업본을 게시로 잇지 않는다).
    // 준비 뒤 들어온 입력은 복원 뒤에도 작업본에 그대로 남는다. 편집은 막지 않는다.
    const prepared = await beginCollabRestore(roomKey, operationId);
    if (prepared.kind === "busy" || prepared.kind === "failed") {
      await abortCollabRestore(roomKey, operationId);
      return {
        success: false,
        error: prepared.kind === "busy" ? "다른 화면에서 이미 되돌리는 중입니다. 잠시 뒤 다시 시도해 주세요." : "열린 수정 화면을 확인하지 못해 되돌리지 않았습니다. 잠시 뒤 다시 시도해 주세요.",
      };
    }
    if (prepared.kind === "ready" && prepared.content && isPostWorkingCopyDirty(prepared.content, before)) {
      await abortCollabRestore(roomKey, operationId);
      return {
        success: false,
        error: "수정 화면에 아직 게시하지 않은 변경이 있어 되돌리지 않았습니다. 그 변경을 게시한 뒤 다시 시도해 주세요.",
      };
    }
  }
  const result = await restorePostRevisionAtomically(createDbContext(), {
    actor: actor(session),
    postId,
    operationId,
    baseRevision,
    revisionNumber,
    now: new Date(),
  });
  if (result.ok) {
    // 복원 revision이 새 lifecycle 표지다. 열린 수정 작업본에는 복원한 게시본을 같은 문서의 한 편집으로 적용한다(다시 시작하지 않음).
    const restoredRevision = result.operationResultRevision ?? result.currentRevision;
    const head = typeof restoredRevision === "number" ? await readPostRestoreTarget(postId) : null;
    if (typeof restoredRevision === "number" && head) await applyCollabRestore(roomKey, operationId, restoredRevision, head);
    else if (mayRestore) await abortCollabRestore(roomKey, operationId);
    revalidatePostPaths(postId);
  } else if (mayRestore) {
    await abortCollabRestore(roomKey, operationId);
  }
  return lifecycleState(result);
}

/** 작업본(제목·링크·본문)이 게시본과 다른지. 링크 칸은 작업본에 있을 때만 비교한다. */
function isPostWorkingCopyDirty(content: { html: string; fields: Record<string, string | number | null> }, head: PostHeadRow): boolean {
  const withLink = "mixsetLinkUrl" in content.fields;
  const expected = postRoomFields(head, withLink);
  for (const [name, value] of Object.entries(expected)) if ((content.fields[name] ?? "") !== value) return true;
  return content.html !== canonicalServerHtml(head.contentHtml);
}

export async function togglePinPost(
  postId: string,
  nextPinned: boolean,
  operationId: string,
  baseRevision: number,
): Promise<PostLifecycleState> {
  const session = await requireAuth();
  const result = await setPostPinAtomically(createDbContext(), {
    actor: actor(session),
    postId,
    operationId,
    baseRevision,
    isPinned: nextPinned,
    now: new Date(),
  });
  if (result.ok) revalidatePostPaths(postId);
  return lifecycleState(result);
}
