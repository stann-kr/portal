/**
 * @file src/app/dashboard/admin/categories/page.tsx
 * @description Admin 전용 커뮤니티 카테고리 관리 페이지 (목록 및 추가)
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { getCategories } from "@/lib/actions/categories";
import { CategoryForm } from "./CategoryForm";
import { DeleteCategoryButton } from "./DeleteCategoryButton";

type Category = Awaited<ReturnType<typeof getCategories>>[number];

export default async function AdminCategoriesPage() {
  const session = await getActiveAuthSession();
  if (session?.user?.role !== "admin") {
    redirect("/dashboard/student");
  }

  const categoriesList = await getCategories();

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-6 sm:px-6">
      <header className="space-y-3 border-b border-border pb-5">
        <Link
          href="/dashboard/admin?section=community"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          커뮤니티 관리로 돌아가기
        </Link>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">커뮤니티 채널</h1>
          <p className="text-sm text-muted-foreground">
            자유 게시판의 채널을 추가하거나 비어 있는 채널을 정리합니다.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-6">
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-lg font-semibold tracking-tight mb-4">새 채널 추가</h2>
            <CategoryForm />
          </div>
        </div>

        <div className="md:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">등록된 채널</h2>
          {categoriesList.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground border border-dashed rounded-lg bg-muted/10">
              <p className="text-sm">등록된 채널이 없습니다. 자유 게시판에 글을 쓰려면 채널이 하나 이상 필요합니다.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {categoriesList.map((cat: Category) => (
                <li key={cat.id} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-4">
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground flex items-center gap-2">
                      {cat.name}
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {cat.slug}
                      </span>
                    </p>
                    {cat.description && (
                      <p className="text-sm text-muted-foreground">{cat.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">정렬 우선순위: {cat.sortOrder}</p>
                  </div>
                  <DeleteCategoryButton categoryId={cat.id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
