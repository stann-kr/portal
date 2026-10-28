/**
 * @file src/app/dashboard/guide/[pageId]/edit/page.tsx
 * @description 관리자 전용 가이드 페이지 편집. 노트 편집과 같은 초안·충돌·이탈 보호를 쓴다.
 */
import { notFound, redirect } from "next/navigation";
import { GuideEditorForm } from "@/components/guide/GuideEditorForm";
import { getGuidePage, updateGuidePage } from "@/lib/actions/guide";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { guidePagePath, parseGuidePageId } from "@/lib/guide-content";

export const dynamic = "force-dynamic";
export const metadata = { title: "가이드 편집" };

export default async function GuideEditPage({ params }: { params: Promise<{ pageId: string }> }) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const { pageId } = await params;
  if (session.user.role !== "admin") {
    redirect(parseGuidePageId(pageId) ? guidePagePath(pageId) : "/dashboard/guide");
  }

  const page = await getGuidePage(pageId);
  if (!page) notFound();

  return (
    <GuideEditorForm
      page={{ id: page.id, title: page.title, contentHtml: page.contentHtml, version: page.version }}
      actorId={session.user.id}
      action={updateGuidePage.bind(null, page.id)}
    />
  );
}
