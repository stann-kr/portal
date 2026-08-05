/**
 * @file src/lib/actions/posts.ts
 * @description 커뮤니티 게시물 CRUD 서버 액션.
 * Phase 3: boardType(ANNOUNCEMENT/GENERAL/FEEDBACK) 기반 조회/생성 추가.
 * 작성: 모든 인증 사용자 (ANNOUNCEMENT는 Admin 전용).
 * 수정/삭제: 본인 글 또는 Admin.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDb } from "@/db/client";
import { categories, posts, profiles } from "@/db/schema";
import type { BoardType } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { requireAuth, assertOwnerOrAdmin } from "@/lib/auth-guard";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { isRichTextEmpty } from "@/lib/rich-text";
import { safeReturnPath } from "@/lib/safe-return-path";
import {
  CREATION_OPERATION_FIELD,
  deriveCreationResourceId,
  resolveCreationOperationId,
} from "@/lib/creation-operation";
import {
  createDocumentSnapshotFingerprint,
  DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD,
  isDocumentSnapshotFingerprint,
} from "@/lib/document-snapshot-fingerprint";

const VALID_BOARD_TYPES: readonly BoardType[] = ["ANNOUNCEMENT", "GENERAL", "FEEDBACK"];

// ─── 공통 select 필드 ──────────────────────────

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
  authorName: profiles.displayName,
  authorEmail: profiles.email,
} as const;

// ─── 조회 ────────────────────────────────────────

/**
 * boardType별 게시물 목록 조회 (최신순, isPinned 우선).
 */
export async function getPostsByBoardType(boardType: BoardType) {
  await requireAuth();
  const db = createDb();
  return db
    .select(POST_SELECT)
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(eq(posts.boardType, boardType))
    .orderBy(desc(posts.isPinned), desc(posts.createdAt));
}

/**
 * 카테고리별 GENERAL 게시물 목록 조회 (기존 호환성 유지).
 */
export async function getPostsByCategory(category: string) {
  await requireAuth();
  const db = createDb();
  return db
    .select(POST_SELECT)
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(and(eq(posts.category, category), eq(posts.boardType, "GENERAL")))
    .orderBy(desc(posts.createdAt));
}

/**
 * 게시물 단건 조회 (작성자 정보 포함).
 */
export async function getPostById(postId: string) {
  await requireAuth();
  const db = createDb();
  const rows = await db
    .select(POST_SELECT)
    .from(posts)
    .leftJoin(profiles, eq(posts.authorId, profiles.id))
    .where(eq(posts.id, postId))
    .limit(1);
  return rows[0] ?? null;
}

// ─── 생성 ────────────────────────────────────────

export type CreatePostState = {
  error?: string;
  success?: boolean;
  postId?: string;
  operationConflict?: boolean;
  conflictedOperationId?: string;
  existingId?: string;
};

/**
 * 게시물 작성.
 * - ANNOUNCEMENT 타입은 Admin만 작성 가능
 * - FEEDBACK 타입은 mediaUrl 포함 가능
 */
