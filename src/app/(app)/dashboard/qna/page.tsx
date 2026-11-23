/**
 * @file src/app/(app)/dashboard/qna/page.tsx
 * @description Q&A 스레드 목록 페이지(캔버스 Qna·MobileQna 보드).
 * 학생: 본인 스레드만, 어드민: 전체 + 학생명 표시. 어드민은 질문한 학생이 둘 이상이면 학생 필터(`?qnaStudent=`)를 둔다.
 */
export const dynamic = "force-dynamic";

import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { QnaListContextLink, QnaListTopBar } from "@/components/qna/QnaListContextLink";
import { getQnaThreads } from "@/lib/actions/qna";
import { ThreadList } from "@/components/qna/ThreadList";
import type { QnaStatus } from "@/db/schema";
import { safeReturnPath } from "@/lib/safe-return-path";
import { buildQnaListHref, resolveQnaFilter } from "@/lib/qna-routes";
import { normalizeDocumentSearchQuery } from "@/lib/document-search";
import { firstSearchValue } from "@/lib/portal-location";

/** 받은 질문에 나온 학생(이름순). 이름이 없으면 이메일 앞부분. */
function buildQnaStudentOptions(threads: ReadonlyArray<{ studentId: string | null | undefined; studentName: string | null | undefined; studentEmail: string | null | undefined }>) {
  const options = new Map<string, string>();
  for (const thread of threads) {
    if (!thread.studentId || options.has(thread.studentId)) continue;
    options.set(thread.studentId, thread.studentName?.trim() || thread.studentEmail?.split("@")[0] || "이름 미등록");
  }
  return [...options].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "ko"));
}

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
  searchParams: Promise<{ returnTo?: string; qnaStatus?: string | string[]; qnaQuery?: string | string[]; qnaStudent?: string | string[] }>;
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
  const rawThreads = await getQnaThreads(search);
  // 관리자 학생 필터: 받은 질문의 학생만 고를 수 있고, 목록에 없는 값은 전체로 돌아간다.
  const studentOptions = isAdmin ? buildQnaStudentOptions(rawThreads) : [];
  const requestedStudent = isAdmin ? firstSearchValue(query.qnaStudent) : null;
  const student = studentOptions.some((option) => option.id === requestedStudent) ? requestedStudent : null;
  const listHref = buildQnaListHref(parentReturnTo, filter, search, student);

  const threads: QnaThreadItem[] = rawThreads
    .filter((t: RawThread) => !student || t.studentId === student)
    .map((t: RawThread) => ({
      ...t,
      status: t.status as QnaStatus,
    }));

  // 머리 링크는 화면 안 상태 탭을 바꾼 뒤에도 그 탭으로 돌아오게 client에서 복귀 주소를 만든다.
  const context = { parentReturnTo, filter, search, student };

  return (
    <div className="px-5 pb-8 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      {/* 좁은 화면의 새 질문(+)도 지금 목록 문맥으로 돌아오게 한다. */}
      <QnaListTopBar title="Q&A" newQuestion={!isAdmin} {...context} />
      <div className="flex max-w-[880px] flex-col md:gap-6 md:mx-auto">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="sr-only md:not-sr-only md:text-display md:font-semibold md:tracking-display">Q&amp;A</h1>
            <p className="hidden text-body text-secondary-foreground md:block">
              {isAdmin ? "전체 학생의 질문을 관리합니다." : "Stann에게 질문을 남기고 답변을 받으세요."}
            </p>
          </div>
          <div className="hidden gap-2 md:flex">
            <QnaListContextLink path="/dashboard/qna/trash" {...context} className={buttonClassName({ variant: "ghost" })}>휴지통</QnaListContextLink>
            {!isAdmin ? (
              <QnaListContextLink path="/dashboard/qna/new" {...context} className={buttonClassName({ className: "gap-1.5" })}>
                <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />새 질문
              </QnaListContextLink>
            ) : null}
          </div>
        </header>

        <ThreadList
          variant="tabs"
          threads={threads}
          isAdmin={isAdmin}
          returnTo={listHref}
          filter={filter}
          query={search}
          studentFilter={isAdmin && studentOptions.length > 1 ? { options: studentOptions, selected: student } : undefined}
        />

        <QnaListContextLink
          path="/dashboard/qna/trash"
          {...context}
          className="mt-2 flex h-11 items-center gap-2 self-start text-body text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <Trash2 className="size-4" strokeWidth={1.6} aria-hidden="true" />휴지통
        </QnaListContextLink>
      </div>
    </div>
  );
}
