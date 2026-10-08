import Link from "next/link";
import { MessageCircle } from "lucide-react";
import type { QnaStatus } from "@/db/schema";
import {
  QNA_FILTER_TABS,
  QNA_STATUS_CONFIG,
  type QnaFilterTab,
} from "@/lib/qna-status";
import { buildQnaFilterHref, buildQnaSearchHref } from "@/lib/qna-routes";
import { DOCUMENT_SEARCH_MAX_QUERY_LENGTH } from "@/lib/document-search";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatKstShortDate } from "@/lib/kst-format";

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
}

export function ThreadList({ threads, isAdmin, returnTo = "/dashboard/qna", filter = "ALL", query = "" }: ThreadListProps) {
  const listHref = buildQnaSearchHref(buildQnaFilterHref(returnTo, filter), query);
  const listUrl = new URL(listHref, "https://portal.local");
  const counts = {
    ALL: threads.length,
    OPEN: threads.filter((thread) => thread.status === "OPEN").length,
    ANSWERED: threads.filter((thread) => thread.status === "ANSWERED").length,
    CLOSED: threads.filter((thread) => thread.status === "CLOSED").length,
  };
  const filteredThreads = filter === "ALL" ? threads : threads.filter((thread) => thread.status === filter);

  return (
    <div className="space-y-4">
      <form key={query} action={`${listUrl.pathname}${listUrl.hash}`} method="get" role="search" aria-label="Q&A 검색" className="space-y-2">
        {[...listUrl.searchParams].filter(([key]) => key !== "qnaQuery").map(([name, value], index) => (
          <input key={`${name}:${index}`} type="hidden" name={name} value={value} />
        ))}
        <label htmlFor="qna-search" className="text-sm font-medium">제목·질문·답변 검색</label>
        <div className="flex flex-wrap items-center gap-2">
          <Input id="qna-search" name="qnaQuery" type="search" defaultValue={query} maxLength={DOCUMENT_SEARCH_MAX_QUERY_LENGTH} placeholder="기억나는 대화 내용을 입력하세요" aria-describedby="qna-search-scope" className="min-w-0 flex-1 basis-48" />
          <Button type="submit" variant="outline">검색</Button>
          {query && <Link href={buildQnaSearchHref(listHref, "")} className="text-sm text-muted-foreground underline underline-offset-4">검색 초기화</Link>}
        </div>
        <p id="qna-search-scope" className="text-xs text-muted-foreground">전체 기간의 대화를 검색합니다. 띄어 쓴 단어를 제목·질문·답변에서 모두 찾습니다.</p>
      </form>
      <form action={`${listUrl.pathname}${listUrl.hash}`} method="get" aria-label="Q&A 상태 필터" className="flex flex-wrap gap-2 text-sm">
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
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {label} {counts[id]}
            </button>
          );
        })}
      </form>
      {query && <p role="status" className="text-sm text-muted-foreground">검색 결과 {threads.length}개 · 현재 상태 {filteredThreads.length}개</p>}

      {filteredThreads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2 rounded-xl border border-dashed border-border bg-muted/20">
          <MessageCircle className="w-8 h-8 opacity-20" />
          <p className="text-sm">{query ? "검색 조건에 맞는 대화가 없습니다. 다른 단어로 검색하거나 검색·상태 필터를 변경해 주세요." : threads.length ? "해당 상태의 스레드가 없습니다." : isAdmin ? "아직 질문이 없습니다." : "아직 등록한 질문이 없습니다."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredThreads.map((thread) => {
            const { label, color, iconClassName, Icon } = QNA_STATUS_CONFIG[thread.status];
            const date = formatKstShortDate(thread.createdAt, "작성일 미정");
            const student =
              thread.studentName ?? thread.studentEmail?.split("@")[0] ?? "이름 미등록";

            return (
              <Link
                key={thread.id}
                href={`/dashboard/qna/${thread.id}?returnTo=${encodeURIComponent(listHref)}`}
                className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-accent/5 transition-colors group"
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${iconClassName}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{thread.title}</p>
                  {thread.searchPreview && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{thread.searchPreview}</p>}
                  <div className="flex items-center gap-2 mt-0.5">
                    {isAdmin && (
                      <span className="text-xs text-muted-foreground">{student} /</span>
                    )}
                    <span className="text-xs text-muted-foreground">{date}</span>
                  </div>
                </div>
                <span className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold ${color}`}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
