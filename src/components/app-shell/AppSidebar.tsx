"use client";

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, Menu, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./AccountMenu";
import {
  APP_NAV_ITEMS,
  navigateWithinPage,
  resolveActiveNavItem,
  resolveMobileTopBar,
  type AppRole,
  type MobileTopBarConfig,
} from "./navigation";

type TopBarOverride = Partial<Omit<MobileTopBarConfig, "action">> & {
  /** 주소 기본 행동을 바꾼다. null이면 이 화면에서는 오른쪽 + 행동을 숨긴다. */
  action?: MobileTopBarConfig["action"] | null;
  /** 위쪽 막대 오른쪽에 화면이 직접 두는 조작(더 보기 메뉴·저장 상태 등). */
  actions?: ReactNode;
  /** 제목 자리를 비우고 오른쪽 조작만 둘 때(노트 편집처럼) true. */
  hideTitle?: boolean;
};

const TopBarContext = createContext<((override: TopBarOverride | null) => void) | null>(null);

/**
 * 화면이 좁은 화면 위쪽 막대의 제목·뒤로·오른쪽 조작을 덮어쓴다. 넓은 화면에서는 아무것도 그리지 않는다.
 * 서버 렌더링 때는 주소에서 정한 기본값이 보이고, 연결된 뒤 이 값으로 바뀐다.
 */
export function MobileTopBar(props: TopBarOverride) {
  const setOverride = useContext(TopBarContext);
  const { title, back, action, actions, hideTitle } = props;
  const backHref = back?.href;
  const backLabel = back?.label;
  const actionHref = action?.href;
  const actionLabel = action?.label;
  const actionHidden = action === null;
  useLayoutEffect(() => {
    if (!setOverride) return;
    setOverride({
      title,
      back: backHref && backLabel ? { href: backHref, label: backLabel } : undefined,
      action: actionHidden ? null : actionHref && actionLabel ? { href: actionHref, label: actionLabel } : undefined,
      actions,
      hideTitle,
    });
  }, [setOverride, title, backHref, backLabel, actionHidden, actionHref, actionLabel, actions, hideTitle]);
  useLayoutEffect(() => () => setOverride?.(null), [setOverride]);
  return null;
}

function useLocation() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  return { pathname, searchParams: new URLSearchParams(searchParams?.toString() ?? "") };
}

function handleWithinPageClick(event: React.MouseEvent<HTMLAnchorElement>, href: string, onNavigate?: () => void) {
  onNavigate?.();
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (navigateWithinPage(href)) event.preventDefault();
}

