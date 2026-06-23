/**
 * @file src/components/admin-portal/StudentManagementSection.tsx
 * @description 어드민 원페이지 — 학생 관리 탭 콘텐츠.
 * 통계 카드 + 학생 로스터 (행 클릭 시 인라인 상세 확장).
 */
"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  Settings,
  UserPlus,
  LayoutDashboard,
  BookOpen,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StudentRosterStat } from "@/lib/actions/students";

// ── 타입 ──────────────────────────────────────────

type StatCard = {
  label: string;
  value: number;
  sub: string;
  color: string;
};

type AdminNote = {
  id: string;
  title: string;
  contentHtml: string;
  createdAt: Date | null;
  authorId: string | null;
  authorName: string | null;
};

type AdminQnaThread = {
  id: string;
  title: string;
  status: string;
  createdAt: Date | null;
};

type AdminModule = {
  id: string;
  weekNum: number | null;
  title: string;
  isCompleted: boolean | null;
};

type StudentDetailData = {
  notes: AdminNote[];
  threads: AdminQnaThread[];
  modules: AdminModule[];
};

type DetailTab = "overview" | "notes" | "qna";

interface StudentManagementSectionProps {
  students: StudentRosterStat[];
  stats: StatCard[];
  /** 학생 ID → 상세 데이터 패치 함수 */
  fetchStudentDetail: (studentId: string) => Promise<StudentDetailData>;
}

// ── 학생 상세 인라인 확장 ─────────────────────────

