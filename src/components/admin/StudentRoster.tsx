/**
 * @file src/components/admin/StudentRoster.tsx
 * @description 관리자 대시보드의 수강생 목록 테이블 및 스켈레톤 UI.
 */
import Link from "next/link";
import { format } from "date-fns";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStudentRosterStats } from "@/lib/actions/students";

export async function StudentRoster() {
  const students = await getStudentRosterStats();

  if (students.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border border-dashed rounded-xl bg-muted/30 text-muted-foreground space-y-3">
        <p className="text-sm">등록된 수강생이 없습니다.</p>
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/admin/students/new">첫 수강생 추가하기</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <table className="w-full text-sm text-left">
        <thead className="bg-muted/50 text-muted-foreground text-xs uppercase font-semibold">
          <tr>
            <th className="px-4 py-3">Student</th>
            <th className="px-4 py-3">Current Module</th>
            <th className="px-4 py-3">Next Lesson</th>
            <th className="px-4 py-3 text-center">Pending Feedbacks</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {students.map((st) => (
            <tr key={st.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    {st.displayName?.[0]?.toUpperCase() || "S"}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {st.displayName || "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                      {st.email}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {st.currentModule}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {st.nextLessonDate ? format(st.nextLessonDate, "MMM d, h:mm a") : "미정"}
              </td>
              <td className="px-4 py-3 text-center">
                {st.pendingFeedbackCount > 0 ? (
                  <span className="inline-flex items-center justify-center rounded-full bg-destructive px-2 py-1 text-xs font-bold leading-none text-primary-foreground">
                    {st.pendingFeedbackCount}
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <Button asChild variant="ghost" size="sm" className="h-8 px-2 gap-1 text-xs">
                  <Link href={`/dashboard/admin/students/${st.id}`}>
                    <Settings className="w-3.5 h-3.5" /> Manage
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RosterSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="h-16 rounded-lg border border-border bg-card animate-pulse"
        />
      ))}
    </div>
  );
}
