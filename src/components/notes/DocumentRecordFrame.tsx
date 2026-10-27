/**
 * 변경 이력·휴지통 화면의 공통 틀(NoteHistory·NotesTrash 보드). 노트·Q&A·게시물이 같은 모양을 쓴다.
 * hook과 셸 의존 없이 표시만 하므로 server page에서 바로 렌더한다.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** 이력 행 오른쪽 위 칸(복원 버튼·상태). 복원 버튼은 확인 영역이 행 전체 폭에 열리도록 이 칸에 직접 놓인다. */
export const RECORD_ACTION_CELL = "col-start-2 row-start-1 justify-self-end";
/** 이력 행의 전체 폭 칸(복원 확인·오류·저장된 내용). */
export const RECORD_FULL_ROW = "col-span-2";
/** 이력 복원 확인(NoteHistory 보드): 옅은 사이드바 면 r8. 넓은 화면은 문구 왼쪽·버튼 오른쪽 한 줄, 좁은 화면은 ConfirmPanel대로 버튼이 줄을 채운다. */
export const RESTORE_CONFIRM_CLASS =
  "space-y-0 rounded-touch border-0 bg-sidebar px-3.5 py-3 md:flex-wrap md:items-center md:justify-between md:gap-2.5 [&>p]:text-ui";

/**
 * 돌아가기·제목·설명과 목록. 돌아가기 링크도 머리말(`<header>`) 안에 둔다.
 * history 760px, trash 880px 열(넓은 화면 위 40·아래 80, 좁은 화면 좌우 20).
 */
export function RecordPageFrame({
  back,
  title,
  subtitle,
  description,
  width,
  children,
}: {
  back: { href: string; label: string };
  title: string;
  /** 문서 이름·현재 버전 같은 한 줄(글자 2). */
  subtitle?: ReactNode;
  /** 동작 설명(이력은 글자 3 작은 글자, 휴지통은 글자 2 본문). */
  description?: ReactNode;
  width: "history" | "trash";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-7 px-5 pb-10 pt-6 md:box-content md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10",
        width === "history" ? "max-w-[760px]" : "max-w-[880px]",
      )}
    >
      <header className="flex flex-col gap-7">
        <Link
          href={back.href}
          className="-ml-1 inline-flex h-11 items-center gap-1.5 self-start rounded-md pl-1 pr-2 text-ui text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8"
        >
          <ChevronLeft className="size-4" strokeWidth={1.8} aria-hidden="true" />
          {back.label}
        </Link>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-display font-semibold tracking-display text-foreground">{title}</h1>
          {subtitle ? <p className="text-body text-secondary-foreground">{subtitle}</p> : null}
          {description ? (
            <p className={width === "history" ? "mt-1 text-ui text-muted-foreground" : "text-body text-secondary-foreground"}>
              {description}
            </p>
          ) : null}
        </div>
      </header>
      {children}
    </div>
  );
}

/** 위 1px 선으로 시작하는 기록 목록. 이력은 순서가 있는 `ol`, 휴지통은 `ul`. */
export function RecordList({ ordered = false, label, children }: { ordered?: boolean; label?: string; children: ReactNode }) {
  const List = ordered ? "ol" : "ul";
  return (
    <List aria-label={label} className="flex flex-col border-t border-border">
      {children}
    </List>
  );
}

/**
 * 변경 이력 한 행: "4번 · 내용 수정"과 오른쪽 위 조작, 아래 시각·작성자 줄, 그 아래 확인·저장된 내용.
 * `action`은 `RECORD_ACTION_CELL`(조작)과 `RECORD_FULL_ROW`(확인 영역) 칸에 직접 놓이는 grid 항목이다.
 */
export function HistoryRecordItem({
  number,
  changeLabel,
  meta,
  action,
  children,
}: {
  number: number;
  changeLabel: string;
  meta: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-muted px-1 py-4">
      <p className="col-start-1 row-start-1 min-w-0 text-body font-medium text-foreground">
        <span className="font-mono">{number}번</span> · {changeLabel}
      </p>
      {action}
      <p className={cn(RECORD_FULL_ROW, "row-start-2 text-xs text-muted-foreground")}>{meta}</p>
      {children}
    </li>
  );
}

/** 이력 시각(Mono)·작성자·덧붙임 줄. */
export function RecordMeta({ time, actor, extra }: { time: string; actor: string; extra?: string }) {
  return (
    <>
      <span className="font-mono">{time}</span> · {actor}
      {extra ? ` · ${extra}` : ""}
    </>
  );
}

/** 저장된 내용 펼치기(옅은 사이드바 면 r8). */
export function RecordDetails({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className={RECORD_FULL_ROW}>
      <summary className="w-fit cursor-pointer rounded-sm text-ui text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {summary}
      </summary>
      <div className="mt-2.5 flex flex-col gap-2 rounded-touch bg-sidebar px-4 py-3.5 text-body text-secondary-foreground">
        {children}
      </div>
    </details>
  );
}

/** 휴지통 한 행: 제목 링크·삭제 정보·복원 기한(만료는 경고색)과 오른쪽 조작. */
export function TrashRecordItem({
  title,
  href,
  meta,
  state,
  expired,
  actions,
}: {
  title: string;
  href: string;
  meta: ReactNode;
  state: string;
  expired: boolean;
  actions: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-muted px-1 py-4">
      <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1">
        <Link
          href={href}
          className="self-start rounded-sm text-md font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {title}
        </Link>
        <span className="text-xs text-muted-foreground">{meta}</span>
        <span className={cn("text-xs", expired ? "text-warning" : "text-secondary-foreground")}>{state}</span>
      </div>
      {actions}
    </li>
  );
}

/** 비어 있는 기록(States 보드 빈 화면). */
export function RecordEmpty({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-muted px-6 py-10 md:px-8 md:py-12">
      <span className="flex size-9 items-center justify-center rounded-touch bg-sidebar text-muted-foreground">
        <Icon className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
      </span>
      <p className="max-w-[300px] text-body text-secondary-foreground">{children}</p>
    </div>
  );
}
