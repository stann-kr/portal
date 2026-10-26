/**
 * @file src/components/admin-portal/StudentManagementSection.tsx
 * @description 관리자 학생 roster(AdminStudents·MobileAdminStudents 보드). 목록은 요약만 보여 주고,
 * 행의 더 보기 메뉴와 링크가 canonical 학생 상세 route로 연결한다.
 */
"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis, Plus, Search, UserPlus } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import type { StudentRosterStat } from "@/lib/actions/students";
import { buildAdminStudentDetailHref, type StudentDetailTab } from "@/lib/student-space-routes";
import { cn } from "@/lib/utils";
import { formatKstDot } from "@/components/student-portal/today/format";

const NEW_STUDENT_HREF = "/dashboard/admin/students/new";

const MENU_ITEM_CLASS =
  "flex h-9 w-full cursor-default select-none items-center rounded-md px-2.5 text-ui text-foreground outline-none data-[highlighted]:bg-muted";

function studentName(student: StudentRosterStat): string {
  return student.displayName?.trim() || "이름 미등록";
}

function studentInitial(student: StudentRosterStat): string {
  return Array.from(student.displayName?.trim() || student.email)[0]?.toUpperCase() ?? "학";
}

function nextLessonLabel(student: StudentRosterStat): string {
  // 올해가 아닌 레슨은 연도까지 보인다.
  return student.nextLessonDate ? formatKstDot(student.nextLessonDate, { time: true, referenceTime: new Date() }) : "미정";
}

/** 학생 이름과 이메일에 검색어가 들어 있는지(대소문자 무시). */
function matchesQuery(student: StudentRosterStat, query: string): boolean {
  if (!query) return true;
  const needle = query.toLocaleLowerCase("ko-KR");
  return [student.displayName ?? "", student.email].some((value) => value.toLocaleLowerCase("ko-KR").includes(needle));
}

