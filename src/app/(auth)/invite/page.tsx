import Link from "next/link";
import { Button } from "@/components/ui/button";
import { InviteSignup } from "@/components/auth/InviteSignup";
import { LogoutTextButton } from "@/components/auth/LogoutTextButton";
import { getSignedInSession } from "@/lib/auth-guard";

export const metadata = { title: "가입" };

/**
 * 관리자가 발급한 가입 링크에서 학생이 직접 비밀번호를 정한다(캔버스 Invite·MobileInvite). 다른 계정으로 로그인한 상태라면
 * 그 계정의 로그인을 덮어쓰지 않도록 먼저 로그아웃을 안내한다.
 */
export default async function InvitePage() {
  const session = await getSignedInSession();

  if (!session) return <InviteSignup />;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-display text-foreground">이미 로그인돼 있습니다</h1>
        <p className="text-md leading-6 text-secondary-foreground md:text-body md:leading-[22px]">
          가입 링크로 새 계정을 만들려면 로그아웃한 뒤 받은 링크를 다시 열어 주세요.
        </p>
      </div>
      <div className="flex flex-col gap-2 md:gap-4">
        <Button asChild size="touch" className="mt-2 w-full md:h-10 md:rounded-md md:text-body">
          <Link href="/dashboard">포탈로 돌아가기</Link>
        </Button>
        <LogoutTextButton ownerId={session.user.id} label="로그아웃" />
      </div>
    </div>
  );
}
