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

function parseCategoryDetails(formData: FormData):
  | { ok: true; name: string; description: string; sortOrder: number }
  | { ok: false; error: string } {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const rawSortOrder = String(formData.get("sortOrder") ?? "").trim() || "0";
  const sortOrder = /^-?\d+$/u.test(rawSortOrder) ? Number(rawSortOrder) : Number.NaN;

  if (!name) return { ok: false, error: "채널 이름을 입력해 주세요." };
  if (name.length > 60 || description.length > 200) {
    return { ok: false, error: "이름은 60자, 설명은 200자까지 입력할 수 있습니다." };
  }
  if (!Number.isSafeInteger(sortOrder)) return { ok: false, error: "정렬 순서는 정수로 입력해 주세요." };
  return { ok: true, name, description, sortOrder };
}

export async function createCategory(_prev: CategoryState, formData: FormData): Promise<CategoryState> {
  await requireAdmin();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  if (!slug) return { error: "채널 이름과 주소 식별자를 입력해 주세요." };
  if (slug.length > 60) return { error: "주소 식별자는 60자까지 입력할 수 있습니다." };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    return { error: "Slug는 영문 소문자, 숫자와 하이픈만 사용할 수 있습니다." };
  }
  const details = parseCategoryDetails(formData);
  if (!details.ok) return { error: details.error };
  const { name, description, sortOrder } = details;

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
      return { error: "이미 사용 중인 주소 식별자입니다." };
    }
    return { error: "채널을 추가하지 못했습니다. 다시 시도해 주세요." };
  }
}

/**
 * 채널 이름·설명·정렬 순서 수정 (Admin 전용).
 * 게시물이 slug로 채널을 참조하므로 주소 식별자는 바꾸지 않는다.
 */
export async function updateCategory(
  id: string,
  _prev: CategoryState,
  formData: FormData,
): Promise<CategoryState> {
  await requireAdmin();
  const details = parseCategoryDetails(formData);
  if (!details.ok) return { error: details.error };

  try {
    const updated = await createDb()
      .update(categories)
      .set({ name: details.name, description: details.description, sortOrder: details.sortOrder })
      .where(eq(categories.id, id))
      .returning({ id: categories.id });
    if (updated.length === 0) return { error: "채널을 찾을 수 없습니다. 화면을 새로고침해 주세요." };
  } catch {
    return { error: "채널을 수정하지 못했습니다. 다시 시도해 주세요." };
  }
  revalidatePath("/dashboard/admin/categories");
  revalidatePath("/community");
  return { success: true };
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
    if (!category) return { error: "채널을 찾을 수 없습니다." };

    const [linkedPost] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.category, category.slug))
      .limit(1);
    if (linkedPost) {
      return { error: "게시물이 있는 채널은 삭제할 수 없습니다." };
    }

    await db.delete(categories).where(eq(categories.id, id));
    revalidatePath("/dashboard/admin/categories");
    revalidatePath("/community");
    return { success: true };
  } catch {
    return { error: "채널을 삭제하지 못했습니다. 다시 시도해 주세요." };
  }
}
