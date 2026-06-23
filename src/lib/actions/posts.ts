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
import { posts, profiles } from "@/db/schema";
import type { BoardType } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { requireAuth, assertOwnerOrAdmin } from "@/lib/auth-guard";
import { sanitizeHtml } from "@/lib/sanitize-html";

const VALID_CATEGORIES = [
  "gear-and-setup",
  "track-id",
  "terminal-info",
  "general",
] as const;
type Category =
  | "gear-and-setup"
  | "track-id"
  | "terminal-info"
  | "general";

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
export async function getPostsByCategory(category: Category) {
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

  const title = (formData.get("title") as string)?.trim();
  const categoryInput = (formData.get("category") as string) || "general";
  const category = VALID_CATEGORIES.includes(categoryInput as Category)
    ? categoryInput
    : "general";
  const contentHtml = formData.get("contentHtml") as string;
  const boardType = (formData.get("boardType") as BoardType) || "GENERAL";
  const mediaUrl = (formData.get("mediaUrl") as string) || null;
  const isPinnedRaw = formData.get("isPinned");
  const isPinned = isPinnedRaw === "on" || isPinnedRaw === "true";
  const returnTo = (formData.get("returnTo") as string) || null;

  if (!title) return { error: "제목을 입력해주세요." };
  if (!contentHtml || contentHtml === "<p></p>")
    return { error: "내용을 입력해주세요." };

  const sanitizedContentHtml = sanitizeHtml(contentHtml);

  // ANNOUNCEMENT 권한 체크
  if (boardType === "ANNOUNCEMENT" && session.user.role !== "admin") {
    return { error: "공지 작성은 관리자만 가능합니다." };
  }

  const db = createDb();
  const id = crypto.randomUUID();

  await db.insert(posts).values({
    id,
    authorId: session.user.id!,
    category: boardType === "GENERAL" ? category : boardType.toLowerCase(),
    boardType,
    isPinned: boardType === "ANNOUNCEMENT" ? isPinned : false,
    mediaUrl: boardType === "FEEDBACK" ? mediaUrl : null,
    title,
    contentHtml: sanitizedContentHtml,
  });

  revalidatePath("/community");
  if (returnTo === "student-portal") {
    revalidatePath("/dashboard/student");
    return { success: true, postId: id };
  }
  redirect(`/community/${id}`);
}

// ─── 삭제 ────────────────────────────────────────

/**
 * 게시물 삭제 (본인 글 또는 Admin).
 */
export async function deletePost(postId: string) {
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
  redirect("/community");
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