export async function createPost(
  _prev: CreatePostState,
  formData: FormData,
): Promise<CreatePostState> {
  const session = await requireAuth();
  const authorId = session.user.id!;

  const title = String(formData.get("title") ?? "").trim();
  const categoryInput = String(formData.get("category") ?? "").trim();
  const contentHtml = String(formData.get("contentHtml") ?? "");
  const boardTypeInput = String(formData.get("boardType") ?? "GENERAL");
  if (!VALID_BOARD_TYPES.includes(boardTypeInput as BoardType)) {
    return { error: "올바른 게시판 유형을 선택해 주세요." };
  }
  const boardType = boardTypeInput as BoardType;
  const mediaUrl = String(formData.get("mediaUrl") ?? "").trim() || null;
  const isPinnedRaw = formData.get("isPinned");
  const isPinned = isPinnedRaw === "on" || isPinnedRaw === "true";
  const returnTo = (formData.get("returnTo") as string) || null;

  if (!title) return { error: "제목을 입력해주세요." };
  if (isRichTextEmpty(contentHtml))
    return { error: "내용을 입력해주세요." };

  const sanitizedContentHtml = sanitizeHtml(contentHtml);
  if (isRichTextEmpty(sanitizedContentHtml))
    return { error: "내용을 입력해주세요." };

  // ANNOUNCEMENT 권한 체크
  if (boardType === "ANNOUNCEMENT" && session.user.role !== "admin") {
    return { error: "공지 작성은 관리자만 가능합니다." };
  }

  const operationId = resolveCreationOperationId(
    formData.get(CREATION_OPERATION_FIELD),
  );
  if (!operationId) {
    return { error: "문서 생성 식별자가 올바르지 않습니다. 페이지를 새로고침해 주세요." };
  }
  const id = deriveCreationResourceId(
    operationId,
    JSON.stringify(["community-post", authorId]),
  );

  const db = createDb();
  let category = boardType.toLowerCase();
  if (boardType === "GENERAL") category = categoryInput;
  const storedPinned = boardType === "ANNOUNCEMENT" ? isPinned : false;
  const storedMediaUrl = boardType === "FEEDBACK" ? mediaUrl : null;
  const findExisting = async () => {
    const [existing] = await db
      .select({
        id: posts.id,
        authorId: posts.authorId,
        category: posts.category,
        boardType: posts.boardType,
        isPinned: posts.isPinned,
        mediaUrl: posts.mediaUrl,
        title: posts.title,
        contentHtml: posts.contentHtml,
      })
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);
    return existing ?? null;
  };
  const isSameSubmission = (existing: Awaited<ReturnType<typeof findExisting>>) =>
    Boolean(
      existing &&
      existing.authorId === authorId &&
      existing.category === category &&
      existing.boardType === boardType &&
      existing.isPinned === storedPinned &&
      existing.mediaUrl === storedMediaUrl &&
      existing.title === title &&
      existing.contentHtml === sanitizedContentHtml,
    );
  const operationConflict = (existingId: string): CreatePostState => ({
    error: "이 초안은 다른 내용으로 이미 게시되었습니다. 기존 게시물을 열거나 별도 게시물로 분리해 주세요.",
    operationConflict: true,
    conflictedOperationId: operationId,
    existingId,
  });

  let existingBeforeInsert: Awaited<ReturnType<typeof findExisting>>;
  try {
    existingBeforeInsert = await findExisting();
  } catch {
    return { error: "게시물을 저장하지 못했습니다. 다시 시도해 주세요." };
  }
  if (existingBeforeInsert) {
    if (!isSameSubmission(existingBeforeInsert)) {
      return existingBeforeInsert.authorId === authorId
        ? operationConflict(existingBeforeInsert.id)
        : { error: "게시물을 저장하지 못했습니다. 다시 시도해 주세요." };
    }

    revalidatePath("/community");
    if (returnTo === "student-portal" || returnTo === "community-editor") {
      if (returnTo === "student-portal") revalidatePath("/dashboard/student");
      return { success: true, postId: id };
    }
    redirect(`/community/${id}`);
  }

  try {
    if (boardType === "GENERAL") {
      const [existingCategory] = await db
        .select({ slug: categories.slug })
        .from(categories)
        .where(eq(categories.slug, categoryInput))
        .limit(1);
      if (!existingCategory) return { error: "존재하는 커뮤니티 채널을 선택해 주세요." };
      category = existingCategory.slug;
    }

    await db.insert(posts).values({
      id,
      authorId,
      category,
      boardType,
      isPinned: storedPinned,
      mediaUrl: storedMediaUrl,
      title,
      contentHtml: sanitizedContentHtml,
    });
  } catch {
    try {
      const existing = await findExisting();
      if (!isSameSubmission(existing)) {
        return existing?.authorId === authorId
          ? operationConflict(existing.id)
          : { error: "게시물을 저장하지 못했습니다. 다시 시도해 주세요." };
      }
    } catch {
      return { error: "게시물을 저장하지 못했습니다. 다시 시도해 주세요." };
    }
  }

  revalidatePath("/community");
  if (returnTo === "student-portal") {
    revalidatePath("/dashboard/student");
    return { success: true, postId: id };
  }
  if (returnTo === "community-editor") {
    return { success: true, postId: id };
  }
  redirect(`/community/${id}`);
}

export type UpdatePostState = {
  error?: string;
  success?: boolean;
  post?: { id: string; title: string; contentHtml: string };
};

