"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  APP_NAV_ITEMS,
  navigateWithinPage,
  resolveActiveNavItem,
  type AppRole,
} from "./navigation";

function SidebarNav({ role, onNavigate }: { role: AppRole; onNavigate?: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeId = resolveActiveNavItem(role, {
    pathname: pathname ?? "",
    searchParams: new URLSearchParams(searchParams?.toString() ?? ""),
  });

  return (
    <nav aria-label="주요 메뉴" className="flex flex-col gap-0.5">
      {APP_NAV_ITEMS[role].map(({ id, label, href, Icon }) => {
        const active = id === activeId;
        return (
          <Link
            key={id}
            href={href}
            aria-current={active ? "page" : undefined}
            onClick={(event) => {
              onNavigate?.();
              if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              if (navigateWithinPage(href)) event.preventDefault();
            }}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarBody({
  role,
  displayName,
  accountTools,
  onNavigate,
}: {
  role: AppRole;
  displayName: string;
  accountTools: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-4 px-2 py-3">
      <Link
        href="/"
        onClick={onNavigate}
        className="flex items-center gap-2 rounded-md px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-[11px] font-bold text-background" aria-hidden="true">
          SL
        </span>
        <span className="truncate text-sm font-semibold">Stann Lumo</span>
      </Link>
      <SidebarNav role={role} onNavigate={onNavigate} />
      <div className="mt-auto space-y-2 border-t border-border pt-3">
        <p className="truncate px-2 text-sm">
          <span className="font-medium text-foreground">{displayName}</span>
          <span className="ml-1.5 text-xs text-muted-foreground">{role === "admin" ? "관리자" : "학생"}</span>
        </p>
        <div className="flex items-center gap-1 px-1" role="group" aria-label="계정">
          {accountTools}
        </div>
      </div>
    </div>
  );
}

/**
 * 로그인한 모든 화면의 왼쪽 사이드바. 넓은 화면에서는 항상 보이고, 좁은 화면에서는 위쪽 막대의
 * 메뉴 버튼으로 연다. 계정 도구(초안·비밀번호·로그아웃)는 서버가 정한 요소를 그대로 받는다.
 */
export function AppSidebar({
  role,
  displayName,
  accountTools,
}: {
  role: AppRole;
  displayName: string;
  accountTools: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <aside
        aria-label="사이드바"
        className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 border-r border-border bg-muted/30 md:block"
      >
        <SidebarBody role={role} displayName={displayName} accountTools={accountTools} />
      </aside>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur-sm md:hidden">
          <Dialog.Trigger
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="메뉴 열기"
          >
            <Menu className="size-5" aria-hidden="true" />
          </Dialog.Trigger>
          <span className="truncate text-sm font-semibold">Stann Lumo</span>
        </div>
        <Dialog.Portal>
          <Dialog.Overlay className="portal-backdrop fixed inset-0 z-40 bg-black/30" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border bg-background shadow-lg focus:outline-none"
          >
            <Dialog.Title className="sr-only">메뉴</Dialog.Title>
            <Dialog.Close
              className="absolute right-2 top-3 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="메뉴 닫기"
            >
              <X className="size-4" aria-hidden="true" />
            </Dialog.Close>
            <SidebarBody
              role={role}
              displayName={displayName}
              accountTools={accountTools}
              onNavigate={() => setOpen(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
