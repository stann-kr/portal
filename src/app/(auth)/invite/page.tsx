import Link from "next/link";
import { InviteSignup } from "@/components/auth/InviteSignup";
import { LogoutTextButton } from "@/components/auth/LogoutTextButton";
import { getSignedInSession } from "@/lib/auth-guard";

export const metadata = { title: "가입" };

/**
 * 관리자가 발급한 가입 링크에서 학생이 직접 비밀번호를 정한다. 다른 계정으로 로그인한 상태라면
 * 그 계정의 로그인을 덮어쓰지 않도록 먼저 로그아웃을 안내한다.
 */
export default async function InvitePage() {
  const session = await getSignedInSession();

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-surface p-6 sm:p-8">
        <div className="flex size-10 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          SL
        </div>
        {session ? (
          <div className="space-y-4">
            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">이미 로그인돼 있습니다</h1>
            <p className="text-sm text-muted-foreground">
              가입 링크로 새 계정을 만들려면 로그아웃한 뒤 받은 링크를 다시 열어 주세요.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/dashboard" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                포털로 돌아가기
              </Link>
              <LogoutTextButton ownerId={session.user.id} label="로그아웃" />
            </div>
          </div>
        ) : (
          <InviteSignup />
        )}
      </div>
    </div>
  );
}
