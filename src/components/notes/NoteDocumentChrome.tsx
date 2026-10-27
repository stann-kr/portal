/**
 * 노트 문서 화면(NoteDoc·NoteNew·MobileNoteDoc 보드)의 공통 틀. 편집 form(client)과 읽기 전용·휴지통 화면(server)이 같이 쓴다.
 * hook 없이 표시만 하므로 어느 쪽에서든 렌더할 수 있다.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { History, type LucideIcon } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 좁은 화면 위쪽 막대의 44×44 조작. */
export const NOTE_TOPBAR_BUTTON =
  "flex size-11 shrink-0 items-center justify-center rounded-touch text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** 넓은 화면 문서 위쪽 52px 줄: 왼쪽 위치(또는 돌아가기), 오른쪽 저장 상태와 문서 조작. 좁은 화면은 셸 위쪽 막대가 맡는다. */
export function NoteDocumentStrip({ start, children }: { start: ReactNode; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 hidden h-[52px] items-center justify-between gap-3 border-b border-muted bg-background px-6 md:flex">
      <div className="flex min-w-0 items-center">{start}</div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

/** 위치 줄: "노트 / 제목". 상위 항목은 돌아갈 화면으로 연결한다. */
export function NoteBreadcrumb({ parent, current }: { parent: { href: string; label: string }; current: string }) {
  return (
    <nav aria-label="위치" className="flex min-w-0 items-center gap-1.5 text-ui">
      <Link
        href={parent.href}
        className="shrink-0 rounded-sm text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {parent.label}
      </Link>
      <span aria-hidden="true" className="text-faint">/</span>
      <span aria-current="page" className="min-w-0 truncate text-foreground">{current}</span>
    </nav>
  );
}

/** 변경 이력 이동. 넓은 화면은 글자 버튼, 좁은 화면 위쪽 막대는 아이콘 버튼. */
export function NoteHistoryLink({ href, compact = false }: { href: string; compact?: boolean }) {
  if (compact) {
    return (
      <Link href={href} aria-label="변경 이력" className={NOTE_TOPBAR_BUTTON}>
        <History className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
      </Link>
    );
  }
  return (
    <Link href={href} className={buttonClassName({ variant: "ghost" })}>
      <History className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
      변경 이력
    </Link>
  );
}

/**
 * 문서 본문 틀: 넓은 화면 위 72·아래 96 여백과 720px 열, 좁은 화면 좌우 20.
 * 편집기의 떠 있는 패널·아래쪽 서식 줄이 위쪽 막대와 좌우 여백을 알 수 있게 CSS 변수를 둔다.
 */
export function NoteDocumentBody({ children, as: Element = "div", className }: {
  children: ReactNode;
  as?: "div" | "article";
  className?: string;
}) {
  return (
    <div className="flex justify-center px-5 pb-8 pt-6 [--editor-bleed:1.25rem] [--editor-sticky-top:var(--app-topbar-height)] md:px-[clamp(20px,3vw,32px)] md:pb-24 md:pt-[72px] md:[--editor-sticky-top:3.25rem]">
      <Element className={cn("flex w-full min-w-0 max-w-[720px] flex-col gap-4 md:gap-6", className)}>{children}</Element>
    </div>
  );
}

/** 읽기 화면 제목(36/44, 좁은 화면 26/34). */
export function NoteDocumentTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="break-words text-[26px] font-semibold leading-[34px] tracking-display text-foreground md:text-4xl md:leading-[44px] md:tracking-[-0.025em]">
      {children}
    </h1>
  );
}

/** 제목 입력(textarea)의 글자. 읽기 화면 제목과 같은 크기다. */
export const NOTE_TITLE_FIELD_CLASS =
  "w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[26px] font-semibold leading-[34px] tracking-display text-foreground placeholder:text-muted-foreground focus:outline-none md:text-4xl md:leading-[44px] md:tracking-[-0.025em]";

/** 새 노트의 날짜 입력(NoteNew 보드는 native 날짜 칸, 노트 문서는 `NoteDateField` 글자 표시). */
export const NOTE_DATE_INPUT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2 font-mono text-base text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:h-[30px] md:text-xs";

/** 속성 줄 묶음과 아래 구분선. */
export function NoteProperties({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="flex flex-col">{children}</div>
      <div aria-hidden="true" className="h-px bg-muted" />
    </>
  );
}

/** 속성 한 줄: 아이콘·이름(96px, 좁은 화면 88px)과 값. `htmlFor`를 주면 이름이 입력의 label이 된다. */
export function NoteProperty({
  icon: Icon,
  label,
  htmlFor,
  children,
  tall = false,
}: {
  icon: LucideIcon;
  label: string;
  htmlFor?: string;
  children: ReactNode;
  /** 입력이 있는 줄(36px). */
  tall?: boolean;
}) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div className={cn("flex min-w-0 items-center text-body md:text-ui", tall ? "min-h-11 md:min-h-9" : "min-h-9 md:min-h-8")}>
      <Label htmlFor={htmlFor} className="inline-flex w-[88px] shrink-0 items-center gap-2 text-muted-foreground md:w-24">
        <Icon className="size-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
        {label}
      </Label>
      <div className="min-w-0 truncate text-foreground">{children}</div>
    </div>
  );
}

/** 날짜 입력(NoteNew 보드: 30px·r6·Mono 12). 좁은 화면은 확대 방지를 위해 16px. */
export type NoteParent = {
  href: string;
  /** 위치 줄의 상위 항목 이름. */
  label: string;
  /** 좁은 화면 뒤로 버튼의 접근 가능한 이름. */
  backLabel: string;
};

/** 노트를 연 화면(`returnTo`)을 위치 줄의 상위 항목과 뒤로 버튼 이름으로 바꾼다. */
export function resolveNoteParent(returnTo: string): NoteParent {
  const [pathname = "", query = ""] = returnTo.split("#")[0]!.split("?");
  const parent = (label: string, backLabel: string) => ({ href: returnTo, label, backLabel });
  if (pathname.startsWith("/dashboard/notes/trash")) return parent("노트 휴지통", "노트 휴지통으로");
  if (pathname.endsWith("/notes")) return parent("노트", "노트 목록으로");
  if (pathname === "/dashboard/student") {
    return new URLSearchParams(query).get("section") === "workspace"
      ? parent("캘린더", "캘린더로")
      : parent("홈", "홈으로");
  }
  if (pathname.startsWith("/dashboard/admin/students/")) return parent("학생 상세", "학생 상세로");
  if (pathname.startsWith("/dashboard/admin")) return parent("업무함", "업무함으로");
  return parent("돌아가기", "돌아가기");
}
