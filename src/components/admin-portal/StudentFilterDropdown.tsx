/**
 * @file src/components/admin-portal/StudentFilterDropdown.tsx
 * @description 어드민 캘린더 섹션 학생 필터 드롭다운.
 * 선택된 학생 변경 시 onStudentChange 콜백 호출.
 */
"use client";

import { useTransition } from "react";
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
}

export function StudentFilterDropdown({
  students,
  selectedStudentId,
  onStudentChange,
}: StudentFilterDropdownProps) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    startTransition(() => {
      onStudentChange(id);
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      <select
        value={selectedStudentId}
        onChange={handleChange}
        disabled={isPending}
        className="text-xs rounded-md border border-input bg-background px-2 py-1 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 min-w-[120px]"
      >
        {students.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName || s.email}
          </option>
        ))}
      </select>
      {isPending && (
        <span className="text-xs text-muted-foreground">로딩 중...</span>
      )}
    </div>
  );
}
