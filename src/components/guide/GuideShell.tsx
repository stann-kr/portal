"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { GuidePageNav, type GuideNavPage } from "./GuidePageNav";

const GUIDE_ROOT = "/dashboard/guide";

/** 지금 주소가 가리키는 가이드 페이지 id. 첫 화면(`/dashboard/guide`)은 첫 페이지를 그린다. */
export function currentGuidePageId(pathname: string, pages: readonly GuideNavPage[]): string | null {
  const path = pathname.replace(/\/+$/u, "");
  if (path === GUIDE_ROOT) return pages[0]?.id ?? null;
  const match = /^\/dashboard\/guide\/([^/]+)$/u.exec(path);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** 편집 화면은 자기 틀(전체 편집기)을 쓰므로 목차를 두지 않는다. */
export function isGuideEditPath(pathname: string): boolean {
  return /^\/dashboard\/guide\/[^/]+\/edit\/?$/u.test(pathname);
}

/**
 * 가이드 읽기 화면의 틀: 넓은 화면은 [목차 | 본문], 좁은 화면은 본문 위 목차 줄.
 * 페이지가 없거나 편집 화면이면 틀 없이 그대로 그린다(빈 화면·편집기는 자기 여백을 가진다).
 */
export function GuideShell({ pages, canManage, children }: { pages: readonly GuideNavPage[]; canManage: boolean; children: ReactNode }) {
  const pathname = usePathname() ?? GUIDE_ROOT;
  if (pages.length === 0 || isGuideEditPath(pathname)) return <>{children}</>;
  return (
    <div className="px-5 pb-8 pt-4 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <div className="flex max-w-[1120px] flex-col gap-5 md:flex-row md:gap-12 md:mx-auto">
        <GuidePageNav pages={pages} currentId={currentGuidePageId(pathname, pages)} canManage={canManage} />
        <div className="flex min-w-0 max-w-[760px] flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
