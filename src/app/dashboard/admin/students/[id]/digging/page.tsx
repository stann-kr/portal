/**
 * @file src/app/dashboard/admin/students/[id]/digging/page.tsx
 * @description 어드민 전용 — 학생 디깅 보드 읽기 전용 뷰.
 */
export const dynamic = "force-dynamic";

import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Disc3 } from "lucide-react";
import { getStudentById } from "@/lib/actions/students";
import { getOrSeedColumns, getDiggingTracks } from "@/lib/actions/digging";
import { DiggingBoard } from "@/components/digging/DiggingBoard";
import type { DiggingColumnType } from "@/db/schema";

type RawColumn = Awaited<ReturnType<typeof getOrSeedColumns>>[number];

export default async function AdminStudentDiggingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user || session.user.role !== "admin") redirect("/login");

  const { id: studentId } = await params;
  const [student, columns, tracks] = await Promise.all([
    getStudentById(studentId),
    getOrSeedColumns(studentId),
    getDiggingTracks(studentId),
  ]);

  if (!student) redirect("/dashboard/admin");

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div className="space-y-1">
        <Link
          href={`/dashboard/admin/students/${studentId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          {student.displayName ?? student.email}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2 mt-1">
          <Disc3 className="w-6 h-6 text-primary" />
          Digging Board
          <span className="text-sm font-normal text-muted-foreground">
            — {student.displayName ?? student.email}
          </span>
        </h1>
      </div>

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
        readonly
      />
    </div>
  );
}
