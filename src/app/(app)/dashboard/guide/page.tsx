/**
 * @file src/app/(app)/dashboard/guide/page.tsx
 * @description 공용 가이드 첫 화면. (볼 수 있는) 첫 페이지를 이 주소에서 바로 그리고(redirect 없음), 페이지가 없으면 빈 화면(관리자는 새 페이지)을,
 * 가이드가 열리지 않은 학생에게는 안내(GuideClosedNotice)를 보인다.
 */
import { redirect } from "next/navigation";
import { BookOpenText } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { GuideNewPageButton } from "@/components/guide/GuideNewPageButton";
import { EmptyState } from "@/components/ui/empty-state";
import { GuideClosedNotice } from "@/components/guide/GuideClosedNotice";
import { getGuidePages, isGuideClosedForViewer } from "@/lib/actions/guide";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { GuidePageScreen } from "./GuidePageScreen";

export const dynamic = "force-dynamic";
export const metadata = { title: "가이드" };

export default async function GuideIndexPage() {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");

  const pages = await getGuidePages();
  if (pages[0]) return <GuidePageScreen pageId={pages[0].id} session={session} />;
  // 열린 페이지가 없는 학생에게는 "아직 가이드가 없다"가 아니라 "아직 열리지 않았다"고 알린다.
  if (await isGuideClosedForViewer()) return <GuideClosedNotice />;

  return (
    <div className="px-5 pb-8 pt-4 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <MobileTopBar title="가이드" />
      <div className="flex max-w-[720px] flex-col gap-6 md:mx-auto">
        <h1 className="text-display font-semibold tracking-display">가이드</h1>
        <EmptyState
          icon={<BookOpenText strokeWidth={1.6} aria-hidden="true" />}
          title="아직 가이드 페이지가 없습니다"
          description={session.user.role === "admin" ? "새 페이지를 만들어 레슨 가이드를 시작하세요." : "Stann이 가이드를 올리면 여기에 보입니다."}
          action={session.user.role === "admin" ? <GuideNewPageButton /> : undefined}
        />
      </div>
    </div>
  );
}
