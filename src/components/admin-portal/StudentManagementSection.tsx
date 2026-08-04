/**
 * @file src/components/admin-portal/StudentManagementSection.tsx
 * @description 어드민 원페이지 학생 관리 콘텐츠.
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
import { StatusBadge } from "@/components/ui/status-badge";
import type { StudentRosterStat } from "@/lib/actions/students";

// ── 타입 ──────────────────────────────────────────

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
    { key: "overview", label: "개요", Icon: LayoutDashboard },
    { key: "notes",    label: "노트", Icon: BookOpen },
    { key: "qna",      label: "Q&A",      Icon: HelpCircle },
  ];

  return (
    <tr id={`student-detail-${student.id}`}>
      <td colSpan={5} className="px-0 pb-4">
        <div className="mx-4 rounded-xl border border-border bg-muted/20 overflow-hidden">
          {/* 탭 네비게이션 */}
          <div className="flex gap-0 border-b border-border bg-background px-4">
            {TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => onTabChange(key)}
                aria-pressed={activeTab === key}
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
              <div role="status" className="animate-pulse py-8 text-center text-sm text-muted-foreground">
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
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${m.isCompleted ? "bg-success" : "bg-muted-foreground/40"}`} />
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
                          href={`/dashboard/qna/${t.id}?returnTo=%2Fdashboard%2Fadmin%3Fsection%3Dstudents`}
                          className="flex items-center justify-between p-3 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
                        >
                          <p className="text-sm font-medium truncate flex-1">{t.title}</p>
                          <StatusBadge
                            status={
                              t.status === "OPEN"
                                ? "qnaOpen"
                                : t.status === "ANSWERED"
                                  ? "qnaAnswered"
                                  : "qnaClosed"
                            }
                          />
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
    <div className="space-y-6 p-4 sm:p-6">
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
          <>
          <div className="space-y-3 md:hidden">
            {students.map((student) => (
              <Link
                key={student.id}
                href={`/dashboard/admin/students/${student.id}`}
                className="block rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-muted"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {student.displayName || "이름 미등록"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {student.email}
                    </p>
                  </div>
                  {student.pendingFeedbackCount > 0 ? (
                    <span className="rounded-md bg-warning-muted px-2 py-1 text-xs font-semibold text-warning">
                      피드백 {student.pendingFeedbackCount}건
                    </span>
                  ) : null}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">현재 진도</dt>
                    <dd className="mt-1 line-clamp-2 font-medium text-foreground">
                      {student.currentModule || "미지정"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">다음 레슨</dt>
                    <dd className="mt-1 font-mono font-medium tabular-nums text-foreground">
                      {student.nextLessonDate
                        ? format(student.nextLessonDate, "M/d HH:mm")
                        : "미정"}
                    </dd>
                  </div>
                </dl>
              </Link>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-lg border border-border bg-surface md:block">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/40 text-muted-foreground text-xs font-medium">
                <tr>
                  <th scope="col" className="px-4 py-3">수강생</th>
                  <th scope="col" className="px-4 py-3">현재 진도</th>
                  <th scope="col" className="px-4 py-3">다음 레슨</th>
                  <th scope="col" className="px-4 py-3 text-center">피드백 대기</th>
                  <th scope="col" className="w-12 px-4 py-3"><span className="sr-only">학생 상세</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {students.map((st) => (
                  <Fragment key={st.id}>
                    <tr className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleRowClick(st.id)}
                          aria-expanded={expandedId === st.id}
                          aria-controls={`student-detail-${st.id}`}
                          className="flex w-full items-center gap-3 rounded-md text-left"
                        >
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                            {st.displayName?.[0]?.toUpperCase() || "S"}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {st.displayName || "이름 미등록"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                              {st.email}
                            </p>
                          </div>
                          {expandedId === st.id ? (
                            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {st.currentModule ?? "미지정"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {st.nextLessonDate
                          ? format(st.nextLessonDate, "M/d HH:mm")
                          : "미정"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {st.pendingFeedbackCount > 0 ? (
                          <span className="inline-flex min-w-[20px] items-center justify-center rounded-md bg-warning-muted px-1.5 py-0.5 text-xs font-bold text-warning">
                            {st.pendingFeedbackCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Button asChild variant="ghost" size="icon">
                          <Link
                            href={`/dashboard/admin/students/${st.id}`}
                            aria-label={`${st.displayName || st.email} 상세 열기`}
                          >
                            <Settings className="size-4" aria-hidden="true" />
                          </Link>
                        </Button>
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
          </>
        )}
      </div>
    </div>
  );
}
