import { completeGoogleCalendarConnection } from "@/lib/actions/calendarSync";
import { googleOAuthRouteDeps } from "@/lib/calendar-sync/google-oauth-route-deps";
import { createGoogleOAuthCallbackHandler } from "@/lib/calendar-sync/google-oauth-routes";

export const GET = createGoogleOAuthCallbackHandler({
  ...googleOAuthRouteDeps,
  complete: completeGoogleCalendarConnection,
});
