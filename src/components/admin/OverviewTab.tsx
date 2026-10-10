/**
 * @file src/components/admin/OverviewTab.tsx
 * @description 학생 상세 — Overview 탭 (커리큘럼 + 레슨 관리).
 * 기존 students/[id]/page.tsx 클라이언트 로직을 분리한 컴포넌트.
 * 데이터는 RSC 부모(page.tsx)에서 props로 전달받음.
 */
"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  CalendarDays,
  BookOpen,
  Pencil,
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
  updateModule,
  type CreateModuleState,
} from "@/lib/actions/curriculum";
import {
  createLesson,
  deleteLesson,
  type CreateLessonState,
} from "@/lib/actions/lessons";
import { CalendarFeedControl } from "@/components/admin/CalendarFeedControl";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
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
  /** 현재 레슨 캘린더 구독 URL의 마지막 발급 시각. */
  calendarFeedIssuedAt?: Date | null;
}

// ─── 커리큘럼 추가 폼 ──────────────────────────────

// form action은 결과와 무관하게 uncontrolled 입력을 비우므로, 실패 시 입력을 지키려고 값을 제어하고 성공 때만 비운다.
function AddModuleForm({
  studentId,
  nextWeek,
}: {
  studentId: string;
  nextWeek: number;
}) {
  const [weekNum, setWeekNum] = useState(String(nextWeek));
  const [title, setTitle] = useState("");
  const [state, action, isPending] = useActionState<CreateModuleState, FormData>(
    async (previous, data) => {
      try {
        const result = await createModule(studentId, previous, data);
        if (result.success) {
          setTitle("");
          setWeekNum(String(Number(data.get("weekNum")) + 1));
        }
        return result;
      } catch {
        return { error: "모듈을 추가하지 못했습니다. 다시 시도해 주세요." };
      }
    },
    {},
  );

  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2" aria-busy={isPending}>
      <div className="space-y-1">
        <label htmlFor="module-week" className="text-xs font-medium text-muted-foreground">주차</label>
        <Input id="module-week" name="weekNum" type="number" min={1} max={520} step={1} placeholder="예: 1" className="w-24" required value={weekNum} onChange={(event) => setWeekNum(event.target.value)} disabled={isPending} />
      </div>
      <div className="min-w-52 flex-1 space-y-1">
        <label htmlFor="module-title" className="text-xs font-medium text-muted-foreground">모듈 제목</label>
        <Input id="module-title" name="title" type="text" maxLength={120} placeholder="예: BPM 매칭 연습" required value={title} onChange={(event) => setTitle(event.target.value)} disabled={isPending} />
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

// ─── 커리큘럼 수정 폼 ──────────────────────────────

/** 모듈 행 안에서 주차·제목을 고친다. 실패하면 입력을 유지하고 행 안에서 이유를 알린다. */
function EditModuleForm({
  studentId,
  curriculumModule,
  onClose,
}: {
  studentId: string;
  curriculumModule: Module;
  onClose: () => void;
}) {
  const [weekNum, setWeekNum] = useState(String(curriculumModule.weekNum ?? 1));
  const [title, setTitle] = useState(curriculumModule.title);
  const titleRef = useRef<HTMLInputElement>(null);
  const fieldId = `module-edit-${curriculumModule.id}`;
  const [state, action, isPending] = useActionState<CreateModuleState, FormData>(
    async (previous, data) => {
      try {
        const result = await updateModule(curriculumModule.id, studentId, previous, data);
        if (result.success) onClose();
        return result;
      } catch {
        return { error: "모듈을 수정하지 못했습니다. 다시 시도해 주세요." };
      }
    },
    {},
  );

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <form
      action={action}
      aria-label={`${curriculumModule.title} 모듈 수정`}
      aria-busy={isPending}
      className="flex flex-wrap items-end gap-2"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isPending) onClose();
      }}
    >
      <div className="space-y-1">
        <label htmlFor={`${fieldId}-week`} className="text-xs font-medium text-muted-foreground">주차</label>
        <Input id={`${fieldId}-week`} name="weekNum" type="number" min={1} max={520} step={1} className="w-24" required value={weekNum} onChange={(event) => setWeekNum(event.target.value)} disabled={isPending} />
      </div>
      <div className="min-w-52 flex-1 space-y-1">
        <label htmlFor={`${fieldId}-title`} className="text-xs font-medium text-muted-foreground">모듈 제목</label>
        <Input ref={titleRef} id={`${fieldId}-title`} name="title" type="text" maxLength={120} required value={title} onChange={(event) => setTitle(event.target.value)} disabled={isPending} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>{isPending ? "저장 중..." : "저장"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={isPending}>취소</Button>
      </div>
      {state.error ? <p className="w-full text-xs text-destructive" role="alert">{state.error}</p> : null}
    </form>
  );
}

// ─── 레슨 추가 폼 ──────────────────────────────────

