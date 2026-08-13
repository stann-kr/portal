/**
 * @file src/components/admin/StatsCards.tsx
 * @description 관리자 대시보드 — 통계 카드 컴포넌트 (Phase 2 고도화).
 * 학생 수, 이번 주 예정 레슨, 미답변 피드백 수를 아이콘 + 수치로 표시.
 */
import { Users, CalendarDays, MessageSquare } from "lucide-react";
import { getStudentCount, getStudentRosterStats } from "@/lib/actions/students";

export async function StatsCards() {
  const [count, students] = await Promise.all([
    getStudentCount(),
    getStudentRosterStats(),
  ]);

  // 이번 주(7일 이내) 예정 레슨 수
  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingThisWeek = students.filter(
    (s) => s.nextLessonDate && s.nextLessonDate >= now && s.nextLessonDate <= weekLater,
  ).length;

  // 전체 미답변 피드백 합계
  const totalPending = students.reduce((sum, s) => sum + s.pendingFeedbackCount, 0);

  const stats = [
    {
      label: "Active Students",
      value: count,
      icon: Users,
      color: "text-info bg-info-muted",
      sub: "등록된 수강생",
    },
    {
      label: "Lessons This Week",
      value: upcomingThisWeek,
      icon: CalendarDays,
      color: "text-success bg-success-muted",
      sub: "7일 이내 예정",
    },
    {
      label: "Pending Feedbacks",
      value: totalPending,
      icon: MessageSquare,
      color:
        totalPending > 0
          ? "text-destructive bg-destructive-muted"
          : "text-muted-foreground bg-muted",
      sub: totalPending > 0 ? "처리 대기 중" : "모두 처리됨",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className="p-6 rounded-2xl border border-border bg-card shadow-sm hover:bg-accent/5 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {stat.label}
                </p>
                <p className="text-4xl font-bold text-foreground">
                  {stat.value}
                </p>
                <p className="text-xs text-muted-foreground">{stat.sub}</p>
              </div>
              <div className={`p-3 rounded-xl ${stat.color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="p-6 rounded-2xl border border-border bg-card animate-pulse"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-3">
              <div className="h-3 w-28 bg-muted rounded" />
              <div className="h-10 w-16 bg-muted rounded" />
              <div className="h-3 w-20 bg-muted rounded" />
            </div>
            <div className="w-11 h-11 rounded-xl bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
