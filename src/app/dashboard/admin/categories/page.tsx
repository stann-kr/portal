/**
 * @file src/app/dashboard/admin/categories/page.tsx
 * @description Admin 전용 커뮤니티 카테고리 관리 페이지 (목록 및 추가)
 */
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
    <div className="max-w-4xl mx-auto space-y-10 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          Categories
          <span className="text-muted-foreground font-normal">/ Admin</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          커뮤니티 게시판의 카테고리를 동적으로 관리합니다.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-6">
          <div className="p-6 rounded-xl border border-border bg-card shadow-sm">
            <h2 className="text-lg font-semibold tracking-tight mb-4">새 카테고리 추가</h2>
            <CategoryForm />
          </div>
        </div>

        <div className="md:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">등록된 카테고리</h2>
          {categoriesList.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground border border-dashed rounded-lg bg-muted/10">
              <p className="text-sm">등록된 카테고리가 없습니다.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {categoriesList.map((cat: Category) => (
                <li key={cat.id} className="p-4 rounded-lg border border-border bg-card shadow-sm flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground flex items-center gap-2">
                      {cat.name}
                      <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground uppercase tracking-widest font-bold">
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
