/**
 * @file src/app/(app)/dashboard/guide/GuidePageScreen.tsx
 * @description 공용 가이드 페이지 읽기 화면. 학생·관리자가 같은 본문을 보고, 질문 위치는 서버가 보는 사람 기준으로 고른다.
 * `/dashboard/guide/[pageId]`와 가이드 첫 화면(`/dashboard/guide`, 첫 페이지)이 함께 쓴다. 첫 화면이 redirect하지 않고
 * 바로 그려 두 번째 요청과 스켈레톤 교체(목록 모양 → 페이지 모양)가 없다.
 * 바깥 여백과 왼쪽 목차는 가이드 layout(GuideShell)이 그린다. 이 화면은 본문(article)만 그려 페이지를 옮겨도 목차가 남는다.
 * 관리자에게는 머리줄에 "열람 학생 N명" 버튼(GuidePageViewers)을 편집 앞에 둔다.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilLine } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { NoteDocumentTitle } from "@/components/notes/NoteDocumentChrome";
import { formatNoteUpdated } from "@/components/notes/note-display";
import { GuideDeleteButton } from "@/components/guide/GuideDeleteButton";
import { GuideReader } from "@/components/guide/GuideReader";
import { buttonClassName } from "@/components/ui/button";
import { GuideClosedNotice } from "@/components/guide/GuideClosedNotice";
import { GuidePageViewers } from "@/components/guide/GuidePageViewers";
import { getGuidePage, getGuideQuestions, isGuideClosedForViewer } from "@/lib/actions/guide";
import { getGuidePageViewers } from "@/lib/actions/guideAccess";
import type { AuthSession } from "@/lib/auth-guard";
import { guidePagePath, listGuideBlockIds } from "@/lib/guide-content";
import { getRequestNow } from "@/lib/request-time";

export async function GuidePageScreen({ pageId, session }: { pageId: string; session: AuthSession }) {
  const isAdmin = session.user.role === "admin";
  const [page, questions, viewers] = await Promise.all([
    getGuidePage(pageId),
    getGuideQuestions(pageId),
    isAdmin ? getGuidePageViewers(pageId) : null,
  ]);
  // 열리지 않은 페이지는 없는 페이지와 같다. 가이드 전체가 닫힌 학생에게는 안내만 보인다.
  if (!page) {
    if (await isGuideClosedForViewer()) return <GuideClosedNotice />;
    notFound();
  }

  const updatedLabel = formatNoteUpdated(page.updatedAt, getRequestNow());

  return (
    <>
      <MobileTopBar title="가이드" />
        <article className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-col gap-3">
            <NoteDocumentTitle>{page.title}</NoteDocumentTitle>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-ui text-muted-foreground">
                수정 {updatedLabel}
                {isAdmin && page.updatedByName ? ` · ${page.updatedByName}` : null}
              </p>
              {isAdmin ? (
                <div className="flex flex-wrap items-start gap-1">
                  {viewers ? <GuidePageViewers pageTitle={page.title} initial={viewers} /> : null}
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
    </>
  );
}