/** 게시물 제목과 본문을 작성자 또는 관리자가 충돌 감지와 함께 수정한다. */
export async function updatePostContent(
  postId: string,
  _prev: UpdatePostState,
  formData: FormData,
): Promise<UpdatePostState> {
  const session = await requireAuth();
  const db = createDb();
  const [existing] = await db
    .select({
      id: posts.id,
      authorId: posts.authorId,
      title: posts.title,
      contentHtml: posts.contentHtml,
    })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);

  if (!existing) return { error: "게시물을 찾을 수 없습니다." };
  assertOwnerOrAdmin(session, existing.authorId);

  const baseFingerprint = formData.get(DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD);
  if (!isDocumentSnapshotFingerprint(baseFingerprint)) {
    return { error: "편집 기준 정보를 확인할 수 없습니다. 페이지를 새로고침해 주세요." };
  }

  const title = String(formData.get("title") ?? "").trim();
  const rawHtml = String(formData.get("contentHtml") ?? "");
  if (!title || isRichTextEmpty(rawHtml)) return { error: "제목과 내용은 필수입니다." };

  const contentHtml = sanitizeHtml(rawHtml);
  if (isRichTextEmpty(contentHtml)) return { error: "유효한 게시물 내용을 입력해 주세요." };

  const alreadyCurrent =
    existing.title === title && existing.contentHtml === contentHtml;

  if (!alreadyCurrent) {
    const observedFingerprint = createDocumentSnapshotFingerprint({
      kind: "community-post",
      id: existing.id,
      title: existing.title,
      contentHtml: existing.contentHtml,
      noteDate: null,
    });
    if (baseFingerprint !== observedFingerprint) {
      return {
        error: "다른 화면에서 이 게시물이 먼저 변경되었습니다. 현재 내용은 임시 저장되어 있으며, 새로고침 후 서버 최신본과 초안 중 선택할 수 있습니다.",
      };
    }

    let updated: { id: string }[];
    try {
      updated = await db
        .update(posts)
        .set({ title, contentHtml })
        .where(and(
          eq(posts.id, postId),
          eq(posts.authorId, existing.authorId),
          eq(posts.title, existing.title),
          eq(posts.contentHtml, existing.contentHtml),
        ))
        .returning({ id: posts.id });
    } catch {
      return { error: "게시물을 저장하지 못했습니다. 다시 시도해 주세요." };
    }
    if (updated.length === 0) {
      let current: {
        authorId: string;
        title: string;
        contentHtml: string;
      } | undefined;
      try {
        [current] = await db
          .select({
            authorId: posts.authorId,
            title: posts.title,
            contentHtml: posts.contentHtml,
          })
          .from(posts)
          .where(eq(posts.id, postId))
          .limit(1);
      } catch {
        return { error: "게시물을 저장하지 못했습니다. 다시 시도해 주세요." };
      }
      if (current) assertOwnerOrAdmin(session, current.authorId);
      const converged =
        current?.title === title && current.contentHtml === contentHtml;
      if (!converged) {
        return {
          error: "다른 화면에서 이 게시물이 먼저 변경되었습니다. 현재 내용은 임시 저장되어 있으며, 새로고침 후 서버 최신본과 초안 중 선택할 수 있습니다.",
        };
      }
    }
  }

  revalidatePath(`/community/${postId}`);
  revalidatePath("/community");
  revalidatePath("/dashboard/student");
  revalidatePath("/dashboard/admin");
  return { success: true, post: { id: postId, title, contentHtml } };
}

// ─── 삭제 ────────────────────────────────────────

/**
 * 게시물 삭제 (본인 글 또는 Admin).
 */
export async function deletePost(postId: string, returnTo = "/community") {
  const session = await requireAuth();
  const db = createDb();

  const rows = await db
    .select({ authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);

  const post = rows[0];
  if (!post) {
    throw new Error("Not found");
  }

  assertOwnerOrAdmin(session, post.authorId);

  await db.delete(posts).where(eq(posts.id, postId));
  revalidatePath("/community");
  redirect(safeReturnPath(returnTo, "/community"));
}

/**
 * 공지 고정 토글 (Admin 전용).
 */
export async function togglePinPost(postId: string, currentPinned: boolean) {
  const session = await requireAuth();
  if (session.user.role !== "admin") throw new Error("Unauthorized");

  const db = createDb();
  await db
    .update(posts)
    .set({ isPinned: !currentPinned })
    .where(eq(posts.id, postId));

  revalidatePath("/community");
}
