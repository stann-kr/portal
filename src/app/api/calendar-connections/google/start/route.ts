import { buildGoogleAuthUrl, createOAuthState, createPkcePair } from "@/lib/calendar-sync/google";
import { googleOAuthRouteDeps } from "@/lib/calendar-sync/google-oauth-route-deps";
import { createGoogleOAuthStartHandler } from "@/lib/calendar-sync/google-oauth-routes";

export const GET = createGoogleOAuthStartHandler({
  ...googleOAuthRouteDeps,
  createPkcePair,
  createState: createOAuthState,
  buildAuthUrl: buildGoogleAuthUrl,
});
