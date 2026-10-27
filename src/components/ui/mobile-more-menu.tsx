/**
 * @file src/components/ui/mobile-more-menu.tsx
 * @description 좁은 화면 위쪽 막대 오른쪽의 … 메뉴(MobileQnaThread "더 보기", MobileCommunityPost "게시물 메뉴").
 * 넓은 화면 머리에 있던 이력·수정·휴지통 같은 조작을 44×44 버튼 하나로 모은다.
 * 고른 동작은 메뉴의 focus scope가 끝난 뒤 실행해, 이어서 열리는 확인 영역이 초점을 받게 한다.
 */
"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type MobileMoreMenuItem = {
  key: string;
  label: string;
  Icon?: LucideIcon;
  /** 이동 항목 */
  href?: string;
  /** 실행 항목. trigger는 확인 영역을 닫을 때 초점이 돌아갈 메뉴 버튼이다. */
  onSelect?: (trigger: HTMLElement | null) => void;
  destructive?: boolean;
  disabled?: boolean;
};

const ITEM_CLASS =
  "flex h-11 w-full cursor-default select-none items-center gap-3 rounded-touch px-3 text-md text-foreground outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted";

export function MobileMoreMenu({
  label,
  items,
  disabled = false,
}: {
  /** 메뉴 버튼의 접근 가능한 이름(예: 더 보기, 게시물 메뉴) */
  label: string;
  items: readonly MobileMoreMenuItem[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef<MobileMoreMenuItem["onSelect"] | null>(null);

  if (items.length === 0) return null;

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button
          ref={triggerRef}
          type="button"
          aria-label={label}
          className="flex size-11 shrink-0 items-center justify-center rounded-touch text-secondary-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=open]:bg-muted data-[state=open]:text-foreground"
        >
          <Ellipsis className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          style={{ zIndex: "var(--z-dropdown)" }}
          className="portal-menu w-56 rounded-lg border border-border bg-background p-1 shadow-floating"
          onCloseAutoFocus={(event) => {
            const action = pendingRef.current;
            pendingRef.current = null;
            if (!action) return;
            event.preventDefault();
            triggerRef.current?.focus({ preventScroll: true });
            action(triggerRef.current);
          }}
        >
          {items.map(({ key, label: itemLabel, Icon, href, onSelect, destructive, disabled: itemDisabled }) => {
            const content = (
              <>
                {Icon ? <Icon className={cn("size-4", destructive ? undefined : "text-secondary-foreground")} strokeWidth={1.6} aria-hidden="true" /> : null}
                {itemLabel}
              </>
            );
            const className = cn(ITEM_CLASS, destructive && "text-destructive");
            if (href) {
              return (
                <DropdownMenu.Item key={key} asChild disabled={itemDisabled} className={className}>
                  <Link href={href}>{content}</Link>
                </DropdownMenu.Item>
              );
            }
            return (
              <DropdownMenu.Item
                key={key}
                disabled={itemDisabled}
                className={className}
                onSelect={() => {
                  pendingRef.current = onSelect ?? null;
                  setOpen(false);
                }}
              >
                {content}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
