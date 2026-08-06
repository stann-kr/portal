/**
 * @file src/components/student-portal/StudentSideRail.tsx
 * @description 학생 원페이지 전용 56px 아이콘 레일.
 * 로고 + 로그아웃 버튼만 포함. 섹션 네비게이션은 StudentPortalClient 내부 탭으로 처리.
 */
import Link from "next/link";
import { LogOut } from "lucide-react";
import { signOut } from "@/auth";

export function StudentSideRail() {
  return (
    <aside
      aria-label="학생 포털 도구"
      className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-border bg-muted/30 py-3 sm:w-14"
    >
      {/* 브랜드 로고 */}
      <Link
        href="/"
        className="w-9 h-9 rounded-lg bg-foreground text-background flex items-center justify-center text-xs font-bold tracking-tight hover:opacity-80 transition-opacity"
        aria-label="Stann Lumo 홈"
      >
        SL
      </Link>

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
