import { MediaCleanupControl } from "@/components/admin-portal/MediaCleanupControl";
import { AccountErasureCleanupControl } from "@/components/admin-portal/AccountErasureCleanupControl";

export const metadata = { title: "관리자 운영 도구" };

/**
 * 관리자 운영 도구(캔버스 AdminOps·MobileAdminOps). 좁은 화면 위쪽 막대(메뉴·"운영 도구")는 셸이 주소로 정한다.
 */
export default function AdminOperationsPage() {
  return (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <div className="flex max-w-[760px] flex-col gap-6 md:gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-mobile-title font-semibold tracking-display text-foreground md:text-display">운영 도구</h1>
          <p className="text-body text-secondary-foreground">
            일상 업무와 분리된 유지보수 작업입니다. 실행하면 되돌릴 수 없으니 확인 후 진행하세요.
          </p>
        </header>
        <div className="flex flex-col border-t border-border">
          <MediaCleanupControl />
          <AccountErasureCleanupControl />
        </div>
      </div>
    </div>
  );
}
