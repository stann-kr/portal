/**
 * @file src/components/admin-portal/AdminSideRail.tsx
 * @description 어드민 원페이지 전용 56px 아이콘 레일.
 * 로고 + 역할 표시 + 기기 초안 관리 + 비밀번호 변경 + 로그아웃 버튼.
 */
import Link from "next/link";
import { AccountLogoutButton } from "@/components/auth/AccountLogoutButton";
import { LocalDraftManager } from "@/components/auth/LocalDraftManager";
import { PasswordChangeControl } from "@/components/auth/PasswordChangeControl";

export function AdminSideRail({ ownerId }: { ownerId: string }) {
  return (
    <aside
      aria-label="관리자 포털 도구"
      className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-border bg-muted/30 py-3 sm:w-14"
    >
      {/* 브랜드 로고 */}
      <Link
        href="/"
        className="w-9 h-9 rounded-lg bg-foreground text-background flex items-center justify-center text-xs font-bold tracking-tight hover:opacity-80 transition-opacity"
        aria-label="Stann Lumo 관리자 홈"
      >
        SL
      </Link>

      {/* 관리자 표시 */}
      <div
        className="w-9 h-5 rounded flex items-center justify-center"
      >
        <span aria-hidden="true" className="text-[9px] font-bold text-muted-foreground tracking-wider uppercase">
          ADM
        </span>
        <span className="sr-only">관리자 역할</span>
      </div>

      <div className="flex-1" />

      <LocalDraftManager ownerId={ownerId} />
      <PasswordChangeControl />
      <AccountLogoutButton ownerId={ownerId} />
    </aside>
  );
}
