import { redirect } from "next/navigation";
import { RequiredPasswordChange } from "@/components/auth/RequiredPasswordChange";
import { getSignedInSession } from "@/lib/auth-guard";

export const metadata = { title: "새 비밀번호 설정" };

/**
 * 관리자가 발급한 임시 비밀번호로 로그인한 사용자는 이 화면에서 새 비밀번호를 정하기 전까지
 * 포털의 다른 화면과 기능을 쓸 수 없다.
 */
export default async function RequiredPasswordChangePage() {
  const session = await getSignedInSession();
  if (!session) redirect("/login");
  if (!session.user.passwordChangeRequired) {
    redirect(session.user.role === "admin" ? "/dashboard/admin" : "/dashboard/student");
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 sm:p-8">
        <div className="space-y-2">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            SL
          </div>
          <h1 className="pt-4 text-2xl font-semibold tracking-[-0.03em] text-foreground">
            새 비밀번호 설정
          </h1>
          <p className="text-sm text-muted-foreground">
            관리자가 발급한 임시 비밀번호로 로그인했습니다. 계속하려면 본인만 아는 새 비밀번호를 정해 주세요.
          </p>
        </div>
        <div className="mt-6">
          <RequiredPasswordChange ownerId={session.user.id} />
        </div>
      </div>
    </div>
  );
}
