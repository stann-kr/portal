/**
 * @file src/lib/actions/categories.ts
 * @description 커뮤니티 카테고리 관리를 위한 서버 액션 (Admin 전용)
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { categories, posts } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireAdmin, requireAuth } from "@/lib/auth-guard";

export async function getCategories() {
  await requireAuth();
  const db = createDb();
  return db.select().from(categories).orderBy(asc(categories.sortOrder));
}

export type CategoryState = { error?: string; success?: boolean };

export async function createCategory(_prev: CategoryState, formData: FormData): Promise<CategoryState> {
  await requireAdmin();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const sortOrder = parseInt((formData.get("sortOrder") as string) || "0", 10);

  if (!slug || !name) return { error: "Slug와 Name은 필수입니다." };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    return { error: "Slug는 영문 소문자, 숫자와 하이픈만 사용할 수 있습니다." };
  }
  if (!Number.isSafeInteger(sortOrder)) return { error: "정렬 순서를 확인해 주세요." };

  const db = createDb();
  const id = crypto.randomUUID();

  try {
    await db.insert(categories).values({
      id,
      slug,
      name,
      description,
      sortOrder,
    });
    revalidatePath("/dashboard/admin/categories");
    revalidatePath("/community");
    return { success: true };
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      return { error: "이미 존재하는 Slug입니다." };
    }
    return { error: "카테고리 생성 중 오류가 발생했습니다." };
  }
}

export async function deleteCategory(id: string): Promise<CategoryState> {
  await requireAdmin();
  const db = createDb();
  try {
    const [category] = await db
      .select({ slug: categories.slug })
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);
    if (!category) return { error: "카테고리를 찾을 수 없습니다." };

    const [linkedPost] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.category, category.slug))
      .limit(1);
    if (linkedPost) {
      return { error: "게시물이 있는 카테고리는 삭제할 수 없습니다." };
    }

    await db.delete(categories).where(eq(categories.id, id));
    revalidatePath("/dashboard/admin/categories");
    revalidatePath("/community");
    return { success: true };
  } catch {
    return { error: "카테고리를 삭제하지 못했습니다. 다시 시도해 주세요." };
  }
}
