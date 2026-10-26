import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { AccountCleanupBootstrap } from "@/components/auth/AccountCleanupBootstrap";
import { OwnerlessLegacyDraftCleanup } from "@/components/auth/OwnerlessLegacyDraftCleanup";
import { PASSWORD_CHANGE_PATH } from "@/auth.config";
import { getSignedInSession } from "@/lib/auth-guard";
import { accountDeletionLoginMessage } from "@/lib/account-privacy-policy";
import { loginErrorMessage } from "@/lib/login-messages";

export const metadata = { title: "로그인" };

/**
 * @file src/app/(auth)/login/page.tsx
 * @description 로그인 페이지(캔버스 Login·MobileLogin). 로고와 가운데 열은 (auth) layout이 그린다.
 * NextAuth `searchParams.error`를 읽어 실패 사유를 사용자에게 표시.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    code?: string;
    callbackUrl?: string;
    accountDeleted?: string;
    deviceCleanup?: string;
  }>;
}) {
  const signedInSession = await getSignedInSession();
  if (signedInSession) {
    redirect(
      signedInSession.user.passwordChangeRequired
        ? PASSWORD_CHANGE_PATH
        : signedInSession.user.role === "admin"
          ? "/dashboard/admin"
          : "/dashboard/student",
    );
  }

  const { error, code, callbackUrl, accountDeleted, deviceCleanup } =
    await searchParams;
  const deletionMessage = accountDeletionLoginMessage(
    accountDeleted,
    deviceCleanup,
  );

  return (
    <div className="flex flex-col gap-8">
      <AccountCleanupBootstrap />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-display text-foreground">DJ 레슨 포털</h1>
        <p className="text-md leading-6 text-secondary-foreground md:text-body md:leading-[22px]">
          수업 일정과 학습 기록을 계속하려면 로그인하세요.
        </p>
      </div>

      {deletionMessage && (
        <div role="status" className="rounded-md bg-sidebar px-3 py-2.5 text-ui text-foreground">
          {deletionMessage}
        </div>
      )}

      <LoginForm
        callbackUrl={typeof callbackUrl === "string" ? callbackUrl : undefined}
        initialError={typeof error === "string" ? loginErrorMessage(error, typeof code === "string" ? code : null) : null}
      />

      <div className="border-t border-muted pt-4 text-ui text-muted-foreground">
        <p>계정이 필요하면 담당 강사에게 문의하세요.</p>
        <OwnerlessLegacyDraftCleanup />
      </div>
    </div>
  );
}
