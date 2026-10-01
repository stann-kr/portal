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
  const [error, setError] = useState<string | null>(null);

  const completed = modules.filter((m) => m.isCompleted).length;
  const total = modules.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  const handleToggle = (id: string, current: boolean) => {
    if (isPending) return;
    setError(null);
    // 낙관적 업데이트
    setModules((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isCompleted: !current } : m)),
    );
    startTransition(async () => {
      try {
        await toggleModuleComplete(id, current);
      } catch {
        setModules((previous) => previous.map((module) => module.id === id ? { ...module, isCompleted: current } : module));
        setError("진도를 저장하지 못했습니다. 이전 상태로 되돌렸습니다. 다시 시도해 주세요.");
      }
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
          <span className="text-muted-foreground" role="status">
            {isPending ? "저장 중 · " : ""}{completed} / {total} 완료
          </span>
          <span className="font-semibold">{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-label="커리큘럼 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div
            className="h-full origin-left rounded-full bg-foreground transition-transform duration-[var(--duration-standard)] ease-studio motion-reduce:transition-none"
            style={{ transform: `scaleX(${progress / 100})` }}
          />
        </div>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

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
              type="button"
              onClick={() => handleToggle(m.id, m.isCompleted)}
              disabled={isPending}
              className="flex size-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              aria-pressed={m.isCompleted}
              aria-label={`${m.title}: ${m.isCompleted ? "미완료로 변경" : "완료로 변경"}`}
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
