/**
 * @file src/components/admin-portal/StudentFilterDropdown.tsx
 * @description 어드민 캘린더 섹션 학생 필터 드롭다운.
 * 선택된 학생 변경 시 onStudentChange 콜백 호출.
 */
"use client";

import { Users } from "lucide-react";

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
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onStudentChange(e.target.value);
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
      <label htmlFor="calendar-student-filter" className="sr-only">
        캘린더 학생 선택
      </label>
      <select
        id="calendar-student-filter"
        value={selectedStudentId}
        onChange={handleChange}
        disabled={loading}
        aria-busy={loading}
        className="h-9 min-w-0 max-w-full flex-1 rounded-md border border-input bg-surface px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {students.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName || s.email}
          </option>
        ))}
      </select>
      {loading && (
        <span className="text-xs text-muted-foreground" role="status">로딩 중...</span>
      )}
    </div>
  );
}
