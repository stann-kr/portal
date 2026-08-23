import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getActiveAuthSession();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student");
  return children;
}
