"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { navigateWithinPage } from "@/components/app-shell/navigation";

/**
 * 같은 포탈 화면의 다른 구역(`?section=`·`?view=`)으로 가는 링크.
 * 사이드바와 같이 history만 바꿔 구역을 전환하고, 새 탭·수정 키 클릭은 일반 링크로 둔다.
 */
export function WithinPageLink({ href, onClick, ...props }: ComponentProps<typeof Link> & { href: string }) {
  return (
    <Link
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (navigateWithinPage(href)) event.preventDefault();
      }}
      {...props}
    />
  );
}
