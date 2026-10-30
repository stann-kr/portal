/**
 * @file src/app/dashboard/student/digging/page.tsx
 * @description 학생 본인의 디깅 보드(Digging·MobileDigging 보드). 위에 플레이리스트 목록, 아래에 트랙 값 편집·삭제와 컬럼 관리를 전체 화면에서 제공한다.
 * 이동은 사이드바(좁은 화면은 메뉴 서랍)가 맡고, 좁은 화면 위쪽 막대 오른쪽에 트랙 추가를 둔다.
 * 캘린더·홈 등에서 `returnTo`와 함께 열면 좁은 화면 위쪽 막대 왼쪽이 그 화면으로 돌아가는 뒤로가 된다.
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getDiggingTracks, getOrSeedColumns } from "@/lib/actions/digging";
import { getDiggingPlaylists } from "@/lib/actions/digging-playlists";
import { safeReturnPath } from "@/lib/safe-return-path";
import { DiggingBoard } from "@/components/digging/DiggingBoard";
import { PlaylistSection } from "@/components/digging/PlaylistSection";
import type { DiggingColumnType } from "@/db/schema";

export const metadata = { title: "디깅 보드" };

type RawColumn = Awaited<ReturnType<typeof getOrSeedColumns>>[number];

export default async function StudentDiggingPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "student") redirect("/dashboard/admin");

  const studentId = session.user.id;
  const returnTo = safeReturnPath((await searchParams).returnTo, "");
  const [columns, tracks, playlists] = await Promise.all([
    getOrSeedColumns(studentId),
    getDiggingTracks(studentId),
    getDiggingPlaylists(studentId),
  ]);

  return (
    <div className="px-5 pb-8 pt-4 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <div className="flex max-w-[1120px] flex-col gap-8 md:gap-12">
        {/* 좁은 화면은 위쪽 막대가 화면 이름을 맡으므로 제목은 화면 읽기에만 남긴다. */}
        <header className="sr-only md:not-sr-only md:flex md:flex-col md:gap-1">
          <h1 className="text-display font-semibold tracking-display">디깅 보드</h1>
          <p className="text-body text-secondary-foreground">플레이리스트를 모아 두고, 찾은 트랙에 평가와 메모를 남깁니다. 칸을 눌러 바로 고칩니다.</p>
        </header>
        <PlaylistSection studentId={studentId} initialPlaylists={playlists} />
        <DiggingBoard
          heading={<h2 className="text-ui font-semibold text-secondary-foreground">트랙</h2>}
          mobileTopBar
          mobileBack={returnTo ? { href: returnTo, label: "이전 화면으로" } : undefined}
          initialColumns={columns.map((c: RawColumn) => ({
            id: c.id,
            name: c.name,
            columnType: c.columnType as DiggingColumnType,
            options: c.options,
            isDefault: c.isDefault ?? false,
            sortOrder: c.sortOrder ?? 0,
          }))}
          initialTracks={tracks}
        />
      </div>
    </div>
  );
}
