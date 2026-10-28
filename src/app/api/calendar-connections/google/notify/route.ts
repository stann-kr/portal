import { createDbContext } from "@/db/client";
import { createGoogleNotifyHandler } from "@/lib/calendar-sync/google-notify-route";
import { resolveGoogleNotification } from "@/lib/calendar-sync/push-channels";
import { scheduleGoogleNotificationSync } from "@/lib/calendar-sync/sync-runner";

/** Google Calendar 변경 알림. 로그인 없이 Google이 부르므로 proxy matcher에서 제외되어 있다. */
export const POST = createGoogleNotifyHandler({
  resolve: (input) => resolveGoogleNotification(createDbContext(), input),
  scheduleSync: scheduleGoogleNotificationSync,
});
