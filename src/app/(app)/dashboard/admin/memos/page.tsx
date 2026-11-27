/**
 * 관리자 메모(캔버스 MemoNav1127 ①). 사이드바 "메모"와 업무함 레슨 줄 "메모"가 이 화면을 연다.
 * 노트 없이 학생·날짜마다 남기는 메모를 날짜 먼저 고르는 화면에서 쓴다. 그날 레슨 학생이 먼저 보인다.
 * 학생 상세 개요의 "날짜별 메모"와 같은 메모를 읽고 쓴다(2026-11-27 사용자 요청 "접근이 너무 깊다").
 */
import { redirect } from "next/navigation";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { AdminMemoBoard } from "@/components/lesson/AdminMemoBoard";
import { getAdminMemoBoard } from "@/lib/actions/instructorMemos";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { firstSearchValue } from "@/lib/portal-location";
import { getRequestNow } from "@/lib/request-time";

export const metadata = { title: "메모" };

export default async function AdminMemosPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[]; student?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student");

  const params = await searchParams;
  const board = await getAdminMemoBoard({
    date: firstSearchValue(params.date),
    studentId: firstSearchValue(params.student),
    now: new Date(getRequestNow()),
  });

  return (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <MobileTopBar title="메모" />
      <div className="flex max-w-[1080px] flex-col gap-5 md:mx-auto md:gap-7">
        <header className="flex flex-col gap-1 max-md:sr-only">
          <p className="hidden text-xs text-muted-foreground md:block">나만 보기 · 학생에게 보이지 않음</p>
          <h1 className="sr-only text-display font-semibold tracking-display text-foreground md:not-sr-only">메모</h1>
        </header>
        <AdminMemoBoard board={board} actorId={session.user.id} />
      </div>
    </div>
  );
}
