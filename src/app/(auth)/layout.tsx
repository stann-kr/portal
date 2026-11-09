import type { ReactNode } from "react";
import { PortalLogoMark } from "@/components/brand/PortalLogoMark";

/**
 * 로그인·가입 링크·새 비밀번호 설정의 공통 화면(캔버스 Login·Invite·AccountPassword와 각 Mobile 보드).
 * 카드 없이 흰 바탕 가운데 360px 열에 로고를 두고, 그 아래를 각 화면이 채운다.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5 pb-[calc(2.125rem+env(safe-area-inset-bottom))] pt-12 md:py-12">
      <div className="flex w-full max-w-[360px] flex-col gap-4">
        <PortalLogoMark size={36} />
        {children}
      </div>
    </div>
  );
}
