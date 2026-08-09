/**
 * @file src/app/dashboard/qna/new/page.tsx
 * @description 학생 전용 새 Q&A 질문 작성 페이지.
 */
import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { NewQnaForm } from "@/components/qna/NewQnaForm";
import { safeReturnPath } from "@/lib/safe-return-path";

export default async function NewQnaPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role === "admin") redirect("/dashboard/qna");
  const query = await searchParams;
  const returnTo = safeReturnPath(query.returnTo, "/dashboard/qna");

  return <NewQnaForm actorId={session.user.id} returnTo={returnTo} />;
}
