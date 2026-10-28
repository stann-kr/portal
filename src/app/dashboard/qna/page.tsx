/**
 * @file src/app/dashboard/qna/page.tsx
 * @description Q&A 스레드 목록 페이지(캔버스 Qna·MobileQna 보드).
 * 학생: 본인 스레드만, 어드민: 전체 + 학생명 표시.
 */
export const dynamic = "force-dynamic";

import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { getQnaThreads } from "@/lib/actions/qna";
import { ThreadList } from "@/components/qna/ThreadList";
import type { QnaStatus } from "@/db/schema";
import { safeReturnPath } from "@/lib/safe-return-path";
import { buildQnaListHref, resolveQnaFilter } from "@/lib/qna-routes";
import { normalizeDocumentSearchQuery } from "@/lib/document-search";

type RawThread = Awaited<ReturnType<typeof getQnaThreads>>[number];

type QnaThreadItem = {
  id: string;
  title: string;
  status: QnaStatus;
  createdAt: Date | null | undefined;
  updatedAt: Date | null | undefined;
  studentId: string | null | undefined;
  studentName: string | null | undefined;
  studentEmail: string | null | undefined;
  searchPreview?: string;
};

export const metadata = { title: "Q&A" };

export default async function QnaPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; qnaStatus?: string | string[]; qnaQuery?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user) redirect("/login");

  const isAdmin = session.user.role === "admin";
  const query = await searchParams;
  const parentReturnTo = safeReturnPath(
    query.returnTo,
    isAdmin ? "/dashboard/admin?section=work" : "/dashboard/student?section=today",
  );
  const filter = resolveQnaFilter(query.qnaStatus);
  const search = normalizeDocumentSearchQuery(query.qnaQuery);
  const listHref = buildQnaListHref(parentReturnTo, filter, search);
  const rawThreads = await getQnaThreads(search);

  const threads: QnaThreadItem[] = rawThreads.map((t: RawThread) => ({
    ...t,
    status: t.status as QnaStatus,
  }));

  const trashHref = `/dashboard/qna/trash?returnTo=${encodeURIComponent(listHref)}`;
  const newHref = `/dashboard/qna/new?returnTo=${encodeURIComponent(listHref)}`;

  return (
    <div className="px-5 pb-8 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      {/* 좁은 화면의 새 질문(+)도 지금 목록 문맥으로 돌아오게 한다. */}
      {!isAdmin ? <MobileTopBar title="Q&A" action={{ href: newHref, label: "새 질문" }} /> : null}
      <div className="flex max-w-[880px] flex-col md:gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="sr-only md:not-sr-only md:text-display md:font-semibold md:tracking-display">Q&amp;A</h1>
            <p className="hidden text-body text-secondary-foreground md:block">
              {isAdmin ? "전체 학생의 질문을 관리합니다." : "Stann에게 질문을 남기고 답변을 받으세요."}
            </p>
          </div>
          <div className="hidden gap-2 md:flex">
            <Link href={trashHref} className={buttonClassName({ variant: "ghost" })}>휴지통</Link>
            {!isAdmin ? (
              <Link href={newHref} className={buttonClassName({ className: "gap-1.5" })}>
                <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />새 질문
              </Link>
            ) : null}
          </div>
        </header>

        <ThreadList variant="tabs" threads={threads} isAdmin={isAdmin} returnTo={listHref} filter={filter} query={search} />

        <Link
          href={trashHref}
          className="mt-2 flex h-11 items-center gap-2 self-start text-body text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <Trash2 className="size-4" strokeWidth={1.6} aria-hidden="true" />휴지통
        </Link>
      </div>
    </div>
  );
}
