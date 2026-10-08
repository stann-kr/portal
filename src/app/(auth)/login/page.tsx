import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { Input } from "@/components/ui/input";
import { LoginSubmitButton } from "@/components/auth/LoginSubmitButton";
import { AccountCleanupBootstrap } from "@/components/auth/AccountCleanupBootstrap";
import { OwnerlessLegacyDraftCleanup } from "@/components/auth/OwnerlessLegacyDraftCleanup";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { accountDeletionLoginMessage } from "@/lib/account-privacy-policy";

/**
 * NextAuth 에러 코드 → 사용자 친화적 메시지 매핑
 */
function getErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  const map: Record<string, string> = {
    CredentialsSignin: "이메일 또는 비밀번호가 올바르지 않습니다.",
    Configuration: "서버 설정 오류가 발생했습니다. 관리자에게 문의하세요.",
    AccessDenied: "접근 권한이 없습니다.",
    Verification: "인증 링크가 만료되었습니다.",
    Default: "로그인 중 오류가 발생했습니다. 다시 시도해 주세요.",
  };
  // 알 수 없는 query 값은 화면에 그대로 반사하지 않는다.
  return map[error] ?? map.Default;
}

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
  const activeSession = await getActiveAuthSession();
  if (activeSession) {
    redirect(
      activeSession.user.role === "admin"
        ? "/dashboard/admin"
        : "/dashboard/student",
    );
  }

  const { error, callbackUrl, accountDeleted, deviceCleanup } =
    await searchParams;
  const errorMessage = getErrorMessage(error);
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

        {/* 에러 메시지 */}
        {errorMessage && (
          <div role="alert" className="mt-5 rounded-md border border-destructive/20 bg-destructive-muted px-4 py-3 text-sm font-medium text-destructive">
            {errorMessage}
          </div>
        )}
        {deletionMessage && (
          <div
            role="status"
            className="mt-5 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-foreground"
          >
            {deletionMessage}
          </div>
        )}

        {/* 로그인 폼 */}
        <form
          action={async (formData: FormData) => {
            "use server";
            try {
              await signIn("credentials", {
                email: formData.get("email"),
                password: formData.get("password"),
                redirectTo: callbackUrl ?? "/dashboard",
              });
            } catch (err) {
              if (err instanceof AuthError) {
                // NextAuth 에러는 URL 파라미터로 리다이렉트하여 사용자에게 표시
                redirect(`/login?error=${err.type}`);
              }
              // Next.js redirect()는 내부적으로 throw를 사용하므로 반드시 re-throw
              throw err;
            }
          }}
          className="mt-6 space-y-4"
        >
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              이메일
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="name@example.com"
              className="h-10"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              비밀번호
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="h-10"
            />
          </div>

          <LoginSubmitButton />
        </form>

        <div className="mt-5 text-xs text-muted-foreground">
          <p>계정이 필요하면 담당 강사에게 문의하세요.</p>
        </div>
        <OwnerlessLegacyDraftCleanup />
      </div>
    </div>
  );
}
