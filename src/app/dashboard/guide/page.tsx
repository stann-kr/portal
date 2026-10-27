/**
 * @file src/app/dashboard/guide/page.tsx
 * @description 공용 가이드 첫 화면. 첫 페이지를 열고, 페이지가 없으면 빈 화면(관리자는 새 페이지)을 보인다.
 */
import { redirect } from "next/navigation";
import { BookOpenText } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { GuideNewPageButton } from "@/components/guide/GuideNewPageButton";
import { EmptyState } from "@/components/ui/empty-state";
import { getGuidePages } from "@/lib/actions/guide";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { guidePagePath } from "@/lib/guide-content";

export const dynamic = "force-dynamic";
export const metadata = { title: "가이드" };

export default async function GuideIndexPage() {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");

  const pages = await getGuidePages();
  if (pages[0]) redirect(guidePagePath(pages[0].id));

  return (
    <div className="px-5 pb-8 pt-4 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <MobileTopBar title="가이드" />
      <div className="flex max-w-[720px] flex-col gap-6">
        <h1 className="text-display font-semibold tracking-display">가이드</h1>
        <EmptyState
          icon={<BookOpenText strokeWidth={1.6} aria-hidden="true" />}
          title="아직 가이드 페이지가 없습니다"
          description={session.user.role === "admin" ? "새 페이지를 만들어 레슨 가이드를 시작하세요." : "관리자가 가이드를 올리면 여기에 보입니다."}
          action={session.user.role === "admin" ? <GuideNewPageButton /> : undefined}
        />
      </div>
    </div>
  );
}
