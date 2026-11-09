"use client";

import { PortalLogoMark } from "@/components/brand/PortalLogoMark";
import { PortalWordmark } from "@/components/brand/PortalWordmark";
import React from "react";
import { usePathname } from "next/navigation";
import { SkeletonBar, SkeletonCircle } from "@/components/ui/skeleton";
import { RouteSkeleton } from "@/components/ui/route-skeletons";
import { resolveRouteSkeletonKind } from "@/components/ui/route-skeleton-kind";

/**
 * 첫 진입·새로고침 때 계정 확인과 업무 건수를 기다리는 동안 보이는 셸 자리 스켈레톤.
 * 사이드바(넓은 화면)·위쪽 막대(좁은 화면) 자리와 주소에 맞는 본문 모양을 함께 그린다.
 * 화면 읽기 프로그램에는 본문 스켈레톤의 "불러오는 중" 한 번만 알린다.
 */
export function AppShellSkeleton() {
  const kind = resolveRouteSkeletonKind(usePathname() ?? "");
  return (
    <>
      <div
        aria-hidden="true"
        className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col gap-6 border-r border-border bg-sidebar px-3 py-4 md:flex"
      >
        {/* 상표는 계정과 무관해 실제와 같게 그린다. 커뮤니티↔대시보드처럼 셸이 바뀌는 이동에서 덜 깜빡인다. */}
        <div className="flex items-center gap-2.5 px-2 py-1">
          <PortalLogoMark size={24} className="shrink-0" />
          <PortalWordmark className="text-sm" />
        </div>
        <div className="flex flex-col gap-0.5">
          {["w-16", "w-12", "w-20", "w-14", "w-16", "w-12"].map((width, index) => (
            <div key={index} className="flex h-8 items-center gap-2.5 px-2">
              <SkeletonBar className="size-4" />
              <SkeletonBar className={`h-3 ${width}`} />
            </div>
          ))}
        </div>
        <div className="mt-auto flex items-center gap-2.5 border-t border-border p-2">
          <SkeletonCircle className="size-7" />
          <SkeletonBar className="h-3 w-16" />
        </div>
      </div>
      <div
        aria-hidden="true"
        className="sticky top-0 z-30 flex h-[3.25rem] shrink-0 items-center justify-between gap-1 border-b border-muted bg-background px-1 md:hidden"
      >
        <span className="flex size-11 items-center justify-center">
          <SkeletonBar className="size-5" />
        </span>
        <SkeletonBar className="h-4 w-24" />
        <span className="size-11" />
      </div>
      <div className="min-w-0 flex-1">
        <RouteSkeleton kind={kind} />
      </div>
    </>
  );
}
