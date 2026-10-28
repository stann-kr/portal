/**
 * @file src/components/student-portal/CurriculumView.tsx
 * @description 커리큘럼 뷰(Curriculum·MobileCurriculum 보드) — 주차 진행률과 모듈 완료 토글.
 * RSC에서 프리패치한 initialModules를 props로 받아 클라이언트 상태로 관리한다(낙관적 반영, 실패 시 되돌림).
 */
"use client";

import { useState, useTransition } from "react";
import { BookOpen, Check } from "lucide-react";
import { toggleModuleComplete } from "@/lib/actions/curriculum";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

type Module = {
  id: string;
  weekNum: number;
  title: string;
  description: string | null;
  isCompleted: boolean;
};

interface CurriculumViewProps {
  initialModules: Module[];
  /**
   * true면 이 화면이 캔버스 머리(h1·진행률)와 본문 여백·최대 폭을 직접 그린다.
   * 워크스페이스가 자기 머리(h1)를 그리는 동안은 false로 두어 진행률과 목록만 그린다.
   */
  pageHeader?: boolean;
}

/** 주차 단위 진행: 한 주의 모듈이 모두 끝나야 그 주를 완료로 센다. */
function summarizeWeeks(modules: Module[]) {
  const weeks = new Map<number, boolean>();
  for (const item of modules) {
    weeks.set(item.weekNum, (weeks.get(item.weekNum) ?? true) && item.isCompleted);
  }
  return { total: weeks.size, completed: [...weeks.values()].filter(Boolean).length };
}

export function CurriculumView({ initialModules, pageHeader = false }: CurriculumViewProps) {
  const [modules, setModules] = useState<Module[]>(initialModules);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const completed = modules.filter((m) => m.isCompleted).length;
  const total = modules.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  const weeks = summarizeWeeks(modules);

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

  const frame = (content: React.ReactNode) => (
    pageHeader ? (
      <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
        <div className="flex max-w-[760px] flex-col gap-6 md:gap-8">{content}</div>
      </div>
    ) : (
      <div className="flex flex-col gap-6 md:gap-8">{content}</div>
    )
  );
  const title = pageHeader
    ? <h1 className="text-mobile-title font-semibold tracking-display md:text-display">커리큘럼</h1>
    : null;

  if (modules.length === 0) {
    return frame(
      <>
        {title}
        <EmptyState
          title="아직 등록된 커리큘럼이 없습니다"
          description="Stann이 주차별 학습 모듈을 등록하면 이곳에서 진도를 체크할 수 있습니다."
          icon={<BookOpen className="size-4.5" strokeWidth={1.6} aria-hidden="true" />}
        />
      </>,
    );
  }

  const progressBlock = (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between gap-3 text-body text-secondary-foreground md:text-ui">
        <span role="status">
          {isPending ? "저장 중 · " : ""}{`${weeks.total}주 중 ${weeks.completed}주 완료`}
        </span>
        <span className="font-mono text-ui">{progress}%</span>
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="커리큘럼 진행률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className="h-full origin-left bg-foreground transition-transform duration-[var(--duration-standard)] ease-studio motion-reduce:transition-none"
          style={{ transform: `scaleX(${progress / 100})` }}
        />
      </div>
    </div>
  );

  return frame(
    <>
      {title ? (
        <header className="flex flex-col gap-3.5 md:gap-4">
          {title}
          {progressBlock}
        </header>
      ) : progressBlock}
      {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : null}

      {/* 좁은 화면: 44×44 체크 | 주차 위·제목 아래. 넓은 화면: 20px 체크 | 64px 주차 칸 | 제목. */}
      <ol className="flex flex-col border-t border-border" aria-busy={isPending}>
        {modules.map((m) => (
          <li
            key={m.id}
            className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 border-b border-muted py-1.5 md:grid-cols-[auto_64px_minmax(0,1fr)] md:gap-x-4 md:gap-y-0 md:px-1 md:py-4"
          >
            <button
              type="button"
              onClick={() => handleToggle(m.id, m.isCompleted)}
              disabled={isPending}
              aria-pressed={m.isCompleted}
              aria-label={`${m.isCompleted ? "완료 취소" : "완료 표시"}: ${m.title}`}
              className="row-span-2 -ml-2.5 flex size-11 items-center justify-center rounded-touch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:row-span-1 md:ml-0 md:mt-px md:size-5 md:rounded-full"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-[22px] items-center justify-center rounded-full transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none md:size-5",
                  m.isCompleted ? "bg-primary text-primary-foreground" : "border-[1.5px] border-faint bg-background",
                )}
              >
                {m.isCompleted ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
            </button>
            <span className="col-start-2 pt-1 font-mono text-[11px] leading-4 text-muted-foreground md:col-start-auto md:pt-0.5 md:text-xs">
              WEEK {String(m.weekNum).padStart(2, "0")}
            </span>
            <span className="col-start-2 flex min-w-0 flex-col gap-0.5 md:col-start-auto">
              <span className={cn("break-words text-md font-medium", m.isCompleted && "text-muted-foreground line-through")}>
                {m.title}
              </span>
              {m.description ? <span className="text-ui text-muted-foreground">{m.description}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </>,
  );
}
