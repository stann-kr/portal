import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { buildStudentDiggingBoardHref } from "@/lib/student-space-routes";

const QUICK_ACTION_CLASS = buttonClassName({ variant: "outline", className: "px-3" });

/**
 * 빠른 기록(Main 보드): 홈 머리 아래 노트 쓰기 · 질문하기 · 디깅 추가.
 * 좁은 화면은 위쪽 막대의 새로 만들기와 메뉴 서랍이 같은 행동을 맡으므로 넓은 화면에서만 보인다.
 */
export function QuickActions({ newNoteHref, returnTo }: { newNoteHref: string; returnTo: string }) {
  return (
    <nav aria-label="빠른 기록" className="mt-3 hidden flex-wrap gap-2 md:flex">
      <Link href={newNoteHref} className={QUICK_ACTION_CLASS}>
        <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
        노트 쓰기
      </Link>
      <Link href={`/dashboard/qna/new?returnTo=${encodeURIComponent(returnTo)}`} className={QUICK_ACTION_CLASS}>
        질문하기
      </Link>
      <Link href={buildStudentDiggingBoardHref(returnTo)} className={QUICK_ACTION_CLASS}>
        디깅 추가
      </Link>
    </nav>
  );
}
