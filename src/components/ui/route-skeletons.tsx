import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SkeletonBar, SkeletonBlock, SkeletonCircle, SkeletonRegion } from "./skeleton";
import { RouteLoadingState } from "./route-loading-state";
import type { RouteSkeletonKind } from "./route-skeleton-kind";

/**
 * 화면 모양별 스켈레톤. 각 화면의 바깥 여백·최대 폭·위 여백을 그대로 따라
 * 내용이 들어와도 자리가 크게 움직이지 않게 한다(캔버스 '개선 2차 시안' 1번).
 */

const FRAME_PADDING = "px-5 pb-8 md:px-[clamp(20px,4.5vw,64px)] md:pb-20";

const TOP_PADDING = {
  compact: "pt-4 md:pt-14",
  standard: "pt-6 md:pt-14",
  detail: "pt-6 md:pt-10",
} as const;

const COLUMN_WIDTH = {
  560: "max-w-[560px]",
  720: "max-w-[720px]",
  760: "max-w-[760px]",
  880: "max-w-[880px]",
  1040: "max-w-[1040px]",
  1080: "max-w-[1080px]",
  1120: "max-w-[1120px]",
  full: "max-w-none",
} as const;

const ROW_WIDTHS = ["w-[62%]", "w-[48%]", "w-[70%]", "w-[55%]", "w-[40%]", "w-[66%]", "w-[52%]", "w-[58%]"];
const LINE_WIDTHS = ["w-full", "w-[92%]", "w-[96%]", "w-[84%]", "w-full", "w-[88%]", "w-[72%]", "w-[94%]", "w-[60%]"];

const ROUTE_SKELETON_LABELS: Record<RouteSkeletonKind, string> = {
  generic: "화면을 불러오는 중",
  "work-queue": "업무함을 불러오는 중",
  today: "오늘 할 일을 불러오는 중",
  "student-detail": "학생 정보를 불러오는 중",
  "record-list": "노트 목록을 불러오는 중",
  "record-list-narrow": "목록을 불러오는 중",
  history: "기록을 불러오는 중",
  "thread-list": "목록을 불러오는 중",
  document: "문서를 불러오는 중",
  editor: "편집 화면을 불러오는 중",
  form: "설정을 불러오는 중",
  "form-narrow": "입력 화면을 불러오는 중",
  "form-wide": "설정을 불러오는 중",
  board: "디깅 보드를 불러오는 중",
  assignment: "과제를 불러오는 중",
  calendar: "일정을 불러오는 중",
  "guide-index": "가이드 목록을 불러오는 중",
  "guide-page": "가이드를 불러오는 중",
  auth: "불러오는 중",
  privacy: "개인정보 처리방침을 불러오는 중",
};

function Frame({
  label,
  top,
  width,
  gap = "gap-6 md:gap-8",
  children,
}: {
  label: string;
  top: keyof typeof TOP_PADDING;
  width: keyof typeof COLUMN_WIDTH;
  gap?: string;
  children: ReactNode;
}) {
  return (
    <SkeletonRegion label={label} className={cn("box-border min-h-[100dvh]", FRAME_PADDING, TOP_PADDING[top])}>
      <div className={cn("flex flex-col", COLUMN_WIDTH[width], gap, "md:mx-auto")}>{children}</div>
    </SkeletonRegion>
  );
}

function PageTitle({ eyebrow = false, subtitle = true, action = false }: { eyebrow?: boolean; subtitle?: boolean; action?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {eyebrow ? <SkeletonBar className="h-2.5 w-28" /> : null}
        <SkeletonBar className="h-7 w-[200px] max-w-full md:h-8 md:w-[240px]" />
        {subtitle ? <SkeletonBar className="h-3.5 w-[320px] max-w-full" /> : null}
      </div>
      {action ? <SkeletonBlock className="hidden h-9 w-24 rounded-md md:block" /> : null}
    </div>
  );
}

function BackLink() {
  return <SkeletonBar className="h-3.5 w-24" />;
}

function ListRows({ count = 6, meta = true, className }: { count?: number; meta?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col border-t border-border", className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-2.5 border-b border-muted px-1 py-4">
          <SkeletonBar className={ROW_WIDTHS[index % ROW_WIDTHS.length]} />
          {meta ? <SkeletonBar className="h-2.5 w-[30%]" /> : null}
        </div>
      ))}
    </div>
  );
}