function StudentDetailInline({
  student,
  detail,
  activeTab,
  onTabChange,
}: {
  student: StudentRosterStat;
  detail: StudentDetailData | null;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}) {
  const TABS: { key: DetailTab; label: string; Icon: React.ElementType }[] = [
    { key: "overview", label: "Overview", Icon: LayoutDashboard },
    { key: "notes",    label: "Notes",    Icon: BookOpen },
    { key: "qna",      label: "Q&A",      Icon: HelpCircle },
  ];

  return (
    <tr>
      <td colSpan={5} className="px-0 pb-4">
        <div className="mx-4 rounded-xl border border-border bg-muted/20 overflow-hidden">
          {/* 탭 네비게이션 */}
          <div className="flex gap-0 border-b border-border bg-background px-4">
            {TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => onTabChange(key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 py-1.5">
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs gap-1">
                <Link href={`/dashboard/admin/students/${student.id}`}>
                  <Settings className="w-3 h-3" />
                  상세 페이지
                </Link>
              </Button>
            </div>
          </div>

          {/* 탭 콘텐츠 */}
          <div className="p-4">
            {!detail ? (
              <div className="py-8 text-center text-sm text-muted-foreground animate-pulse">
                로딩 중...
              </div>
            ) : (
              <>
                {activeTab === "overview" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">현재 모듈</p>
                        <p className="font-medium">{student.currentModule ?? "미지정"}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">다음 레슨</p>
                        <p className="font-medium">
                          {student.nextLessonDate
                            ? format(student.nextLessonDate, "M월 d일 HH:mm")
                            : "미정"}
                        </p>
                      </div>
                    </div>
                    {detail.modules.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">커리큘럼 모듈 ({detail.modules.length}개)</p>
                        <div className="space-y-1">
                          {detail.modules.slice(0, 5).map((m) => (
                            <div key={m.id} className="flex items-center gap-2 text-sm">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${m.isCompleted ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                              <span className="text-xs text-muted-foreground w-10">W{m.weekNum}</span>
                              <span>{m.title}</span>
                            </div>
                          ))}
                          {detail.modules.length > 5 && (
                            <p className="text-xs text-muted-foreground pl-4">... 외 {detail.modules.length - 5}개</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "notes" && (
                  <div className="space-y-2">
                    {detail.notes.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">작성된 노트가 없습니다.</p>
                    ) : (
                      detail.notes.slice(0, 5).map((note) => (
                        <div key={note.id} className="p-3 rounded-lg border border-border bg-background">
                          <p className="text-sm font-medium">{note.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {note.authorName} · {note.createdAt ? format(new Date(note.createdAt), "M월 d일") : ""}
                          </p>
                        </div>
                      ))
                    )}
                    {detail.notes.length > 5 && (
                      <p className="text-xs text-muted-foreground text-center">
                        + {detail.notes.length - 5}개 더 있음 →{" "}
                        <Link href={`/dashboard/admin/students/${student.id}?tab=notes`} className="text-primary hover:underline">
                          전체 보기
                        </Link>
                      </p>
                    )}
                  </div>
                )}

                {activeTab === "qna" && (
                  <div className="space-y-2">
                    {detail.threads.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">작성된 Q&A가 없습니다.</p>
                    ) : (
                      detail.threads.slice(0, 5).map((t) => (
                        <Link
                          key={t.id}
                          href={`/dashboard/qna/${t.id}`}
                          className="flex items-center justify-between p-3 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
                        >
                          <p className="text-sm font-medium truncate flex-1">{t.title}</p>
                          <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                            t.status === "OPEN"
                              ? "bg-orange-100 text-orange-600"
                              : t.status === "ANSWERED"
                              ? "bg-green-100 text-green-600"
                              : "bg-muted text-muted-foreground"
                          }`}>
                            {t.status}
                          </span>
                        </Link>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────

export function StudentManagementSection({
  students,
  stats,
  fetchStudentDetail,
}: StudentManagementSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, StudentDetailData>>({});
  const [activeTab, setActiveTab] = useState<Record<string, DetailTab>>({});
  const [, startTransition] = useTransition();

  const handleRowClick = (studentId: string) => {
    if (expandedId === studentId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(studentId);

    if (!detailCache[studentId]) {
      startTransition(async () => {
        const data = await fetchStudentDetail(studentId);
        setDetailCache((prev) => ({ ...prev, [studentId]: data }));
      });
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="p-5 rounded-xl border border-border bg-card"
          >
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {stat.label}
            </p>
            <p className="text-3xl font-bold text-foreground mt-1">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* 학생 로스터 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            수강생 ({students.length}명)
          </h2>
          <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1">
            <Link href="/dashboard/admin/students/new">
              <UserPlus className="w-3.5 h-3.5" />
              수강생 추가
            </Link>
          </Button>
        </div>

        {students.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 border border-dashed rounded-xl bg-muted/30 text-muted-foreground space-y-3">
            <p className="text-sm">등록된 수강생이 없습니다.</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/admin/students/new">첫 수강생 추가하기</Link>
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/40 text-muted-foreground text-xs font-medium">
                <tr>
                  <th className="px-4 py-3">수강생</th>
                  <th className="px-4 py-3">현재 모듈</th>
                  <th className="px-4 py-3">다음 레슨</th>
                  <th className="px-4 py-3 text-center">미답변</th>
                  <th className="px-4 py-3 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {students.map((st) => (
                  <Fragment key={st.id}>
                    <tr
                      onClick={() => handleRowClick(st.id)}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                            {st.displayName?.[0]?.toUpperCase() || "S"}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {st.displayName || "Unknown"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                              {st.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {st.currentModule ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {st.nextLessonDate
                          ? format(st.nextLessonDate, "M/d HH:mm")
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {st.pendingFeedbackCount > 0 ? (
                          <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold text-red-100 bg-red-500 rounded-full min-w-[20px]">
                            {st.pendingFeedbackCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {expandedId === st.id ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </td>
                    </tr>

                    {expandedId === st.id && (
                      <StudentDetailInline
                        student={st}
                        detail={detailCache[st.id] ?? null}
                        activeTab={activeTab[st.id] ?? "overview"}
                        onTabChange={(tab) =>
                          setActiveTab((prev) => ({ ...prev, [st.id]: tab }))
                        }
                      />
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
