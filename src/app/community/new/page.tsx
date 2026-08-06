/**
 * @file src/app/community/new/page.tsx
 * @description 권한과 draft 소유자를 서버에서 확정하는 게시물 작성 페이지.
 */
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { NewPostForm, type PostBoardType } from "@/components/community/NewPostForm";
import { safeReturnPath } from "@/lib/safe-return-path";

const BOARD_TYPES: readonly PostBoardType[] = ["ANNOUNCEMENT", "GENERAL", "FEEDBACK"];

export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ boardType?: string; category?: string; returnTo?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const query = await searchParams;
  const requestedBoardType = query.boardType as PostBoardType | undefined;
  const defaultBoardType =
    requestedBoardType && BOARD_TYPES.includes(requestedBoardType) &&
    (requestedBoardType !== "ANNOUNCEMENT" || session.user.role === "admin")
      ? requestedBoardType
      : "GENERAL";
  const returnTo = safeReturnPath(query.returnTo, "/community");

  return (
    <NewPostForm
      actorId={session.user.id}
      isAdmin={session.user.role === "admin"}
      defaultBoardType={defaultBoardType}
      defaultCategory={query.category ?? "general"}
      returnTo={returnTo}
    />
  );
}
