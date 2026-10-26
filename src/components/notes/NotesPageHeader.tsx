import Link from "next/link";
import type { ReactNode } from "react";
import { Clock3, Plus, Trash2 } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MOBILE_LINK =
  "flex h-11 items-center gap-2 rounded-touch text-body text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * 학생·관리자 노트 목록이 같은 머리말과 행동(시간으로 보기·휴지통·작성)을 쓴다(Notes·MobileNotes 보드).
 * 넓은 화면은 제목 오른쪽에 행동을 두고, 좁은 화면은 위쪽 막대가 제목·새 노트를, 목록 맨 아래 새 노트 줄이 작성을 맡으므로
 * 시간으로 보기·휴지통을 목록 아래 줄로 보낸다(부모가 `flex flex-col`이면 `order-last`로 맨 아래에 놓인다).
 */
export function NotesPageHeader({
  eyebrow,
  title = "노트",
  backLink,
  timelineHref,
  trashHref,
  newNoteHref,
}: {
  eyebrow: ReactNode;
  title?: string;
  backLink?: ReactNode;
  timelineHref: string;
  trashHref: string;
  newNoteHref: string;
}) {
  return (
    <>
      {/* 좁은 화면은 위쪽 막대가 제목을 보이므로, 돌아가기 링크가 없으면 머리말을 화면 읽기용으로만 남긴다. */}
      <header className={cn("flex flex-col gap-3", !backLink && "max-md:sr-only")}>
        {backLink}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="hidden text-xs text-muted-foreground md:block">{eyebrow}</p>
            <h1 className="sr-only text-display font-semibold tracking-display text-foreground md:not-sr-only">{title}</h1>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Link href={timelineHref} className={buttonClassName({ variant: "ghost" })}>
              <Clock3 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />시간으로 보기
            </Link>
            <Link href={trashHref} className={buttonClassName({ variant: "ghost" })}>
              <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />휴지통
            </Link>
            <Link href={newNoteHref} className={buttonClassName()}>
              <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />노트 작성
            </Link>
          </div>
        </div>
      </header>
      <nav aria-label="노트 바로 가기" className="order-last -mt-5 flex flex-col md:hidden">
        <Link href={timelineHref} className={MOBILE_LINK}>
          <Clock3 className="size-4" strokeWidth={1.6} aria-hidden="true" />시간으로 보기
        </Link>
        <Link href={trashHref} className={MOBILE_LINK}>
          <Trash2 className="size-4" strokeWidth={1.6} aria-hidden="true" />휴지통
        </Link>
      </nav>
    </>
  );
}
