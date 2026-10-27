/**
 * @file src/components/admin-portal/StudentFilterDropdown.tsx
 * @description 관리자 일정의 학생 선택(캔버스 AdminSchedule 머리의 "학생" 선택, MobileAdminSchedule의 44px 선택).
 * 선택된 학생 변경 시 onStudentChange 콜백 호출.
 */
"use client";

import { ChevronDown } from "lucide-react";

type Student = {
  id: string;
  email: string;
  displayName: string | null;
};

interface StudentFilterDropdownProps {
  students: Student[];
  selectedStudentId: string;
  onStudentChange: (studentId: string) => void;
  loading?: boolean;
}

export function StudentFilterDropdown({
  students,
  selectedStudentId,
  onStudentChange,
  loading = false,
}: StudentFilterDropdownProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-3 text-body text-muted-foreground md:flex-none md:gap-2 md:text-ui">
        학생
        {/* 엔진마다 다른 기본 화살표 대신 정렬 상자와 같은 화살표를 그린다. */}
        <span className="relative flex min-w-0 flex-1 items-center md:flex-none">
          <select
            id="calendar-student-filter"
            value={selectedStudentId}
            onChange={(event) => onStudentChange(event.target.value)}
            disabled={loading}
            aria-busy={loading}
            className="h-11 w-full min-w-0 appearance-none rounded-touch border border-border bg-background pl-3 pr-8 text-base text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:h-8 md:max-w-56 md:rounded-md md:pl-2.5 md:pr-7 md:text-ui"
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName || s.email}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
        </span>
      </label>
      {loading ? (
        <span className="shrink-0 text-xs text-muted-foreground" role="status">불러오는 중</span>
      ) : null}
    </div>
  );
}
