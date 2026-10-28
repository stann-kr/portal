import { CalendarSyncSettings } from "@/components/admin/calendar-sync/CalendarSyncSettings";
import { getCalendarSyncOverview } from "@/lib/actions/calendarSync";
import { parseGoogleOAuthResult } from "@/lib/calendar-sync/google-oauth-result";

// 연결 상태·오류·매핑은 요청마다 새로 읽는다.
export const dynamic = "force-dynamic";

export const metadata = { title: "캘린더 동기화" };

/**
 * 관리자 캘린더 동기화 설정(CALENDAR_SYNC_ADMIN_PATH). 관리자 확인은 admin layout이 하고,
 * Google OAuth callback 결과(`google`·`message`)는 고정 code로만 해석해 넘긴다.
 */
export default async function AdminCalendarSyncPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, overview] = await Promise.all([searchParams, getCalendarSyncOverview()]);
  const result = parseGoogleOAuthResult(params.google, params.message);

  return (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <div className="flex max-w-[760px] flex-col gap-6 md:gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-mobile-title font-semibold tracking-display text-foreground md:text-display">캘린더 동기화</h1>
          <p className="text-body text-secondary-foreground">
            Google·iCloud 캘린더를 학생별로 연결해 포털 레슨·일정과 양쪽으로 맞춥니다.
          </p>
        </header>
        <CalendarSyncSettings overview={overview} result={result} />
      </div>
    </div>
  );
}
