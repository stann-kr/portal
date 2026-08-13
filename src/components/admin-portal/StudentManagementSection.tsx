/**
 * @file src/components/admin-portal/StudentManagementSection.tsx
 * @description 관리자 학생 roster. 인라인 영역은 요약만 제공하고 상세 작업은 canonical 학생 route로 연결한다.
 */
"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Disc3,
  HelpCircle,
  Settings,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StudentRosterStat } from "@/lib/actions/students";
import { buildAdminStudentDetailHref } from "@/lib/student-space-routes";

function StudentSummaryInline({ student }: { student: StudentRosterStat }) {
  const displayName = student.displayName?.trim() || student.email;
  return (
    <tr id={`student-detail-${student.id}`}>
      <td colSpan={5} className="px-0 pb-4">
        <section
          aria-label={`${displayName} 요약`}
          className="mx-4 rounded-xl border border-border bg-muted/20 p-4"
        >
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">현재 진도</dt>
              <dd className="mt-1 font-medium text-foreground">{student.currentModule || "진도 미지정"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">다음 레슨</dt>
              <dd className="mt-1 font-medium text-foreground">
                {student.nextLessonDate ? format(student.nextLessonDate, "M월 d일 HH:mm") : "미정"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">피드백 대기</dt>
              <dd className="mt-1 font-medium text-foreground">{student.pendingFeedbackCount}건</dd>
            </div>
          </dl>
          <nav aria-label={`${displayName} 기록 바로가기`} className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
            <Button asChild variant="outline" size="sm">
              <Link href={buildAdminStudentDetailHref(student.id, "overview")}><Settings aria-hidden="true" />학생 상세</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/admin/students/${encodeURIComponent(student.id)}/notes`}><BookOpen aria-hidden="true" />노트</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={buildAdminStudentDetailHref(student.id, "qna")}><HelpCircle aria-hidden="true" />Q&A</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={buildAdminStudentDetailHref(student.id, "digging")}><Disc3 aria-hidden="true" />디깅</Link>
            </Button>
          </nav>
        </section>
      </td>
    </tr>
  );
}

export function StudentManagementSection({ students }: { students: StudentRosterStat[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">수강생 ({students.length}명)</h2>
          <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
            <Link href="/dashboard/admin/students/new"><UserPlus className="size-3.5" aria-hidden="true" />수강생 추가</Link>
          </Button>
        </div>

        {students.length === 0 ? (
          <div className="flex flex-col items-center justify-center space-y-3 rounded-xl border border-dashed bg-muted/30 p-12 text-muted-foreground">
            <p className="text-sm">등록된 수강생이 없습니다.</p>
            <Button asChild size="sm" variant="outline"><Link href="/dashboard/admin/students/new">첫 수강생 추가하기</Link></Button>
          </div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {students.map((student) => (
                <Link
                  key={student.id}
                  href={buildAdminStudentDetailHref(student.id, "overview")}
                  className="block rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-muted"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{student.displayName || "이름 미등록"}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{student.email}</p>
                    </div>
                    {student.pendingFeedbackCount > 0 ? (
                      <span className="rounded-md bg-warning-muted px-2 py-1 text-xs font-semibold text-warning">피드백 {student.pendingFeedbackCount}건</span>
                    ) : null}
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div><dt className="text-muted-foreground">현재 진도</dt><dd className="mt-1 line-clamp-2 font-medium text-foreground">{student.currentModule || "진도 미지정"}</dd></div>
                    <div><dt className="text-muted-foreground">다음 레슨</dt><dd className="mt-1 font-mono font-medium tabular-nums text-foreground">{student.nextLessonDate ? format(student.nextLessonDate, "M/d HH:mm") : "미정"}</dd></div>
                  </dl>
                </Link>
              ))}
            </div>

            <div className="hidden overflow-hidden rounded-lg border border-border bg-surface md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs font-medium text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3">수강생</th>
                    <th scope="col" className="px-4 py-3">현재 진도</th>
                    <th scope="col" className="px-4 py-3">다음 레슨</th>
                    <th scope="col" className="px-4 py-3 text-center">피드백 대기</th>
                    <th scope="col" className="w-12 px-4 py-3"><span className="sr-only">학생 상세</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {students.map((student) => {
                    const displayName = student.displayName?.trim() || student.email;
                    const expanded = expandedId === student.id;
                    return (
                      <Fragment key={student.id}>
                        <tr className="transition-colors hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setExpandedId(expanded ? null : student.id)}
                              aria-expanded={expanded}
                              aria-controls={`student-detail-${student.id}`}
                              className="flex w-full items-center gap-3 rounded-md text-left"
                            >
                              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary" aria-hidden="true">{student.displayName?.[0]?.toUpperCase() || "S"}</span>
                              <span className="min-w-0"><span className="block truncate font-medium text-foreground">{student.displayName || "이름 미등록"}</span><span className="block max-w-[150px] truncate text-xs text-muted-foreground">{student.email}</span></span>
                              {expanded ? <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                              <span className="sr-only">{displayName} 요약 {expanded ? "닫기" : "열기"}</span>
                            </button>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{student.currentModule || "진도 미지정"}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{student.nextLessonDate ? format(student.nextLessonDate, "M/d HH:mm") : "미정"}</td>
                          <td className="px-4 py-3 text-center">{student.pendingFeedbackCount > 0 ? <span className="inline-flex min-w-5 items-center justify-center rounded-md bg-warning-muted px-1.5 py-0.5 text-xs font-bold text-warning">{student.pendingFeedbackCount}</span> : <span className="text-muted-foreground">0</span>}</td>
                          <td className="px-4 py-3"><Button asChild variant="ghost" size="icon"><Link href={buildAdminStudentDetailHref(student.id, "overview")} aria-label={`${displayName} 상세 열기`}><Settings className="size-4" aria-hidden="true" /></Link></Button></td>
                        </tr>
                        {expanded ? <StudentSummaryInline student={student} /> : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
