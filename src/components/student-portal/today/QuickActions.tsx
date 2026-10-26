import Link from "next/link";
import { CalendarDays, FileText, HelpCircle, ListMusic, MessagesSquare } from "lucide-react";
import { buildQnaListHref } from "@/lib/qna-routes";
import { buildStudentDiggingBoardHref } from "@/lib/student-space-routes";
import { WithinPageLink } from "./WithinPageLink";

const QUICK_ACTION_CLASS =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";

/** 빠른 기록: 홈 머리글 아래의 조용한 버튼 줄. 좁은 화면에서는 줄바꿈한다. */
export function QuickActions({
  newNoteHref,
  calendarHref,
  returnTo,
}: {
  newNoteHref: string;
  calendarHref: string;
  returnTo: string;
}) {
  const encodedReturnTo = encodeURIComponent(returnTo);
  return (
    <nav aria-label="빠른 기록" className="flex flex-wrap gap-1.5">
      <Link href={newNoteHref} className={QUICK_ACTION_CLASS}>
        <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
        노트 작성
      </Link>
      <Link href={`/dashboard/qna/new?returnTo=${encodedReturnTo}`} className={QUICK_ACTION_CLASS}>
        <HelpCircle className="size-3.5 text-muted-foreground" aria-hidden="true" />
        질문 작성
      </Link>
      <Link href={buildStudentDiggingBoardHref(returnTo)} className={QUICK_ACTION_CLASS}>
        <ListMusic className="size-3.5 text-muted-foreground" aria-hidden="true" />
        디깅 보드
      </Link>
      <WithinPageLink href={calendarHref} className={QUICK_ACTION_CLASS}>
        <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden="true" />
        캘린더
      </WithinPageLink>
      <Link href={buildQnaListHref(returnTo)} className={`${QUICK_ACTION_CLASS} border-transparent bg-transparent text-muted-foreground hover:text-foreground`}>
        <MessagesSquare className="size-3.5" aria-hidden="true" />
        Q&A 전체 보기
      </Link>
    </nav>
  );
}
