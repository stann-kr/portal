import { redirect } from "next/navigation";
import { PASSWORD_CHANGE_PATH } from "@/auth.config";
import { getSignedInSession } from "@/lib/auth-guard";

export default async function RootPage() {
  const session = await getSignedInSession();

  if (session?.user.passwordChangeRequired) redirect(PASSWORD_CHANGE_PATH);
  if (session?.user) {
    const role = session.user.role;
    redirect(`/dashboard/${role === "admin" ? "admin" : "student"}`);
  }

  redirect("/login");
}
