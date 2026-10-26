/**
 * @file src/app/dashboard/student/digging/page.tsx
 * @description 학생 본인의 디깅 보드(Digging·MobileDigging 보드). 트랙 값 편집·삭제와 컬럼 관리를 전체 화면에서 제공한다.
 * 이동은 사이드바(좁은 화면은 메뉴 서랍)가 맡고, 좁은 화면 위쪽 막대 오른쪽에 트랙 추가를 둔다.
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getDiggingTracks, getOrSeedColumns } from "@/lib/actions/digging";
import { DiggingBoard } from "@/components/digging/DiggingBoard";
import type { DiggingColumnType } from "@/db/schema";

export const metadata = { title: "디깅 보드" };

type RawColumn = Awaited<ReturnType<typeof getOrSeedColumns>>[number];

export default async function StudentDiggingPage() {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "student") redirect("/dashboard/admin");

  const studentId = session.user.id;
  const [columns, tracks] = await Promise.all([
    getOrSeedColumns(studentId),
    getDiggingTracks(studentId),
  ]);

  return (
    <div className="px-5 pb-8 pt-4 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <div className="max-w-[1120px]">
        <DiggingBoard
          heading={(
            <>
              <h1 className="text-display font-semibold tracking-display">디깅 보드</h1>
              <p className="text-body text-secondary-foreground">찾은 트랙에 평가와 메모를 남깁니다. 칸을 눌러 바로 고칩니다.</p>
            </>
          )}
          mobileTopBar
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