function TextLines({ count = 8 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3.5">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonBar key={index} className={LINE_WIDTHS[index % LINE_WIDTHS.length]} />
      ))}
    </div>
  );
}

/** 업무함(Stann)·오늘(학생): 날짜, 제목, 숫자 줄, 나란한 장부 묶음. */
function WorkQueueSkeleton({ label, sections }: { label: string; sections: number }) {
  return (
    <Frame label={label} top="standard" width={1040} gap="gap-7 md:gap-10">
      <div className="flex flex-col gap-2.5">
        <SkeletonBar className="h-2.5 w-28" />
        <SkeletonBar className="h-7 w-[200px] md:h-9" />
        <div className="mt-3 flex flex-wrap gap-x-7 gap-y-2.5">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex items-center gap-2">
              <SkeletonBar className="h-3 w-14" />
              <SkeletonBar className="h-3 w-5" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-7 md:flex-row md:flex-wrap md:gap-x-14 md:gap-y-10">
        {Array.from({ length: sections }, (_, section) => (
          <div key={section} className="flex flex-col gap-3 md:flex-[1_1_400px]">
            <SkeletonBar className="h-3.5 w-24" />
            <div className="flex flex-col border-t border-border">
              {[0, 1, 2, 3, 4].map((index) => (
                <div key={index} className="flex items-center gap-3 border-b border-muted py-3.5">
                  <SkeletonBar className="h-3 w-10 shrink-0" />
                  <SkeletonBar className={ROW_WIDTHS[(index + section) % ROW_WIDTHS.length]} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** 학생 상세(Stann): 위치, 원 머리글자와 이름, 탭 줄, 탭 내용. */
function StudentDetailSkeleton({ label }: { label: string }) {
  return (
    <Frame label={label} top="detail" width={1080} gap="gap-5 md:gap-7">
      <div className="hidden items-center gap-2 md:flex">
        <SkeletonBar className="h-3 w-8" />
        <SkeletonBar className="h-3 w-20" />
      </div>
      <div className="flex items-center gap-3.5 md:gap-4">
        <SkeletonCircle className="size-12" />
        <div className="flex flex-col gap-2">
          <SkeletonBar className="h-6 w-36" />
          <SkeletonBar className="h-3 w-48" />
        </div>
      </div>
      <div className="flex gap-5 overflow-hidden border-b border-border pb-3">
        {["w-12", "w-14", "w-10", "w-14", "w-12"].map((width, index) => (
          <SkeletonBar key={index} className={cn("h-3.5 shrink-0", width)} />
        ))}
      </div>
      <div className="flex max-w-[880px] flex-col gap-4">
        <SkeletonBar className="h-3.5 w-24" />
        <ListRows count={5} />
      </div>
    </Frame>
  );
}

/** 노트·임시 보관 목록: 제목, 검색칸, 행. */
function RecordListSkeleton({ label, width }: { label: string; width: 880 | 1080 }) {
  return (
    <Frame label={label} top="standard" width={width}>
      <PageTitle action />
      <SkeletonBlock className="h-10 w-full rounded-md md:w-[320px]" />
      <ListRows count={7} />
    </Frame>
  );
}

/** 휴지통·변경 기록(RecordPageFrame): 돌아가기, 제목, 기록 행. */
function HistorySkeleton({ label }: { label: string }) {
  return (
    <Frame label={label} top="detail" width={760} gap="gap-7">
      <BackLink />
      <PageTitle />
      <ListRows count={6} />
    </Frame>
  );
}

/** Q&A·커뮤니티 목록: 제목과 새 글 버튼, 필터 칩, 글 행. */
function ThreadListSkeleton({ label }: { label: string }) {
  return (
    <Frame label={label} top="compact" width={880} gap="gap-5 md:gap-6">
      <PageTitle action />
      <div className="flex gap-2 overflow-hidden">
        {["w-12", "w-16", "w-14", "w-16"].map((width, index) => (
          <SkeletonBlock key={index} className={cn("h-8 shrink-0 rounded-full", width)} />
        ))}
      </div>
      <div className="flex flex-col border-t border-border">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="flex flex-col gap-2.5 border-b border-muted px-1 py-4">
            <SkeletonBar className={ROW_WIDTHS[index % ROW_WIDTHS.length]} />
            <div className="flex gap-3">
              <SkeletonBar className="h-2.5 w-16" />
              <SkeletonBar className="h-2.5 w-20" />
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** 노트·Q&A·게시물 상세: 돌아가기, 제목, 작성자 줄, 본문. */
function DocumentSkeleton({ label }: { label: string }) {
  return (
    <Frame label={label} top="detail" width={760} gap="gap-5">
      <BackLink />
      <SkeletonBar className="h-7 w-[70%] md:h-8" />
      <div className="flex items-center gap-2.5">
        <SkeletonCircle className="size-6" />
        <SkeletonBar className="h-3 w-32" />
      </div>
      <span aria-hidden="true" className="h-px bg-muted" />
      <TextLines count={9} />
    </Frame>
  );
}

/** 새 글·편집: 돌아가기, 제목 입력, 도구 줄, 본문 입력. */
function EditorSkeleton({ label }: { label: string }) {
  return (
    <Frame label={label} top="standard" width={760} gap="gap-5 md:gap-7">
      <BackLink />
      <SkeletonBar className="h-8 w-[50%]" />
      <div className="flex gap-1.5 overflow-hidden">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
          <SkeletonBlock key={index} className="size-7 shrink-0 rounded-md" />
        ))}
      </div>
      <SkeletonBlock className="h-[320px] w-full" />
    </Frame>
  );
}

/** 운영 도구·학생 추가·분류: 제목, 이름표와 입력칸, 버튼. */
function FormSkeleton({ label, width }: { label: string; width: 560 | 760 | 1040 }) {
  return (
    <Frame label={label} top="standard" width={width}>
      <PageTitle />
      <div className="flex flex-col gap-5 border-t border-border pt-6">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex flex-col gap-2">
            <SkeletonBar className="h-3 w-20" />
            <SkeletonBlock className="h-10 w-full rounded-md" />
          </div>
        ))}
        <SkeletonBlock className="h-10 w-28 rounded-md" />
      </div>
    </Frame>
  );
}

/** 디깅: 제목, 플레이리스트 카드 줄, 트랙 보드 열. */
function BoardSkeleton({ label }: { label: string }) {
  return (
    <Frame label={label} top="compact" width={1120} gap="gap-8 md:gap-12">
      <div className="hidden md:block">
        <PageTitle />
      </div>
      <div className="flex flex-col gap-3">
        <SkeletonBar className="h-3.5 w-24" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <SkeletonBlock key={index} className="h-20" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        {[0, 1, 2, 3].map((column) => (
          <div key={column} className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
            <SkeletonBar className="h-3.5 w-20" />
            {Array.from({ length: 3 - (column % 2) }, (_, index) => (
              <SkeletonBlock key={index} className="h-16" />
            ))}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/**
 * 일정(관리자 일정·학생 캘린더): 제목과 보기 전환, 기간 줄, 넓은 화면은 화면 아래까지 채우는 7칸 달력 판,
 * 좁은 화면은 날짜 줄과 일정 목록(MobileCalendar).
 */
function CalendarSkeleton({ label }: { label: string }) {
  return (
    <Frame label={label} top="compact" width="full" gap="gap-5 md:gap-6">
      <div className="hidden items-center gap-3 md:flex">
        <SkeletonBar className="h-8 w-20" />
        <SkeletonBlock className="h-9 w-48 rounded-md" />
        <SkeletonBlock className="ml-auto h-9 w-28 rounded-md" />
      </div>
      <div className="flex items-center gap-3">
        <SkeletonBar className="h-6 w-40" />
        <SkeletonBlock className="h-8 w-16 rounded-md" />
      </div>
      <div className="hidden h-[calc(100dvh-280px)] min-h-[480px] grid-cols-7 overflow-hidden rounded-lg border border-border md:grid">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2 border-r border-border p-2 last:border-r-0">
            <SkeletonBar className="h-3 w-10" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4 md:hidden">
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }, (_, index) => (
            <SkeletonBlock key={index} className="h-12 rounded-md" />
          ))}
        </div>
        <ListRows count={5} />
      </div>
    </Frame>
  );
}

/** 과제 상세: 돌아가기, 제목, 정보 줄, 파형 플레이어, 피드백. */
function AssignmentSkeleton({ label }: { label: string }) {
  return (
    <Frame label={label} top="standard" width={880} gap="gap-5 md:gap-6">
      <BackLink />
      <div className="flex flex-col gap-2.5">
        <SkeletonBar className="h-7 w-[60%] md:h-8" />
        <SkeletonBar className="h-3 w-40" />
      </div>
      <SkeletonBlock className="h-24 w-full" />
      <div className="flex flex-col gap-4 border-t border-border pt-6">
        <SkeletonBar className="h-3.5 w-20" />
        <TextLines count={5} />
      </div>
    </Frame>
  );
}

/** 가이드 목록: 제목, 검색칸, 문서 행. */
function GuideIndexSkeleton({ label }: { label: string }) {
  return (
    <Frame label={label} top="compact" width={720}>
      <PageTitle subtitle={false} />
      <SkeletonBlock className="h-10 w-full rounded-md" />
      <ListRows count={6} />
    </Frame>
  );
}

/** 가이드 문서: 넓은 화면의 왼쪽 목차와 본문. */
function GuidePageSkeleton({ label }: { label: string }) {
  return (
    <Frame label={label} top="compact" width={1120} gap="gap-5 md:flex-row md:gap-12">
      <div className="hidden w-[220px] shrink-0 flex-col gap-3 md:flex">
        {["w-[80%]", "w-[64%]", "w-[72%]", "w-[56%]", "w-[76%]", "w-[60%]"].map((width, index) => (
          <SkeletonBar key={index} className={cn("h-3", width)} />
        ))}
      </div>
      <div className="flex min-w-0 max-w-[760px] flex-1 flex-col gap-5">
        <SkeletonBar className="h-3 w-28" />
        <SkeletonBar className="h-8 w-[60%]" />
        <TextLines count={9} />
      </div>
    </Frame>
  );
}

/** 로그인·가입·새 비밀번호: 로고는 (auth) layout이 이미 그린다. */
function AuthSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="flex flex-col gap-7">
      <div className="flex flex-col gap-2.5">
        <SkeletonBar className="h-7 w-40" />
        <SkeletonBar className="h-3.5 w-56" />
      </div>
      <div className="flex flex-col gap-4">
        {[0, 1].map((index) => (
          <div key={index} className="flex flex-col gap-2">
            <SkeletonBar className="h-3 w-16" />
            <SkeletonBlock className="h-11 w-full rounded-touch md:h-10 md:rounded-md" />
          </div>
        ))}
        <SkeletonBlock className="mt-2 h-11 w-full rounded-touch md:h-10 md:rounded-md" />
      </div>
    </SkeletonRegion>
  );
}

function PrivacySkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="mx-auto flex min-h-[100dvh] w-full max-w-[680px] flex-col gap-5 px-5 py-12">
      <SkeletonBar className="h-8 w-[50%]" />
      <SkeletonBar className="h-3 w-32" />
      <TextLines count={9} />
    </SkeletonRegion>
  );
}

/** route의 loading.tsx와 첫 진입 셸 자리에서 쓰는 화면 모양별 스켈레톤. */
export function RouteSkeleton({ kind, label }: { kind: RouteSkeletonKind; label?: string }) {
  const text = label ?? ROUTE_SKELETON_LABELS[kind];
  switch (kind) {
    case "work-queue":
      return <WorkQueueSkeleton label={text} sections={2} />;
    case "today":
      return <WorkQueueSkeleton label={text} sections={2} />;
    case "student-detail":
      return <StudentDetailSkeleton label={text} />;
    case "record-list":
      return <RecordListSkeleton label={text} width={1080} />;
    case "record-list-narrow":
      return <RecordListSkeleton label={text} width={880} />;
    case "history":
      return <HistorySkeleton label={text} />;
    case "thread-list":
      return <ThreadListSkeleton label={text} />;
    case "document":
      return <DocumentSkeleton label={text} />;
    case "editor":
      return <EditorSkeleton label={text} />;
    case "form":
      return <FormSkeleton label={text} width={760} />;
    case "form-narrow":
      return <FormSkeleton label={text} width={560} />;
    case "form-wide":
      return <FormSkeleton label={text} width={1040} />;
    case "board":
      return <BoardSkeleton label={text} />;
    case "assignment":
      return <AssignmentSkeleton label={text} />;
    case "calendar":
      return <CalendarSkeleton label={text} />;
    case "guide-index":
      return <GuideIndexSkeleton label={text} />;
    case "guide-page":
      return <GuidePageSkeleton label={text} />;
    case "auth":
      return <AuthSkeleton label={text} />;
    case "privacy":
      return <PrivacySkeleton label={text} />;
    case "generic":
      return <RouteLoadingState label={text} />;
  }
}
