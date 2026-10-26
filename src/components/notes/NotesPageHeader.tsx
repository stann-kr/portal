import Link from "next/link";
import type { ReactNode } from "react";
import { Clock3, Plus, Trash2 } from "lucide-react";

const SECONDARY_ACTION =
  "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

/** 학생·관리자 노트 목록이 같은 머리말과 행동(시간으로 보기·휴지통·작성)을 쓴다. */
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
    <header className="space-y-3">
      {backLink}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={timelineHref} className={SECONDARY_ACTION}>
            <Clock3 className="size-4" aria-hidden="true" />시간으로 보기
          </Link>
          <Link href={trashHref} className={SECONDARY_ACTION}>
            <Trash2 className="size-4" aria-hidden="true" />휴지통
          </Link>
          <Link
            href={newNoteHref}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="size-4" aria-hidden="true" />노트 작성
          </Link>
        </div>
      </div>
    </header>
  );
}
