import { completeGoogleCalendarConnection } from "@/lib/calendar-sync/google-connection";
import { googleOAuthRouteDeps } from "@/lib/calendar-sync/google-oauth-route-deps";
import { createGoogleOAuthCallbackHandler } from "@/lib/calendar-sync/google-oauth-routes";

export const GET = createGoogleOAuthCallbackHandler({
  ...googleOAuthRouteDeps,
  complete: completeGoogleCalendarConnection,
});
