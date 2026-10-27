"use client";

import { useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis, FileText, KeyRound, LogOut, Trash2 } from "lucide-react";
import { AccountDeletionControl } from "@/components/auth/AccountDeletionControl";
import { LocalDraftManager, type AccountDialogHandle } from "@/components/auth/LocalDraftManager";
import { PasswordChangeControl } from "@/components/auth/PasswordChangeControl";
import { useLogoutSubmit } from "@/components/auth/useLogoutSubmit";
import { logoutCurrentUser } from "@/lib/actions/session";
import { cn } from "@/lib/utils";

type MenuChoice = "drafts" | "password" | "delete" | "logout";

// 데스크톱 36px 행, 메뉴 서랍(좁은 화면)에서는 누르는 곳 44px.
const ITEM_CLASS =
  "flex h-11 w-full cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-ui text-foreground outline-none data-[highlighted]:bg-muted md:h-9";

/**
 * 사이드바 아래 계정 줄의 … 메뉴(AccountDialogs 보드): 이 기기의 초안, 비밀번호 변경, (학생) 계정 삭제, 로그아웃.
 * 메뉴의 focus scope가 끝난 뒤 고른 대화상자를 연다. 대화상자는 메뉴 밖에 두어 메뉴가 닫혀도 남는다.
 */
export function AccountMenu({
  ownerId,
  canDeleteAccount,
  size = "md",
}: {
  ownerId: string;
  canDeleteAccount: boolean;
  /** md: 데스크톱 32×32, touch: 모바일 서랍 44×44 */
  size?: "md" | "touch";
}) {
  const [open, setOpen] = useState(false);
  // 로그아웃 요청을 한 번만 보낸다(이전 로그아웃 버튼의 제출 중 비활성과 같은 역할).
  const [loggingOut, setLoggingOut] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingChoice = useRef<MenuChoice | null>(null);
  const draftsRef = useRef<AccountDialogHandle>(null);
  const passwordRef = useRef<AccountDialogHandle>(null);
  const deleteRef = useRef<AccountDialogHandle>(null);
  const logoutFormRef = useRef<HTMLFormElement>(null);
  // 서버 초안 폐기 요청을 먼저 보낸 뒤(최대 3초) 로컬 초안을 지우고 로그아웃한다.
  const { onSubmit: onLogoutSubmit } = useLogoutSubmit(ownerId);

  const choose = (choice: MenuChoice) => {
    pendingChoice.current = choice;
    setOpen(false);
  };

  const handleCloseAutoFocus = (event: Event) => {
    const choice = pendingChoice.current;
    pendingChoice.current = null;
    if (!choice) return;
    event.preventDefault();
    triggerRef.current?.focus({ preventScroll: true });
    if (choice === "drafts") draftsRef.current?.open();
    if (choice === "password") passwordRef.current?.open();
    if (choice === "delete") deleteRef.current?.open();
    if (choice === "logout" && !loggingOut) {
      setLoggingOut(true);
      logoutFormRef.current?.requestSubmit();
    }
  };

  return (
    <>
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label="계정 메뉴"
            className={cn(
              "flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-selected hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-selected data-[state=open]:text-foreground",
              size === "touch" ? "size-11 rounded-touch" : "size-8 rounded-md",
            )}
          >
            <Ellipsis className={size === "touch" ? "size-[18px]" : "size-4"} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align={size === "touch" ? "end" : "start"}
            sideOffset={6}
            collisionPadding={12}
            onCloseAutoFocus={handleCloseAutoFocus}
            style={{ zIndex: "var(--z-dropdown)" }}
            className="portal-menu w-56 rounded-lg border border-border bg-background p-1 shadow-floating"
          >
            <DropdownMenu.Item className={ITEM_CLASS} onSelect={() => choose("drafts")}>
              <FileText className="size-4 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
              이 기기의 초안
            </DropdownMenu.Item>
            <DropdownMenu.Item className={ITEM_CLASS} onSelect={() => choose("password")}>
              <KeyRound className="size-4 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
              비밀번호 변경
            </DropdownMenu.Item>
            {canDeleteAccount ? (
              <DropdownMenu.Item className={cn(ITEM_CLASS, "text-destructive")} onSelect={() => choose("delete")}>
                <Trash2 className="size-4" strokeWidth={1.6} aria-hidden="true" />
                계정 삭제
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Separator className="mx-0 my-1 h-px bg-muted" />
            <DropdownMenu.Item className={cn(ITEM_CLASS, "data-[disabled]:opacity-50")} disabled={loggingOut} onSelect={() => choose("logout")}>
              <LogOut className="size-4 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
              {loggingOut ? "로그아웃 중" : "로그아웃"}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <LocalDraftManager ownerId={ownerId} controlRef={draftsRef} hideTrigger />
      <PasswordChangeControl controlRef={passwordRef} hideTrigger />
      {canDeleteAccount ? <AccountDeletionControl ownerId={ownerId} controlRef={deleteRef} hideTrigger /> : null}
      <form ref={logoutFormRef} action={logoutCurrentUser} onSubmit={onLogoutSubmit} hidden />
    </>
  );
}
