/**
 * @file src/app/dashboard/admin/categories/page.tsx
 * @description Admin 전용 커뮤니티 채널 관리 페이지(캔버스 AdminCategories 보드): 새 채널 추가와 등록된 채널 목록.
 */
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { getCategories } from "@/lib/actions/categories";
import { EmptyState } from "@/components/ui/empty-state";
import { CategoryForm } from "./CategoryForm";
import { CategoryListItem } from "./CategoryListItem";

type Category = Awaited<ReturnType<typeof getCategories>>[number];

export const metadata = { title: "커뮤니티 채널" };

export default async function AdminCategoriesPage() {
  const session = await getActiveAuthSession();
  if (session?.user?.role !== "admin") {
    redirect("/dashboard/student");
  }

  const categoriesList = await getCategories();
  // 새 채널은 기본으로 맨 뒤에 놓인다. 관리자가 숫자를 바꿀 수 있다.
  const nextSortOrder = categoriesList.reduce((max, category) => Math.max(max, category.sortOrder), 0) + 1;

  return (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <div className="flex max-w-[1040px] flex-col gap-6 md:gap-7">
        <Link
          href="/community"
          className="-ml-1 hidden h-8 items-center gap-1.5 self-start rounded-md pl-1 pr-2 text-ui text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
        >
          <ChevronLeft className="size-4" strokeWidth={1.8} aria-hidden="true" />
          커뮤니티로 돌아가기
        </Link>
        <header className="flex flex-col gap-1.5">
          <h1 className="text-mobile-title font-semibold tracking-display md:text-display">커뮤니티 채널</h1>
          <p className="text-body text-secondary-foreground">자유 게시판의 채널입니다.</p>
        </header>

        <div className="flex flex-wrap items-start gap-x-14 gap-y-10">
          <section aria-labelledby="new-channel-title" className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
            <h2 id="new-channel-title" className="border-b border-border pb-2 text-ui font-semibold text-secondary-foreground">새 채널 추가</h2>
            <CategoryForm defaultSortOrder={nextSortOrder} />
          </section>

          <section aria-labelledby="channels-title" className="flex min-w-0 flex-[2_1_440px] flex-col">
            <h2 id="channels-title" className="border-b border-border pb-2 text-ui font-semibold text-secondary-foreground">
              등록된 채널 <span className="font-mono font-normal text-muted-foreground">{categoriesList.length}</span>
            </h2>
            {categoriesList.length === 0 ? (
              <EmptyState
                className="mt-4"
                title="등록된 채널이 없습니다"
                description="자유 게시판에 글을 쓰려면 채널이 하나 이상 필요합니다."
              />
            ) : (
              <ul className="flex flex-col">
                {categoriesList.map((cat: Category) => (
                  <CategoryListItem key={cat.id} category={cat} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
