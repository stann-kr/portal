/**
 * @file src/components/student-portal/CurriculumView.tsx
 * @description 커리큘럼 뷰 — 주차별 모듈 진행률 + 완료 토글.
 * RSC에서 프리패치한 initialModules를 props로 받아 클라이언트 상태 관리.
 */
"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { toggleModuleComplete } from "@/lib/actions/curriculum";

type Module = {
  id: string;
  weekNum: number;
  title: string;
  description: string | null;
  isCompleted: boolean;
};

interface CurriculumViewProps {
  initialModules: Module[];
}

export function CurriculumView({ initialModules }: CurriculumViewProps) {
  const [modules, setModules] = useState<Module[]>(initialModules);
  const [isPending, startTransition] = useTransition();

  const completed = modules.filter((m) => m.isCompleted).length;
  const total = modules.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  const handleToggle = (id: string, current: boolean) => {
    // 낙관적 업데이트
    setModules((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isCompleted: !current } : m)),
    );
    startTransition(async () => {
      await toggleModuleComplete(id, current);
    });
  };

  if (modules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border border-dashed rounded-xl bg-muted/20 text-muted-foreground">
        <p className="text-sm">아직 등록된 커리큘럼이 없습니다.</p>
        <p className="text-xs mt-1">강사에게 문의하세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 진행률 바 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {completed} / {total} 완료
          </span>
          <span className="font-semibold">{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-foreground transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 모듈 목록 */}
      <ul className="space-y-2" aria-busy={isPending}>
        {modules.map((m) => (
          <li
            key={m.id}
            className={`flex items-center gap-4 p-4 rounded-xl border border-border bg-card transition-colors ${
              m.isCompleted ? "opacity-60" : "hover:bg-accent/5"
            }`}
          >
            <button
              onClick={() => handleToggle(m.id, m.isCompleted)}
              disabled={isPending}
              className="flex-shrink-0 transition-transform hover:scale-110 disabled:opacity-50"
              aria-label={m.isCompleted ? "미완료로 변경" : "완료로 변경"}
            >
              {m.isCompleted ? (
                <CheckCircle2 className="w-5 h-5 text-success" />
              ) : (
                <Circle className="w-5 h-5 text-muted-foreground" />
              )}
            </button>

            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                WEEK {String(m.weekNum).padStart(2, "0")}
              </span>
              <p className={`font-medium mt-0.5 ${m.isCompleted ? "line-through" : ""}`}>
                {m.title}
              </p>
              {m.description && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {m.description}
                </p>
              )}
            </div>

            {m.isCompleted && (
              <span className="text-xs text-success font-medium flex-shrink-0">완료</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
