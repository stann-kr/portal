/**
 * @file src/app/dashboard/guide/[pageId]/page.tsx
 * @description 공용 가이드 페이지 읽기 화면. 학생·관리자가 같은 본문을 보고, 질문 위치는 서버가 보는 사람 기준으로 고른다.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PencilLine } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { NoteDocumentTitle } from "@/components/notes/NoteDocumentChrome";
import { formatNoteUpdated } from "@/components/notes/note-display";
import { GuideDeleteButton } from "@/components/guide/GuideDeleteButton";
import { GuidePageNav } from "@/components/guide/GuidePageNav";
import { GuideReader } from "@/components/guide/GuideReader";
import { buttonClassName } from "@/components/ui/button";
import { getGuidePage, getGuidePages, getGuideQuestions } from "@/lib/actions/guide";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { guidePagePath, listGuideBlockIds } from "@/lib/guide-content";
import { getRequestNow } from "@/lib/request-time";

export const dynamic = "force-dynamic";
export const metadata = { title: "가이드" };

export default async function GuidePageView({ params }: { params: Promise<{ pageId: string }> }) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");

  const { pageId } = await params;
  const [page, pages, questions] = await Promise.all([
    getGuidePage(pageId),
    getGuidePages(),
    getGuideQuestions(pageId),
  ]);
  if (!page) notFound();

  const isAdmin = session.user.role === "admin";
  const updatedLabel = formatNoteUpdated(page.updatedAt, getRequestNow());

  return (
    <div className="px-5 pb-8 pt-4 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <MobileTopBar title="가이드" />
      <div className="flex max-w-[1120px] flex-col gap-5 md:flex-row md:gap-12">
        <GuidePageNav pages={pages.map(({ id, title }) => ({ id, title }))} currentId={page.id} canManage={isAdmin} />
        <article className="flex min-w-0 max-w-[760px] flex-1 flex-col gap-6">
          <header className="flex flex-col gap-3">
            <NoteDocumentTitle>{page.title}</NoteDocumentTitle>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-ui text-muted-foreground">
                수정 {updatedLabel}
                {isAdmin && page.updatedByName ? ` · ${page.updatedByName}` : null}
              </p>
              {isAdmin ? (
                <div className="flex flex-wrap items-start gap-1">
                  <Link href={`${guidePagePath(page.id)}/edit`} className={buttonClassName({ variant: "outline" })}>
                    <PencilLine className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                    편집
                  </Link>
                  <GuideDeleteButton pageId={page.id} version={page.version} title={page.title} />
                </div>
              ) : null}
            </div>
          </header>
          <GuideReader
            page={{ id: page.id, title: page.title, contentHtml: page.contentHtml }}
            blockIds={listGuideBlockIds(page.contentHtml)}
            questions={questions.map((question) => ({
              threadId: question.threadId,
              threadTitle: question.threadTitle,
              status: question.status,
              studentName: isAdmin ? question.studentName : null,
              blockId: question.blockId,
              quote: question.quote,
            }))}
            canAsk={session.user.role === "student"}
            showStudentNames={isAdmin}
            actorId={session.user.id}
          />
        </article>
      </div>
    </div>
  );
}
