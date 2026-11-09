"use client";

import React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { resolveRouteSkeletonKind } from "./route-skeleton-kind";
import { RouteSkeleton } from "./route-skeletons";

/**
 * 주소의 query(`?section=`·`?view=`)까지 보고 모양을 고르는 스켈레톤. 같은 page가 여러 화면을 그리는
 * 포탈 첫 화면(관리자·학생)의 loading.tsx가 쓴다. 이동 중에도 주소는 새 화면의 것이다.
 */
export function SectionRouteSkeleton() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  return <RouteSkeleton kind={resolveRouteSkeletonKind(pathname, searchParams?.toString() ?? "")} />;
}
