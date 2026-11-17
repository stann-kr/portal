"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { restoreStudent } from "@/lib/actions/students";
import { withObjectParticle } from "@/lib/korean-particle";

export type ArchivedStudentRow = {
  id: string;
  /** 표시 이름(없으면 이메일). */
  name: string;
  email: string;
  /** 수강 종료한 날("11.18"). */
  archivedLabel: string;
};

const ADMIN_STUDENTS_HREF = "/dashboard/admin?section=students";

function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "학";
}

/**
 * 수강 종료한 학생 목록과 복원(캔버스 StudentArchive ②·③). 복원은 다시 수강 종료할 수 있는 일이라 확인 없이 바로 한다.
 * 복원한 학생은 서버가 목록을 다시 보내 줄에서 빠지고, 결과 안내로 초점을 옮긴다(누른 버튼이 사라지므로).
 */
export function ArchivedStudentsClient({ students }: { students: ArchivedStudentRow[] }) {
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const messageRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message) messageRef.current?.focus({ preventScroll: true });
  }, [message]);

  const restore = (student: ArchivedStudentRow) => {
    setError(null);
    setMessage(null);
    setRestoringId(student.id);
    startTransition(async () => {
      try {
        const result = await restoreStudent(student.id);
        if (result.ok) {
          setMessage(`${withObjectParticle(result.name)} 복원했습니다. 다시 로그인할 수 있습니다.`);
        } else {
          setError(result.error);
        }
      } catch {
        setError("복원하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
      } finally {
        setRestoringId(null);
      }
    });
  };

  const restoreLabel = (student: ArchivedStudentRow) => (restoringId === student.id ? "복원 중…" : "복원");
  const countLabel = `${students.length}명`;

  return (
    <div className="flex max-w-[1080px] flex-col gap-1 md:mx-auto md:gap-6">
      <header className="sr-only md:not-sr-only md:flex md:flex-col md:gap-1">
        <Link
          href={ADMIN_STUDENTS_HREF}
          className="self-start rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          학생
        </Link>
        <h1 className="text-display font-semibold tracking-display text-foreground">수강 종료한 학생</h1>
        <p className="text-body text-secondary-foreground">
          {countLabel} · 로그인할 수 없고 학생 목록·선택지에 보이지 않습니다. 복원하면 기록과 함께 그대로 돌아옵니다.
        </p>
      </header>
      <p className="flex min-h-11 items-center text-ui leading-[18px] text-muted-foreground md:hidden" aria-hidden="true">
        {countLabel} · 복원하면 기록과 함께 그대로 돌아옵니다.
      </p>

      {/* 알림 영역은 늘 있어야 읽어 주므로, 비어 있을 때 간격을 더 만들지 않게 목록과 한 묶음으로 둔다. */}
      <div className="flex flex-col">
        <div aria-live="polite" aria-atomic="true">
          {message ? (
            <p
              ref={messageRef}
              tabIndex={-1}
              className="mb-2 flex min-h-9 items-center rounded-md bg-sidebar px-3 py-2 text-ui text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:mb-4"
            >
              {message}
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="mb-2 text-ui text-destructive md:mb-4">
            {error}
          </p>
        ) : null}

        {students.length === 0 ? (
          <p className="border-t border-border py-4 text-body text-muted-foreground">수강 종료한 학생이 없습니다.</p>
        ) : (
          <>
            <ul className="flex flex-col border-t border-border md:hidden" aria-label="수강 종료한 학생">
              {students.map((student) => (
                <li key={student.id} className="flex items-center gap-3 border-b border-muted py-2.5">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-ui font-semibold text-muted-foreground"
                  >
                    {initialOf(student.name)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-md font-medium text-secondary-foreground">{student.name}</span>
                    <span className="text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums">{student.archivedLabel}</span> 종료
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0 rounded-touch px-4 text-body"
                    aria-label={`${student.name} 복원`}
                    disabled={isPending}
                    onClick={() => restore(student)}
                  >
                    {restoreLabel(student)}
                  </Button>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[560px] table-fixed border-collapse text-left text-body">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="h-9 px-2 text-xs font-normal text-muted-foreground">수강생</th>
                    <th scope="col" className="w-[110px] px-2 text-xs font-normal text-muted-foreground">수강 종료</th>
                    <th scope="col" className="w-[84px] px-2"><span className="sr-only">복원</span></th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.id} className="border-b border-muted">
                      <td className="h-13 px-2">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                          >
                            {initialOf(student.name)}
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium text-secondary-foreground">{student.name}</span>
                            <span className="truncate text-xs text-muted-foreground">{student.email}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-2 font-mono text-xs tabular-nums text-secondary-foreground">{student.archivedLabel}</td>
                      <td className="px-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="px-3"
                          aria-label={`${student.name} 복원`}
                          disabled={isPending}
                          onClick={() => restore(student)}
                        >
                          {restoreLabel(student)}
                        </Button>
                      </td>
                    </tr>
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
