import Link from "next/link";
import { MediaCleanupControl } from "@/components/admin-portal/MediaCleanupControl";
import { AccountErasureCleanupControl } from "@/components/admin-portal/AccountErasureCleanupControl";
import { buttonClassName } from "@/components/ui/button";
import { CALENDAR_SYNC_ADMIN_PATH } from "@/lib/calendar-sync/google-oauth-result";

// AccountErasureCleanupControl의 OPERATION_* 줄 class와 같은 값. 그 파일은 client module이라 server page에서 상수를 import하지 않는다.
const ROW_CLASS = "flex flex-col gap-3 border-b border-muted py-5 md:flex-row md:flex-wrap md:items-center md:gap-4 md:px-1 md:py-6";
const TEXT_CLASS = "flex min-w-0 flex-col gap-1 md:flex-[1_1_360px]";
const TITLE_CLASS = "text-md font-semibold text-foreground";
const DESCRIPTION_CLASS = "text-body text-secondary-foreground md:text-ui";
const TRIGGER_CLASS = "h-11 w-full rounded-touch text-body md:h-8 md:w-auto md:rounded-md md:text-ui";

export const metadata = { title: "관리자 운영 도구" };

/**
 * 관리자 운영 도구(캔버스 AdminOps·MobileAdminOps). 좁은 화면 위쪽 막대(메뉴·"운영 도구")는 셸이 주소로 정한다.
 * 외부 캘린더 연동 설정은 별도 화면이고, 여기에는 그 화면으로 가는 줄만 둔다.
 */
export default function AdminOperationsPage() {
  return (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <div className="flex max-w-[760px] flex-col gap-6 md:gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-mobile-title font-semibold tracking-display text-foreground md:text-display">운영 도구</h1>
          <p className="text-body text-secondary-foreground">
            일상 업무와 분리된 연동 설정과 유지보수 작업입니다. 유지보수 작업은 실행하면 되돌릴 수 없으니 확인 후 진행하세요.
          </p>
        </header>
        <div className="flex flex-col border-t border-border">
          <section aria-labelledby="calendar-sync-link-heading" className={ROW_CLASS}>
            <div className={TEXT_CLASS}>
              <h2 id="calendar-sync-link-heading" className={TITLE_CLASS}>
                캘린더 동기화
              </h2>
              <p id="calendar-sync-link-description" className={DESCRIPTION_CLASS}>
                Google·iCloud 캘린더 계정을 연결하고 학생별로 동기화할 캘린더를 정합니다.
              </p>
            </div>
            <Link
              href={CALENDAR_SYNC_ADMIN_PATH}
              aria-describedby="calendar-sync-link-description"
              className={buttonClassName({ variant: "outline", className: TRIGGER_CLASS })}
            >
              설정 열기
            </Link>
          </section>
          <MediaCleanupControl />
          <AccountErasureCleanupControl />
        </div>
      </div>
    </div>
  );
}
