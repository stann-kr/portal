/** Community post query와 revision/trash lifecycle server action. */
"use server";

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDb, createDbContext } from "@/db/client";
import { categories, postRevisions, posts, profiles, type BoardType } from "@/db/schema";
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
  purgePostAtomically,
  restorePostRevisionAtomically,
  restoreTrashedPostAtomically,
  setPostPinAtomically,
  trashPostAtomically,
  updatePostAtomically,
  type PostMutationFailureReason,
  type PostMutationResult,
} from "@/lib/post-atomic";
import {
  POST_BASE_REVISION_FIELD,
  POST_MAX_CONTENT_LABEL,
  POST_MAX_TITLE_LENGTH,
  POST_RESTORE_REVISION_FIELD,
  POST_TRASH_RETENTION_SECONDS,
  isPostContentWithinLimit,
  parsePostRevision,
} from "@/lib/post-continuity";
import { isRichTextEmpty } from "@/lib/rich-text";
import { safeReturnPath } from "@/lib/safe-return-path";
import { sanitizeHtml } from "@/lib/sanitize-html";

const VALID_BOARD_TYPES: readonly BoardType[] = ["ANNOUNCEMENT", "GENERAL", "FEEDBACK"];

const POST_SELECT = {
  id: posts.id,
  authorId: posts.authorId,
  category: posts.category,
  boardType: posts.boardType,
  isPinned: posts.isPinned,
  mediaUrl: posts.mediaUrl,
  title: posts.title,
  contentHtml: posts.contentHtml,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
  version: posts.version,
  deletedAt: posts.deletedAt,
  authorName: profiles.displayName,
  authorEmail: profiles.email,
} as const;

function lifecycleError(reason: PostMutationFailureReason): string {
  switch (reason) {
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

export async function getPostsByBoardType(boardType: BoardType) {
  await requireAuth();
  return createDb()
    .select(POST_SELECT)
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(and(eq(posts.boardType, boardType), isNull(posts.deletedAt)))
    .orderBy(desc(posts.isPinned), desc(posts.createdAt));
}

export async function getPostsByCategory(category: string) {
  await requireAuth();
  return createDb()
    .select(POST_SELECT)
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(
      and(
        eq(posts.category, category),
        eq(posts.boardType, "GENERAL"),
        isNull(posts.deletedAt),
      ),
    )
    .orderBy(desc(posts.createdAt));
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
    return { error: "공지 작성은 관리자만 가능합니다." };
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
  const mediaUrl =
    boardType === "FEEDBACK"
      ? String(formData.get("mediaUrl") ?? "").trim() || null
      : null;
  const postId = deriveCreationResourceId(
    operationId,
    JSON.stringify(["community-post", authorId]),
  );
  const result = await createPostAtomically(createDbContext(), {
    actor: actor(session),
    postId,
    operationId,
    snapshot: { category, boardType, isPinned, mediaUrl, title, contentHtml },
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
  success?: boolean;
  conflictKind?: PostMutationFailureReason;
  currentRevision?: number;
  replayed?: boolean;
  post?: { id: string; title: string; contentHtml: string; version: number };
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
    })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!existing) return { error: "게시물을 찾을 수 없습니다." };
  assertOwnerOrAdmin(session, existing.authorId);
  if (existing.deletedAt) return { error: "휴지통 게시물은 수정할 수 없습니다." };

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

  const result = await updatePostAtomically(createDbContext(), {
    actor: actor(session),
    postId,
    operationId,
    baseRevision,
    title,
    contentHtml,
    now: new Date(),
  });
  if (!result.ok) {
    return {
      error: lifecycleError(result.reason),
      conflictKind: result.reason,
      currentRevision: result.currentRevision,
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
  if (result.ok) revalidatePostPaths(postId);
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

export async function deletePost(
  postId: string,
  operationId: string,
  baseRevision: number,
  returnTo = "/community",
) {
  const result = await trashPost(postId, operationId, baseRevision);
  if (!result.success) throw new Error(result.error ?? "게시물을 휴지통으로 이동하지 못했습니다.");
  redirect(safeReturnPath(returnTo, "/community"));
}

export async function restorePostRevision(
  postId: string,
  operationId: string,
  baseRevision: number,
  revisionNumber: number,
): Promise<PostLifecycleState> {
  const session = await requireAuth();
  const result = await restorePostRevisionAtomically(createDbContext(), {
    actor: actor(session),
    postId,
    operationId,
    baseRevision,
    revisionNumber,
    now: new Date(),
  });
  if (result.ok) revalidatePostPaths(postId);
  return lifecycleState(result);
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
