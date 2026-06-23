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
    <aside className="w-14 shrink-0 border-r border-border bg-muted/30 flex flex-col items-center py-3 gap-2">
      {/* 브랜드 로고 */}
      <Link
        href="/"
        className="w-9 h-9 rounded-lg bg-foreground text-background flex items-center justify-center text-xs font-bold tracking-tight hover:opacity-80 transition-opacity"
        title="Stann Lumo Portal — Admin"
      >
        SL
      </Link>

      {/* 관리자 표시 */}
      <div
        className="w-9 h-5 rounded flex items-center justify-center"
        title="Admin"
      >
        <span className="text-[9px] font-bold text-muted-foreground tracking-wider uppercase">
          ADM
        </span>
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
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </form>
    </aside>
  );
}
