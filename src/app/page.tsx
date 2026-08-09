import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";

export default async function RootPage() {
  const session = await getActiveAuthSession();

  if (session?.user) {
    const role = session.user.role;
    redirect(`/dashboard/${role === "admin" ? "admin" : "student"}`);
  }

  redirect("/login");
}
