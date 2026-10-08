/**
 * @file src/components/admin/OverviewTab.tsx
 * @description 학생 상세 — Overview 탭 (커리큘럼 + 레슨 관리).
 * 기존 students/[id]/page.tsx 클라이언트 로직을 분리한 컴포넌트.
 * 데이터는 RSC 부모(page.tsx)에서 props로 전달받음.
 */
"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  CalendarDays,
  BookOpen,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createModule,
  deleteModule,
  type CreateModuleState,
} from "@/lib/actions/curriculum";
import {
  createLesson,
  deleteLesson,
  type CreateLessonState,
} from "@/lib/actions/lessons";
import { CalendarFeedControl } from "@/components/admin/CalendarFeedControl";
import { formatKst } from "@/lib/kst-format";

// ─── 타입 ──────────────────────────────────────────
interface Module {
  id: string;
  weekNum: number | null;
  title: string;
  isCompleted: boolean | null;
}

interface Lesson {
  id: string;
  scheduledAt: Date | null;
}

interface OverviewTabProps {
  studentId: string;
  modules: Module[];
  lessons: Lesson[];
}

// ─── 커리큘럼 추가 폼 ──────────────────────────────

function AddModuleForm({
  studentId,
  onSuccess,
}: {
  studentId: string;
  onSuccess: () => void;
}) {
  const boundAction = createModule.bind(null, studentId);
  const [state, action, isPending] = useActionState<CreateModuleState, FormData>(
    boundAction,
    {},
  );

  useEffect(() => {
    if (state.success) onSuccess();
  }, [state.success, onSuccess]);

  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2" aria-busy={isPending}>
      <div className="space-y-1">
        <label htmlFor="module-week" className="text-xs font-medium text-muted-foreground">주차</label>
        <Input id="module-week" name="weekNum" type="number" min={1} placeholder="예: 1" className="w-24" required disabled={isPending} />
      </div>
      <div className="min-w-52 flex-1 space-y-1">
        <label htmlFor="module-title" className="text-xs font-medium text-muted-foreground">모듈 제목</label>
        <Input id="module-title" name="title" type="text" placeholder="예: BPM 매칭 연습" required disabled={isPending} />
      </div>
      <Button type="submit" size="sm" disabled={isPending} className="gap-1">
        <Plus className="w-4 h-4" aria-hidden="true" />
        추가
      </Button>
      {state.error && (
        <p className="w-full text-xs text-destructive" role="alert">{state.error}</p>
      )}
    </form>
  );
}

// ─── 레슨 추가 폼 ──────────────────────────────────

function AddLessonForm({
  studentId,
  onSuccess,
}: {
  studentId: string;
  onSuccess: () => void;
}) {
  const boundAction = createLesson.bind(null, studentId);
  const [state, action, isPending] = useActionState<CreateLessonState, FormData>(
    boundAction,
    {},
  );

  useEffect(() => {
    if (state.success) onSuccess();
  }, [state.success, onSuccess]);

  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2" aria-busy={isPending}>
      <div className="min-w-52 flex-1 space-y-1">
        <label htmlFor="lesson-scheduled-at" className="text-xs font-medium text-muted-foreground">레슨 날짜와 시간</label>
        <Input id="lesson-scheduled-at" name="scheduledAt" type="datetime-local" required disabled={isPending} />
      </div>
      <Button type="submit" size="sm" disabled={isPending} className="gap-1">
        <Plus className="w-4 h-4" aria-hidden="true" />
        추가
      </Button>
      {state.error && (
        <p className="w-full text-xs text-destructive" role="alert">{state.error}</p>
      )}
    </form>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────

export function OverviewTab({
  studentId,
  modules,
  lessons,
}: OverviewTabProps) {
  const [isPending, startTransition] = useTransition();
  const [mutationError, setMutationError] = useState("");

  const handleDeleteModule = (moduleId: string) => {
    if (!confirm("이 모듈을 삭제하시겠습니까?")) return;
    setMutationError("");
    startTransition(async () => {
      try {
        await deleteModule(moduleId, studentId);
      } catch {
        setMutationError("모듈을 삭제하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  const handleDeleteLesson = (lessonId: string) => {
    if (!confirm("이 레슨을 삭제하시겠습니까?")) return;
    setMutationError("");
    startTransition(async () => {
      try {
        await deleteLesson(lessonId, studentId);
      } catch {
        setMutationError("레슨을 삭제하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div className="space-y-10">
      {mutationError ? <p className="text-sm text-destructive" role="alert">{mutationError}</p> : null}
      {/* 커리큘럼 */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <BookOpen className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">커리큘럼</h2>
          <span className="ml-auto text-sm text-muted-foreground">
            {modules.length}개
          </span>
        </div>

        {modules.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            등록된 모듈이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {modules.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card group"
              >
                {m.isCompleted ? (
                  <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-xs font-bold text-muted-foreground w-12">
                  WEEK {String(m.weekNum ?? 0).padStart(2, "0")}
                </span>
                <span className="flex-1 text-sm font-medium">{m.title}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteModule(m.id)}
                  disabled={isPending}
                  aria-label={`${m.title} 모듈 삭제`}
                  className="text-destructive opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <AddModuleForm
          studentId={studentId}
          onSuccess={() => {
            /* RSC revalidate 처리됨 */
          }}
        />
      </section>

      {/* 레슨 일정 */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <CalendarDays className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">레슨 일정</h2>
          <span className="ml-auto text-sm text-muted-foreground">
            {lessons.length}개
          </span>
        </div>

        <CalendarFeedControl studentId={studentId} />

        {lessons.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            등록된 레슨이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {lessons.map((l) => {
              const date = new Date(l.scheduledAt!);
              const isPast = date < new Date();
              return (
                <li
                  key={l.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border border-border bg-card group ${isPast ? "opacity-50" : ""}`}
                >
                  <CalendarDays className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {formatKst(date, { year: "numeric", month: "long", day: "numeric" })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatKst(date, { hour: "2-digit", minute: "2-digit" })}
                      {isPast && " · 지난 레슨"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteLesson(l.id)}
                    disabled={isPending}
                    aria-label={`${formatKst(date, { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} 레슨 삭제`}
                    className="text-destructive opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <AddLessonForm
          studentId={studentId}
          onSuccess={() => {
            /* RSC revalidate 처리됨 */
          }}
        />
      </section>
    </div>
  );
}