function AddLessonForm({ studentId }: { studentId: string }) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [state, action, isPending] = useActionState<CreateLessonState, FormData>(
    async (previous, data) => {
      try {
        const result = await createLesson(studentId, previous, data);
        if (result.success) setScheduledAt("");
        return result;
      } catch {
        return { error: "레슨을 추가하지 못했습니다. 다시 시도해 주세요." };
      }
    },
    {},
  );

  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2" aria-busy={isPending}>
      <div className="min-w-52 flex-1 space-y-1">
        <label htmlFor="lesson-scheduled-at" className="text-xs font-medium text-muted-foreground">레슨 날짜와 시간</label>
        <Input id="lesson-scheduled-at" name="scheduledAt" type="datetime-local" required value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} disabled={isPending} />
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
  calendarFeedIssuedAt = null,
}: OverviewTabProps) {
  const [isPending, startTransition] = useTransition();
  const [mutationError, setMutationError] = useState("");
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const closeModuleEdit = (moduleId: string) => {
    setEditingModuleId(null);
    // 수정 form이 닫힌 뒤 같은 행의 수정 버튼으로 초점을 돌려준다.
    requestAnimationFrame(() => document.getElementById(`module-edit-trigger-${moduleId}`)?.focus());
  };

  const moduleDeleteConfirm = useConfirmAction<string>();
  const lessonDeleteConfirm = useConfirmAction<string>();

  const handleDeleteModule = (moduleId: string) => {
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
          <BookOpen className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
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
            {modules.map((m) => editingModuleId === m.id ? (
              <li key={m.id} className="rounded-lg border border-primary/30 bg-card p-3">
                <EditModuleForm studentId={studentId} curriculumModule={m} onClose={() => closeModuleEdit(m.id)} />
              </li>
            ) : (
              <li
                key={m.id}
                className="group space-y-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-center gap-3">
                {m.isCompleted ? (
                  <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" aria-hidden="true" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                )}
                <span className="sr-only">{m.isCompleted ? "완료" : "진행 전"}</span>
                <span className="text-xs font-bold text-muted-foreground w-12">
                  WEEK {String(m.weekNum ?? 0).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 break-words text-sm font-medium">{m.title}</span>
                <Button
                  id={`module-edit-trigger-${m.id}`}
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingModuleId(m.id)}
                  disabled={isPending}
                  aria-label={`${m.title} 모듈 수정`}
                  className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                >
                  <Pencil className="w-4 h-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(event) => moduleDeleteConfirm.request(event.currentTarget, m.id)}
                  disabled={isPending}
                  aria-expanded={moduleDeleteConfirm.value === m.id}
                  aria-label={`${m.title} 모듈 삭제`}
                  className="text-destructive opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 aria-expanded:opacity-100"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </Button>
                </div>
                {moduleDeleteConfirm.value === m.id ? (
                  <ConfirmPanel
                    confirm={moduleDeleteConfirm}
                    message={`${m.title} 모듈을 삭제할까요? 학생의 진도 표시에서도 사라집니다.`}
                    confirmLabel="모듈 삭제 확인"
                    pendingLabel="삭제 중..."
                    pending={isPending}
                    onConfirm={() => handleDeleteModule(m.id)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <AddModuleForm
          studentId={studentId}
          nextWeek={modules.reduce((max, module) => Math.max(max, module.weekNum ?? 0), 0) + 1}
        />
      </section>

      {/* 레슨 일정 */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <CalendarDays className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold">레슨 일정</h2>
          <span className="ml-auto text-sm text-muted-foreground">
            {lessons.length}개
          </span>
        </div>

        <CalendarFeedControl studentId={studentId} issuedAt={calendarFeedIssuedAt} />

        {lessons.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            등록된 레슨이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {lessons.map((l) => {
              const date = new Date(l.scheduledAt!);
              const isPast = date < new Date();
              const lessonLabel = formatKst(date, { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
              return (
                <li
                  key={l.id}
                  className="group space-y-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className={`flex items-center gap-3 ${isPast ? "opacity-50" : ""}`}>
                  <CalendarDays className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
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
                    onClick={(event) => lessonDeleteConfirm.request(event.currentTarget, l.id)}
                    disabled={isPending}
                    aria-expanded={lessonDeleteConfirm.value === l.id}
                    aria-label={`${lessonLabel} 레슨 삭제`}
                    className="text-destructive opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 aria-expanded:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </Button>
                  </div>
                  {lessonDeleteConfirm.value === l.id ? (
                    <ConfirmPanel
                      confirm={lessonDeleteConfirm}
                      message={`${lessonLabel} 레슨을 삭제할까요? 학생의 일정과 구독 캘린더에서도 사라집니다.`}
                      confirmLabel="레슨 삭제 확인"
                      pendingLabel="삭제 중..."
                      pending={isPending}
                      onConfirm={() => handleDeleteLesson(l.id)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <AddLessonForm studentId={studentId} />
      </section>
    </div>
  );
}