/** 행의 더 보기 메뉴: 학생 상세의 각 기록으로 바로 간다. 노트는 학생 스페이스 노트 화면이 canonical이다. */
function StudentRowMenu({ student }: { student: StudentRosterStat }) {
  const name = studentName(student);
  const detailHref = (tab: StudentDetailTab) => buildAdminStudentDetailHref(student.id, tab);
  const links = [
    { label: "학생 상세", href: detailHref("overview") },
    { label: "과제", href: detailHref("assignments") },
    { label: "디깅", href: detailHref("digging") },
    { label: "노트", href: `/dashboard/admin/students/${encodeURIComponent(student.id)}/notes` },
    { label: "Q&A", href: detailHref("qna") },
  ];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${name} 메뉴`}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground"
        >
          <Ellipsis className="size-4" strokeWidth={1.6} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          style={{ zIndex: "var(--z-dropdown)" }}
          className="portal-menu w-44 rounded-lg border border-border bg-background p-1 shadow-floating"
        >
          {links.map(({ label, href }) => (
            <DropdownMenu.Item key={href} asChild className={MENU_ITEM_CLASS}>
              <Link href={href}>{label}</Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function PendingFeedback({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-foreground">
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", count > 0 ? "bg-item-qna" : "bg-transparent")}
      />
      {count}
      <span className="sr-only">건</span>
    </span>
  );
}

export function StudentManagementSection({ students }: { students: StudentRosterStat[] }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const visibleStudents = students.filter((student) => matchesQuery(student, deferredQuery));
  const countLabel = `수강생 ${students.length}명`;

  return (
    <div className="px-5 pb-8 pt-4 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <div className="flex max-w-[1080px] flex-col gap-1 md:gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="sr-only md:not-sr-only md:flex md:flex-col md:gap-1">
            <h1 className="text-display font-semibold tracking-display text-foreground">학생</h1>
            <p className="text-body text-secondary-foreground">{countLabel}</p>
          </div>
          {students.length > 0 ? (
            <div className="flex w-full items-center gap-2 md:w-auto">
              <label className="relative flex w-full items-center md:w-[220px]">
                <span className="sr-only">이름·이메일 검색</span>
                <Search
                  className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground md:left-2.5 md:size-3.5"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="이름·이메일 검색"
                  className="pl-10 md:h-8 md:pl-8 md:text-ui"
                />
              </label>
              <Link href={NEW_STUDENT_HREF} className={buttonClassName({ className: "hidden shrink-0 md:inline-flex" })}>
                <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
                수강생 추가
              </Link>
            </div>
          ) : null}
        </header>

        {students.length === 0 ? (
          <EmptyState
            className="mt-4 md:mt-0"
            icon={<UserPlus strokeWidth={1.6} aria-hidden="true" />}
            title="등록된 수강생이 없습니다"
            description="학생 계정을 만들면 가입 링크가 발급되고, 학생이 직접 비밀번호를 정해 로그인합니다."
            action={<Link href={NEW_STUDENT_HREF} className={buttonClassName({ variant: "outline" })}>첫 수강생 추가하기</Link>}
          />
        ) : (
          <>
            <p className="flex h-11 items-center text-ui text-muted-foreground md:hidden" aria-hidden="true">{countLabel}</p>

            {visibleStudents.length === 0 ? (
              <p role="status" className="border-t border-border py-4 text-body text-muted-foreground md:border-0 md:py-2">
                “{deferredQuery}”와 맞는 수강생이 없습니다. 다른 이름이나 이메일로 검색해 주세요.
              </p>
            ) : (
              <>
                <ul className="flex flex-col border-t border-border md:hidden" aria-label="수강생 목록">
                  {visibleStudents.map((student) => (
                    <li key={student.id}>
                      <Link
                        href={buildAdminStudentDetailHref(student.id, "overview")}
                        className="flex items-center gap-3 border-b border-muted py-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span
                          aria-hidden="true"
                          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-selected text-ui font-semibold text-secondary-foreground"
                        >
                          {studentInitial(student)}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-md font-medium">{studentName(student)}</span>
                            {student.pendingFeedbackCount > 0 ? (
                              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-secondary-foreground">
                                <span className="size-1.5 rounded-full bg-item-qna" aria-hidden="true" />
                                피드백 대기
                              </span>
                            ) : null}
                          </span>
                          <span className="truncate text-ui leading-[18px] text-muted-foreground">
                            {student.currentModule || "진도 미지정"}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="text-[11px] text-muted-foreground">다음 레슨</span>
                          <span className="font-mono text-xs tabular-nums">{nextLessonLabel(student)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[760px] table-fixed border-collapse text-left text-body">
                    <thead>
                      <tr className="border-b border-border">
                        <th scope="col" className="h-9 px-2 text-xs font-normal text-muted-foreground">수강생</th>
                        <th scope="col" className="w-[22%] px-2 text-xs font-normal text-muted-foreground">현재 진도</th>
                        <th scope="col" className="w-40 px-2 text-xs font-normal text-muted-foreground">다음 레슨</th>
                        <th scope="col" className="w-26 px-2 text-xs font-normal text-muted-foreground">피드백 대기</th>
                        <th scope="col" className="w-12 px-2"><span className="sr-only">메뉴</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleStudents.map((student) => (
                        <tr key={student.id} className="border-b border-muted">
                          <td className="h-14 px-2">
                            <Link
                              href={buildAdminStudentDetailHref(student.id, "overview")}
                              className="flex min-w-0 items-center gap-3 rounded-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span
                                aria-hidden="true"
                                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-selected text-xs font-semibold text-secondary-foreground"
                              >
                                {studentInitial(student)}
                              </span>
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate font-medium">{studentName(student)}</span>
                                <span className="truncate text-xs text-muted-foreground">{student.email}</span>
                              </span>
                            </Link>
                          </td>
                          <td className="truncate px-2 text-ui text-secondary-foreground">{student.currentModule || "진도 미지정"}</td>
                          <td className="px-2 font-mono text-xs tabular-nums text-secondary-foreground">{nextLessonLabel(student)}</td>
                          <td className="px-2"><PendingFeedback count={student.pendingFeedbackCount} /></td>
                          <td className="px-2"><StudentRowMenu student={student} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
