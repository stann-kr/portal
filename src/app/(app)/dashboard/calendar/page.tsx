/** Legacy calendar entrypoint. 역할별 canonical workspace calendar로 이동한다. */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getLegacyCalendarRedirect } from "@/lib/legacy-dashboard-routes";

export default async function CalendarRedirectPage() {
  const session = await getActiveAuthSession();
  if (!session?.user) redirect("/login");
  redirect(getLegacyCalendarRedirect(session.user.role === "admin" ? "admin" : "student"));
}
