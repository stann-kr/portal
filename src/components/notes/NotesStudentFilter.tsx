"use client";

/**
 * 전체 노트 목록의 학생 필터. 고르면 같은 주소에 `?student=`(검색어는 유지)로 다시 연다.
 * 서버 page가 학생 id를 활성 학생 목록과 다시 맞춰 보므로 모르는 값은 전체로 돌아간다.
 */
import { ChevronDown } from "lucide-react";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";

export function NotesStudentFilter({
  action,
  students,
  selectedStudentId,
  query,
}: {
  action: string;
  students: ReadonlyArray<{ id: string; label: string }>;
  selectedStudentId: string | null;
  query: string;
}) {
  const router = useProgressRouter();
  return (
    <label className="flex min-w-0 items-center gap-2 text-ui text-muted-foreground max-md:w-full">
      학생
      <span className="relative flex min-w-0 flex-1 items-center md:flex-none">
        <select
          id="all-notes-student-filter"
          value={selectedStudentId ?? ""}
          onChange={(event) => {
            const params = new URLSearchParams();
            if (event.target.value) params.set("student", event.target.value);
            if (query) params.set("q", query);
            const search = params.toString();
            router.push(search ? `${action}?${search}` : action);
          }}
          className="h-11 w-full min-w-0 appearance-none rounded-touch border border-border bg-background pl-3 pr-8 text-base text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring md:h-8 md:max-w-56 md:rounded-md md:pl-2.5 md:pr-7 md:text-ui"
        >
          <option value="">전체 학생</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.label}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
      </span>
    </label>
  );
}
