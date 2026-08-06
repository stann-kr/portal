/**
 * @file src/components/admin-portal/AdminSideRail.tsx
 * @description 어드민 원페이지 전용 56px 아이콘 레일.
 * 로고 + 역할 표시 + 로그아웃 버튼.
 */
import Link from "next/link";
import { LogOut } from "lucide-react";
import { signOut } from "@/auth";

export function AdminSideRail() {
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

      {/* 로그아웃 */}
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="로그아웃"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </form>
    </aside>
  );
}
