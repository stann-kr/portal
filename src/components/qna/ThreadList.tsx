/**
 * @file src/components/qna/ThreadList.tsx
 * @description Q&A 스레드 목록(캔버스 Qna·MobileQna·AdminStudentQna 보드).
 * 상태 필터와 검색은 GET form으로 주소에 남겨 상세·작성·휴지통을 다녀와도 같은 목록 문맥을 연다.
 */
import Link from "next/link";
import { MessageCircle, Search } from "lucide-react";
import type { QnaStatus } from "@/db/schema";
import { QNA_FILTER_TABS, type QnaFilterTab } from "@/lib/qna-status";
import { buildQnaFilterHref, buildQnaSearchHref } from "@/lib/qna-routes";
import { DOCUMENT_SEARCH_MAX_QUERY_LENGTH } from "@/lib/document-search";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { QnaStatusLabel, formatKstMonthDay } from "./qna-display";

type Thread = {
  id: string;
  title: string;
  status: QnaStatus;
  createdAt: Date | null | undefined;
  studentName: string | null | undefined;
  studentEmail: string | null | undefined;
  searchPreview?: string;
};

interface ThreadListProps {
  threads: Thread[];
  isAdmin: boolean;
  returnTo?: string;
  filter?: QnaFilterTab;
  query?: string;
  /**
   * chips(기본): 학생 상세 같은 화면 안의 작은 상태 칩(AdminStudentQna 보드).
   * tabs: Q&A 화면의 밑줄 탭(Qna·MobileQna 보드). 좁은 화면에서 탭 줄이 화면 끝까지(좌우 20px 여백 밖) 닿는다.
   */
  variant?: "tabs" | "chips";
}

