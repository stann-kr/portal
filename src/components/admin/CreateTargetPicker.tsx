/**
 * 관리자 "새 노트"·"과제 내기"의 대상 고르기(캔버스 AdminUx1123 ①). 한 줄을 누르면 그 대상의 작성 화면이 열린다.
 * 링크만 두는 server component라 좁은 화면 위쪽 막대 +·넓은 화면 버튼이 같은 주소로 온다.
 */
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { LEDGER_ROW_CLASS, LedgerEmptyRow, LedgerSection, LedgerSectionHeader } from "@/components/student-portal/today/HomeSection";
import { cn } from "@/lib/utils";

import type { CreateTarget } from "@/lib/admin-create-targets";

export type { CreateTarget };

const ROW_CLASS = cn(
  LEDGER_ROW_CLASS,
  "flex min-h-13 items-center justify-between gap-3 py-2 text-md font-medium md:min-h-12 md:px-1 md:text-body",
);

function TargetList({ id, title, targets }: { id: string; title: string; targets: readonly CreateTarget[] }) {
  return (
    <LedgerSection labelledBy={id}>
      <LedgerSectionHeader id={id} title={title} count={targets.length} />
      <ul>
        {targets.map((target) => (
          <li key={target.id}>
            <Link href={target.href} className={ROW_CLASS}>
              <span className="min-w-0 truncate">{target.label}</span>
              <span className="shrink-0 text-xs font-normal text-muted-foreground">{target.meta}</span>
            </Link>
          </li>
        ))}
      </ul>
    </LedgerSection>
  );
}

export function CreateTargetPicker({
  pageTitle,
  heading,
  back,
  groups = [],
  students,
  hint,
}: {
  /** 위쪽 막대 제목(새 노트·과제 내기). */
  pageTitle: string;
  /** 화면 제목(누구의 노트를 쓸까요? 등). */
  heading: string;
  back: { href: string; label: string };
  groups?: readonly CreateTarget[];
  students: readonly CreateTarget[];
  hint?: string;
}) {
  return (
    <div className="px-5 pb-8 pt-4 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <MobileTopBar title={pageTitle} back={back} />
      <div className="flex max-w-[720px] flex-col gap-6 md:mx-auto">
        <header className="flex flex-col gap-3">
          <Link
            href={back.href}
            className="hidden w-fit items-center gap-1 rounded-sm text-ui text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
          >
            <ChevronLeft className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            {back.label}
          </Link>
          <h1 className="text-mobile-title text-foreground md:text-display md:font-semibold md:tracking-display">{heading}</h1>
          {hint ? <p className="text-ui text-muted-foreground">{hint}</p> : null}
        </header>
        {groups.length > 0 ? <TargetList id="create-target-groups" title="그룹" targets={groups} /> : null}
        {students.length > 0 ? (
          <TargetList id="create-target-students" title="학생" targets={students} />
        ) : (
          <LedgerSection labelledBy="create-target-students">
            <LedgerSectionHeader id="create-target-students" title="학생" />
            <LedgerEmptyRow>수강 중인 학생이 없습니다. 학생 목록에서 수강생을 추가해 주세요.</LedgerEmptyRow>
          </LedgerSection>
        )}
      </div>
    </div>
  );
}
