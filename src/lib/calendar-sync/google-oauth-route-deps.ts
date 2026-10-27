import { getActiveAuthSession } from "@/lib/auth-guard";
import { getExternalCalendarEncryptionKey } from "@/lib/external-calendar-key";
import { getGoogleCalendarOAuthConfig } from "./oauth-config";
import type { GoogleOAuthRouteDeps } from "./google-oauth-routes";

/** 두 Google OAuth route가 공유하는 실제 session·설정·key 연결. */
export const googleOAuthRouteDeps: GoogleOAuthRouteDeps = {
  getSession: async () => {
    const session = await getActiveAuthSession();
    return session ? { id: session.user.id, role: session.user.role ?? "" } : null;
  },
  getOAuthConfig: getGoogleCalendarOAuthConfig,
  getEncryptionKey: () => {
    try {
      return getExternalCalendarEncryptionKey();
    } catch {
      return null;
    }
  },
};
