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
 * @description 로그인 페이지.
 * NextAuth `searchParams.error`를 읽어 실패 사유를 사용자에게 표시.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
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

  const { error, callbackUrl, accountDeleted, deviceCleanup } =
    await searchParams;
  const deletionMessage = accountDeletionLoginMessage(
    accountDeleted,
    deviceCleanup,
  );

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-4">
      <AccountCleanupBootstrap />
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 sm:p-8">
        {/* 헤더 */}
        <div className="space-y-2">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            SL
          </div>
          <h1 className="pt-4 text-2xl font-semibold tracking-[-0.03em] text-foreground">
            DJ 레슨 포털
          </h1>
          <p className="text-sm text-muted-foreground">
            수업 일정과 학습 기록을 계속하려면 로그인하세요.
          </p>
        </div>

        {deletionMessage && (
          <div
            role="status"
            className="mt-5 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-foreground"
          >
            {deletionMessage}
          </div>
        )}

        <LoginForm
          callbackUrl={typeof callbackUrl === "string" ? callbackUrl : undefined}
          initialError={typeof error === "string" ? loginErrorMessage(error) : null}
        />

        <div className="mt-5 text-xs text-muted-foreground">
          <p>계정이 필요하면 담당 강사에게 문의하세요.</p>
        </div>
        <OwnerlessLegacyDraftCleanup />
      </div>
    </div>
  );
}
