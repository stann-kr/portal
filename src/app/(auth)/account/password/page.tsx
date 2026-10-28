import { redirect } from "next/navigation";
import { RequiredPasswordChange } from "@/components/auth/RequiredPasswordChange";
import { getSignedInSession } from "@/lib/auth-guard";

export const metadata = { title: "새 비밀번호 설정" };

/**
 * 관리자가 발급한 임시 비밀번호로 로그인한 사용자는 이 화면에서 새 비밀번호를 정하기 전까지
 * 포털의 다른 화면과 기능을 쓸 수 없다(캔버스 AccountPassword·MobileAccountPassword).
 */
export default async function RequiredPasswordChangePage() {
  const session = await getSignedInSession();
  if (!session) redirect("/login");
  if (!session.user.passwordChangeRequired) {
    redirect(session.user.role === "admin" ? "/dashboard/admin" : "/dashboard/student");
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-display text-foreground">새 비밀번호 설정</h1>
        <p className="text-md leading-6 text-secondary-foreground md:text-body md:leading-[22px]">
          관리자가 발급한 임시 비밀번호로 로그인했습니다. 계속하려면 본인만 아는 새 비밀번호를 정해 주세요.
        </p>
      </div>
      <RequiredPasswordChange ownerId={session.user.id} />
    </div>
  );
}
