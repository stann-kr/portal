"use client";

import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { buildQnaListHref } from "@/lib/qna-routes";
import type { QnaFilterTab } from "@/lib/qna-status";
import { useQnaListFilter } from "./qna-list-filter";

type ListContext = { path: string; parentReturnTo: string; filter: QnaFilterTab; search: string };

function useContextHref({ path, parentReturnTo, filter, search }: ListContext) {
  const current = useQnaListFilter(filter);
  return `${path}?returnTo=${encodeURIComponent(buildQnaListHref(parentReturnTo, current, search))}`;
}

/** Q&A 목록 머리의 휴지통·새 질문 링크. 화면 안에서 바꾼 상태 탭까지 복귀 문맥에 싣는다. */
export function QnaListContextLink({ path, parentReturnTo, filter, search, ...props }: ListContext & Omit<ComponentPropsWithoutRef<typeof Link>, "href">) {
  return <Link {...props} href={useContextHref({ path, parentReturnTo, filter, search })} />;
}

/** 좁은 화면 위쪽 막대의 새 질문(+)도 같은 문맥으로. */
export function QnaListTopBar({ title, newQuestion, ...context }: Omit<ListContext, "path"> & { title: string; newQuestion: boolean }) {
  const href = useContextHref({ ...context, path: "/dashboard/qna/new" });
  return <MobileTopBar title={title} action={newQuestion ? { href, label: "새 질문" } : undefined} />;
}