function SidebarNav({ role, variant, onNavigate }: { role: AppRole; variant: "desktop" | "drawer"; onNavigate?: () => void }) {
  const location = useLocation();
  const activeId = resolveActiveNavItem(role, location);

  return (
    <nav aria-label="주요 메뉴" className={cn("flex flex-col gap-0.5", variant === "drawer" && "mt-3")}>
      {APP_NAV_ITEMS[role].map(({ id, label, href, Icon }) => {
        const active = id === activeId;
        return (
          <Link
            key={id}
            href={href}
            aria-current={active ? "page" : undefined}
            onClick={(event) => handleWithinPageClick(event, href, onNavigate)}
            className={cn(
              "flex items-center transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              variant === "desktop"
                ? "h-8 gap-2.5 rounded-md px-2 text-sm"
                : "h-11 gap-3 rounded-touch px-3 text-md",
              active
                ? cn("font-medium text-foreground", variant === "desktop" ? "bg-selected" : "bg-muted")
                : "text-secondary-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AccountRow({
  role,
  displayName,
  ownerId,
  canDeleteAccount,
  variant,
}: {
  role: AppRole;
  displayName: string;
  ownerId: string;
  canDeleteAccount: boolean;
  variant: "desktop" | "drawer";
}) {
  const initial = Array.from(displayName.trim())[0] ?? (role === "admin" ? "관" : "학");
  return (
    <div
      className={cn(
        "mt-auto flex items-center",
        variant === "desktop" ? "gap-2.5 border-t border-border p-2" : "gap-3 border-t border-muted pl-2 pt-3",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-selected font-semibold text-secondary-foreground",
          variant === "desktop" ? "size-7 text-xs" : "size-8 text-ui",
        )}
      >
        {initial}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate font-medium", variant === "desktop" ? "text-ui" : "text-sm")}>{displayName}</span>
        <span className="text-xs text-muted-foreground">{role === "admin" ? "관리자" : "학생"}</span>
      </span>
      <AccountMenu ownerId={ownerId} canDeleteAccount={canDeleteAccount} size={variant === "desktop" ? "md" : "touch"} />
    </div>
  );
}

function Brand({ size, onNavigate }: { size: "desktop" | "drawer"; onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        size === "desktop" ? "px-2 py-1" : "h-[3.25rem] pl-2",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-md bg-foreground text-[11px] font-semibold tracking-display text-background",
          size === "desktop" ? "size-6" : "size-7",
        )}
      >
        SL
      </span>
      <span className={cn("truncate font-semibold tracking-title", size === "desktop" ? "text-sm" : "text-md")}>Stann Lumo</span>
    </Link>
  );
}

const TOPBAR_BUTTON =
  "flex size-11 shrink-0 items-center justify-center rounded-touch text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * 로그인한 모든 화면의 골격(Sidebar·MobileSpec·MobileMenu 보드). 넓은 화면은 240px 사이드바,
 * 좁은 화면은 52px 위쪽 막대와 왼쪽에서 열리는 280px 메뉴 서랍이다.
 */
export function AppSidebar({
  role,
  displayName,
  ownerId,
  canDeleteAccount,
  children,
}: {
  role: AppRole;
  displayName: string;
  ownerId: string;
  canDeleteAccount: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [override, setOverride] = useState<TopBarOverride | null>(null);
  const location = useLocation();
  const pathname = location.pathname;

  // 경로가 바뀌면(메뉴 링크로 이동하면) 모바일 메뉴를 닫는다. 렌더 중 이전 경로와 비교해 바로 맞춘다.
  const [openedPathname, setOpenedPathname] = useState(pathname);
  if (openedPathname !== pathname) {
    setOpenedPathname(pathname);
    setOpen(false);
  }

  const routeTopBar = resolveMobileTopBar(role, location);
  const title = override?.title ?? routeTopBar.title;
  const back = override?.back ?? routeTopBar.back;
  const action = override?.action === null ? undefined : override?.action ?? routeTopBar.action;

  return (
    <TopBarContext.Provider value={setOverride}>
      <aside
        aria-label="사이드바"
        className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col gap-6 border-r border-border bg-sidebar px-3 py-4 md:flex"
      >
        <Brand size="desktop" />
        <SidebarNav role={role} variant="desktop" />
        <AccountRow role={role} displayName={displayName} ownerId={ownerId} canDeleteAccount={canDeleteAccount} variant="desktop" />
      </aside>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <header className="sticky top-0 z-30 flex h-[3.25rem] shrink-0 items-center justify-between gap-1 border-b border-muted bg-background px-1 md:hidden">
          {back ? (
            <Link
              href={back.href}
              aria-label={back.label}
              onClick={(event) => handleWithinPageClick(event, back.href)}
              className={TOPBAR_BUTTON}
            >
              <ChevronLeft className="size-5" strokeWidth={1.6} aria-hidden="true" />
            </Link>
          ) : (
            <Dialog.Trigger className={TOPBAR_BUTTON} aria-label="메뉴 열기">
              <Menu className="size-5" strokeWidth={1.6} aria-hidden="true" />
            </Dialog.Trigger>
          )}
          {override?.hideTitle ? null : <span className="min-w-0 truncate text-md font-semibold">{title}</span>}
          <div className={cn("flex min-w-11 items-center justify-end", override?.hideTitle && "flex-1")}>
            {override?.actions}
            {action ? (
              <Link
                href={action.href}
                aria-label={action.label}
                onClick={(event) => handleWithinPageClick(event, action.href)}
                className={TOPBAR_BUTTON}
              >
                <Plus className="size-5" strokeWidth={1.6} aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </header>
        <Dialog.Portal>
          <Dialog.Overlay className="portal-backdrop fixed inset-0 z-40 bg-scrim" />
          <Dialog.Content
            aria-describedby={undefined}
            className="portal-drawer fixed inset-y-0 left-0 z-50 flex w-70 max-w-[85vw] flex-col border-r border-border bg-background px-3 pb-[calc(2.125rem+env(safe-area-inset-bottom))] pt-1 shadow-drawer focus:outline-none"
          >
            <Dialog.Title className="sr-only">메뉴</Dialog.Title>
            <div className="flex items-center justify-between">
              <Brand size="drawer" onNavigate={() => setOpen(false)} />
              <Dialog.Close
                aria-label="메뉴 닫기"
                className="-mr-1 flex size-11 items-center justify-center rounded-touch text-secondary-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
              </Dialog.Close>
            </div>
            <SidebarNav role={role} variant="drawer" onNavigate={() => setOpen(false)} />
            <AccountRow role={role} displayName={displayName} ownerId={ownerId} canDeleteAccount={canDeleteAccount} variant="drawer" />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="min-w-0 flex-1">{children}</div>
    </TopBarContext.Provider>
  );
}
