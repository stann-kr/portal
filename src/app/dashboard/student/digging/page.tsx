/**
 * @file src/app/dashboard/student/digging/page.tsx
 * @description 학생 본인의 디깅 보드. 트랙 값 편집·삭제와 컬럼 관리를 전체 화면에서 제공한다.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Disc3 } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getDiggingTracks, getOrSeedColumns } from "@/lib/actions/digging";
import { DiggingBoard } from "@/components/digging/DiggingBoard";
import type { DiggingColumnType } from "@/db/schema";
import { safeReturnPath } from "@/lib/safe-return-path";
import { STUDENT_DIGGING_TIMELINE_HREF } from "@/lib/student-space-routes";

export const metadata = { title: "디깅 보드" };

type RawColumn = Awaited<ReturnType<typeof getOrSeedColumns>>[number];

export default async function StudentDiggingPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "student") redirect("/dashboard/admin");

  const studentId = session.user.id;
  const returnTo = safeReturnPath((await searchParams).returnTo, STUDENT_DIGGING_TIMELINE_HREF);
  const [columns, tracks] = await Promise.all([
    getOrSeedColumns(studentId),
    getDiggingTracks(studentId),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-3 border-b border-border pb-5">
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          이전 화면으로 돌아가기
        </Link>
        <div>
          <p className="text-sm text-muted-foreground">내 스페이스</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Disc3 className="size-6 text-primary" aria-hidden="true" />
            디깅 보드
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            찾은 트랙의 평가와 메모를 고치고, 필요한 컬럼을 직접 추가할 수 있습니다.
          </p>
        </div>
      </header>

      <DiggingBoard
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
  );
}
