/**
 * @file src/app/dashboard/guide/[pageId]/page.tsx
 * @description 공용 가이드 페이지 읽기 화면(GuidePageScreen).
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { GuidePageScreen } from "../GuidePageScreen";

export const dynamic = "force-dynamic";
export const metadata = { title: "가이드" };

export default async function GuidePageView({ params }: { params: Promise<{ pageId: string }> }) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const { pageId } = await params;
  return <GuidePageScreen pageId={pageId} session={session} />;
}