export function ThreadList({
  threads,
  isAdmin,
  returnTo = "/dashboard/qna",
  filter = "ALL",
  query = "",
  variant = "chips",
}: ThreadListProps) {
  const listHref = buildQnaSearchHref(buildQnaFilterHref(returnTo, filter), query);
  const listUrl = new URL(listHref, "https://portal.local");
  const formAction = `${listUrl.pathname}${listUrl.hash}`;
  const counts = {
    ALL: threads.length,
    OPEN: threads.filter((thread) => thread.status === "OPEN").length,
    ANSWERED: threads.filter((thread) => thread.status === "ANSWERED").length,
    CLOSED: threads.filter((thread) => thread.status === "CLOSED").length,
  };
  const filteredThreads = filter === "ALL" ? threads : threads.filter((thread) => thread.status === filter);
  const isTabs = variant === "tabs";

  const statusFilter = (
    <form
      action={formAction}
      method="get"
      aria-label="Q&A 상태 필터"
      className={cn(
        "flex",
        isTabs
          ? "scroll-row -mx-5 gap-5 border-b border-muted px-5 text-body md:mx-0 md:gap-5 md:overflow-visible md:border-0 md:px-0 md:text-ui"
          : "flex-wrap gap-1",
      )}
    >
      {[...listUrl.searchParams].filter(([key]) => key !== "qnaStatus").map(([name, value], index) => (
        <input key={`${name}:${index}`} type="hidden" name={name} value={value} />
      ))}
      {QNA_FILTER_TABS.map(({ id, label }) => {
        const isActive = filter === id;
        return (
          <button
            key={id}
            type="submit"
            name="qnaStatus"
            value={id}
            aria-pressed={isActive}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 whitespace-nowrap transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              isTabs
                ? cn(
                  "h-11 md:h-8",
                  isActive
                    ? "font-medium text-foreground shadow-[inset_0_-2px_0_currentColor]"
                    : "text-secondary-foreground hover:text-foreground",
                )
                : cn(
                  "h-7 gap-1.5 rounded-full px-2.5 text-xs",
                  isActive ? "bg-muted text-foreground" : "text-secondary-foreground hover:bg-muted hover:text-foreground",
                ),
            )}
          >
            {label}
            <span className={cn("font-mono text-xs font-normal", (isActive || !isTabs) && "text-muted-foreground")}>{counts[id]}</span>
          </button>
        );
      })}
    </form>
  );

  const search = (
    <form
      key={query}
      action={formAction}
      method="get"
      role="search"
      aria-label="Q&A 검색"
      className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1", isTabs ? "w-full md:w-auto" : "w-full sm:w-auto")}
    >
      {[...listUrl.searchParams].filter(([key]) => key !== "qnaQuery").map(([name, value], index) => (
        <input key={`${name}:${index}`} type="hidden" name={name} value={value} />
      ))}
      <label htmlFor="qna-search" className="relative flex min-w-0 flex-1 items-center md:flex-none">
        <span className="sr-only">제목·질문·답변 검색</span>
        <Search className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground md:left-2.5 md:size-3.5" strokeWidth={1.8} aria-hidden="true" />
        <Input
          id="qna-search"
          name="qnaQuery"
          type="search"
          enterKeyHint="search"
          defaultValue={query}
          maxLength={DOCUMENT_SEARCH_MAX_QUERY_LENGTH}
          placeholder={isTabs ? "대화 내용 검색" : "기억나는 대화 내용을 입력하세요"}
          aria-describedby="qna-search-scope"
          className={cn("pl-10 md:h-8 md:pl-8 md:text-ui", isTabs ? "md:w-60" : "md:w-70")}
        />
      </label>
      <span id="qna-search-scope" className="sr-only">전체 기간의 대화를 검색합니다. 띄어 쓴 단어를 제목·질문·답변에서 모두 찾습니다. 입력한 뒤 Enter를 누르세요.</span>
      {query ? (
        <Link href={buildQnaSearchHref(listHref, "")} className="text-ui text-secondary-foreground underline underline-offset-4 hover:text-foreground">검색 초기화</Link>
      ) : null}
    </form>
  );

  return (
    <div className="flex flex-col">
      {isTabs ? (
        <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-3 md:border-b md:border-border md:pb-3">
          {statusFilter}
          {search}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {statusFilter}
          {search}
        </div>
      )}

      {query ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          검색 결과 <span className="font-mono">{threads.length}</span>개 · 현재 상태 <span className="font-mono">{filteredThreads.length}</span>개
        </p>
      ) : null}

      {filteredThreads.length === 0 ? (
        <EmptyState
          className="mt-4 md:mt-6"
          icon={<MessageCircle className="size-4" strokeWidth={1.6} aria-hidden="true" />}
          title={query
            ? "검색 조건에 맞는 대화가 없습니다"
            : threads.length
              ? "해당 상태의 대화가 없습니다"
              : isAdmin
                ? "아직 질문이 없습니다"
                : "아직 등록한 질문이 없습니다"}
          description={query
            ? "다른 단어로 검색하거나 검색·상태 필터를 변경해 주세요."
            : threads.length
              ? "다른 상태를 선택해 주세요."
              : isAdmin
                ? "학생이 질문을 남기면 여기에 보입니다."
                : "궁금한 점을 강사에게 질문해 보세요."}
        />
      ) : (
        <ul className={cn("flex flex-col", isTabs ? "mt-4 border-t border-border md:mt-6 md:border-t-0" : "mt-4 border-t border-border")}>
          {filteredThreads.map((thread) => {
            const date = formatKstMonthDay(thread.createdAt, "날짜 미정");
            const student = thread.studentName ?? thread.studentEmail?.split("@")[0] ?? "이름 미등록";
            const twoLine = isAdmin || Boolean(thread.searchPreview);

            return (
              <li key={thread.id}>
                <Link
                  href={`/dashboard/qna/${thread.id}?returnTo=${encodeURIComponent(listHref)}`}
                  className={cn(
                    "flex flex-col gap-1 border-b border-muted py-3 text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
                    "md:flex-row md:items-center md:gap-3.5 md:px-1",
                    twoLine ? "md:min-h-14 md:py-2" : "md:h-13 md:py-0",
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-0.5 md:order-1 md:flex-1">
                    <span className="text-md md:truncate md:text-body">{thread.title}</span>
                    {thread.searchPreview ? (
                      <span className="line-clamp-2 text-ui text-secondary-foreground md:text-xs">{thread.searchPreview}</span>
                    ) : null}
                    {isAdmin ? (
                      <span className="hidden text-xs text-muted-foreground md:block">
                        {student} / <span className="font-mono">{date}</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2.5 text-ui md:contents">
                    <QnaStatusLabel status={thread.status} className="shrink-0 md:order-3 md:w-24" />
                    {isAdmin ? <span className="text-xs text-muted-foreground md:hidden">{student} /</span> : null}
                    <span className={cn("font-mono text-xs text-muted-foreground md:order-2 md:w-16 md:shrink-0", isAdmin && "md:hidden")}>{date}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
