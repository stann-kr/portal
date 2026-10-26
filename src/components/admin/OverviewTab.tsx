/**
 * @file src/components/admin/OverviewTab.tsx
 * @description 학생 상세 — 개요 탭(AdminStudentDetail·MobileAdminStudentDetail 보드).
 * 넓은 화면은 왼쪽 커리큘럼·레슨 일정, 오른쪽 계정. 좁은 화면은 레슨 일정 → 커리큘럼 → 계정 순서다.
 * 데이터는 RSC 부모(page.tsx)에서 props로 전달받음.
 */
"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { StudentInviteControl } from "@/components/admin/StudentInviteControl";
import { StudentPasswordResetControl } from "@/components/admin/StudentPasswordResetControl";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { formatKst } from "@/lib/kst-format";
import { cn } from "@/lib/utils";
import { formatKstDot } from "@/components/student-portal/today/format";
import {
  LEDGER_ADD_ROW_CLASS,
  LEDGER_HEADER_LINK_CLASS,
  LedgerEmptyRow,
  LedgerSection,
  LedgerSectionHeader,
} from "@/components/student-portal/today/HomeSection";

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
  /** 학생 계정 상태. 가입 대기면 만료 시각과 서버가 판단한 만료 여부를 함께 받는다. */
  account?:
    | { kind: "active" | "temporary" }
    | { kind: "invite"; expiresAt: Date; expired: boolean };
  /** 지난 레슨·다음 레슨을 가르는 서버 기준 시각. 없으면 화면을 연 시각을 쓴다. */
  referenceTime?: Date;
}

/**
 * 목록 행 끝의 수정·삭제 아이콘 버튼: 넓은 화면 32px·행 hover/focus 때 보임, 좁은 화면 44px·위쪽 막대
 * 더 보기의 "레슨·커리큘럼 편집"(`?edit=1`)일 때만 보임(MobileAdminStudentDetail 보드는 행에 아이콘이 없다).
 */
const ROW_ICON_BUTTON_CLASS =
  "size-11 shrink-0 rounded-touch opacity-100 transition-opacity md:size-8 md:rounded-md md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 aria-expanded:opacity-100";

const FIELD_LABEL_CLASS = "text-xs font-medium text-secondary-foreground";

/** 추가 form을 연 버튼으로 초점을 돌려준다(form이 닫힌 뒤 버튼이 다시 그려진다). */
function focusAfterClose(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

// ─── 커리큘럼 추가 폼 ──────────────────────────────

// form action은 결과와 무관하게 uncontrolled 입력을 비우므로, 실패 시 입력을 지키려고 값을 제어하고 성공 때만 비운다.
function AddModuleForm({
  studentId,
  nextWeek,
  onClose,
}: {
  studentId: string;
  nextWeek: number;
  onClose: () => void;
}) {
  const [weekNum, setWeekNum] = useState(String(nextWeek));
  const [title, setTitle] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <form
      action={action}
      aria-label="모듈 추가"
      aria-busy={isPending}
      className="flex flex-wrap items-end gap-2 border-b border-muted py-3 md:px-1"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isPending) onClose();
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="module-week" className={FIELD_LABEL_CLASS}>주차</label>
        <Input id="module-week" name="weekNum" type="number" min={1} max={520} step={1} placeholder="예: 1" className="w-24 font-mono" required value={weekNum} onChange={(event) => setWeekNum(event.target.value)} disabled={isPending} />
      </div>
      <div className="flex min-w-52 flex-1 flex-col gap-1">
        <label htmlFor="module-title" className={FIELD_LABEL_CLASS}>모듈 제목</label>
        <Input ref={titleRef} id="module-title" name="title" type="text" maxLength={120} placeholder="예: BPM 매칭 연습" required value={title} onChange={(event) => setTitle(event.target.value)} disabled={isPending} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 rounded-touch md:h-9 md:rounded-md" onClick={onClose} disabled={isPending}>닫기</Button>
        <Button type="submit" className="h-11 rounded-touch md:h-9 md:rounded-md" disabled={isPending}>
          {isPending ? "추가 중..." : "추가"}
        </Button>
      </div>
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
      <div className="flex flex-col gap-1">
        <label htmlFor={`${fieldId}-week`} className={FIELD_LABEL_CLASS}>주차</label>
        <Input id={`${fieldId}-week`} name="weekNum" type="number" min={1} max={520} step={1} className="w-24 font-mono" required value={weekNum} onChange={(event) => setWeekNum(event.target.value)} disabled={isPending} />
      </div>
      <div className="flex min-w-52 flex-1 flex-col gap-1">
        <label htmlFor={`${fieldId}-title`} className={FIELD_LABEL_CLASS}>모듈 제목</label>
        <Input ref={titleRef} id={`${fieldId}-title`} name="title" type="text" maxLength={120} required value={title} onChange={(event) => setTitle(event.target.value)} disabled={isPending} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 rounded-touch md:h-9 md:rounded-md" onClick={onClose} disabled={isPending}>취소</Button>
        <Button type="submit" className="h-11 rounded-touch md:h-9 md:rounded-md" disabled={isPending}>{isPending ? "저장 중..." : "저장"}</Button>
      </div>
      {state.error ? <p className="w-full text-xs text-destructive" role="alert">{state.error}</p> : null}
    </form>
  );
}

// ─── 레슨 추가 폼 ──────────────────────────────────

function AddLessonForm({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [scheduledAt, setScheduledAt] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      action={action}
      aria-label="레슨 추가"
      aria-busy={isPending}
      className="flex flex-wrap items-end gap-2 border-b border-muted py-3 md:px-1"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isPending) onClose();
      }}
    >
      <div className="flex min-w-52 flex-1 flex-col gap-1">
        <label htmlFor="lesson-scheduled-at" className={FIELD_LABEL_CLASS}>레슨 날짜와 시간</label>
        <Input ref={inputRef} id="lesson-scheduled-at" name="scheduledAt" type="datetime-local" className="font-mono" required value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} disabled={isPending} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 rounded-touch md:h-9 md:rounded-md" onClick={onClose} disabled={isPending}>닫기</Button>
        <Button type="submit" className="h-11 rounded-touch md:h-9 md:rounded-md" disabled={isPending}>
          {isPending ? "추가 중..." : "추가"}
        </Button>
      </div>
      {state.error && (
        <p className="w-full text-xs text-destructive" role="alert">{state.error}</p>
      )}
    </form>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────

/** 앞으로의 레슨은 가까운 순서, 지난 레슨은 그 뒤에 최근 순서로 둔다(보드의 다음 → 이후 → 지난). */
function orderLessons(lessons: Lesson[], now: number) {
  const dated = lessons
    .filter((lesson): lesson is Lesson & { scheduledAt: Date } => lesson.scheduledAt !== null)
    .map((lesson) => ({ ...lesson, time: new Date(lesson.scheduledAt).getTime() }));
  const upcoming = dated.filter((lesson) => lesson.time >= now).sort((a, b) => a.time - b.time);
  const past = dated.filter((lesson) => lesson.time < now).sort((a, b) => b.time - a.time);
  return [...upcoming.map((lesson, index) => ({ ...lesson, past: false, note: index === 0 ? "다음 레슨" : "" })),
    ...past.map((lesson) => ({ ...lesson, past: true, note: "지난 레슨" }))];
}

export function OverviewTab({
  studentId,
  modules,
  lessons,
  calendarFeedIssuedAt = null,
  account = { kind: "active" },
  referenceTime,
}: OverviewTabProps) {
  const searchParams = useSearchParams();
  const rowEditing = searchParams?.get("edit") === "1";
  const rowIconClass = cn(ROW_ICON_BUTTON_CLASS, !rowEditing && "max-md:hidden");
  const [openedAt] = useState(() => Date.now());
  const now = referenceTime?.getTime() ?? openedAt;
  const reference = new Date(now);
  const [isPending, startTransition] = useTransition();
  const [mutationError, setMutationError] = useState("");
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [addingModule, setAddingModule] = useState(false);
  const [addingLesson, setAddingLesson] = useState(false);
  const closeModuleEdit = (moduleId: string) => {
    setEditingModuleId(null);
    // 수정 form이 닫힌 뒤 같은 행의 수정 버튼으로 초점을 돌려준다.
    focusAfterClose(`module-edit-trigger-${moduleId}`);
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

  const completedCount = modules.filter((module) => module.isCompleted).length;
  const orderedLessons = orderLessons(lessons, now);
  const scheduleHref = `/dashboard/admin?section=schedule&student=${encodeURIComponent(studentId)}`;

  return (
    <div className="flex flex-col gap-6 md:flex-row md:flex-wrap md:items-start md:gap-x-14 md:gap-y-10">
      {mutationError ? <p className="basis-full text-body text-destructive" role="alert">{mutationError}</p> : null}
      {rowEditing ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-sidebar py-1 pl-4 pr-1 md:hidden">
          <p className="text-ui text-secondary-foreground">레슨·커리큘럼을 고치거나 지울 수 있습니다.</p>
          <Link
            href={`/dashboard/admin/students/${encodeURIComponent(studentId)}?tab=overview`}
            replace
            className="flex h-11 shrink-0 items-center rounded-touch px-3 text-ui font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            편집 완료
          </Link>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-6 md:flex-[2_1_480px] md:gap-10">
        {/* 커리큘럼 */}
        <LedgerSection labelledBy="curriculum-heading">
          <LedgerSectionHeader
            id="curriculum-heading"
            title="커리큘럼"
            count={modules.length > 0 ? `${completedCount} / ${modules.length}` : undefined}
          />
          {modules.length === 0 ? (
            <LedgerEmptyRow>등록된 모듈이 없습니다.</LedgerEmptyRow>
          ) : (
            <ul>
              {modules.map((m) => editingModuleId === m.id ? (
                <li key={m.id} className="border-b border-muted py-3 md:px-1">
                  <EditModuleForm studentId={studentId} curriculumModule={m} onClose={() => closeModuleEdit(m.id)} />
                </li>
              ) : (
                <li key={m.id} className="group border-b border-muted">
                  <div className="flex min-h-12 items-center gap-3 md:min-h-11 md:gap-3.5 md:px-1">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-[18px] shrink-0 rounded-full md:size-4",
                        m.isCompleted ? "bg-foreground" : "border-[1.5px] border-faint",
                      )}
                    />
                    <span className="sr-only">{m.isCompleted ? "완료" : "진행 전"}</span>
                    <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                      WEEK {String(m.weekNum ?? 0).padStart(2, "0")}
                    </span>
                    <span className={cn("min-w-0 flex-1 break-words py-2 text-md md:text-body", m.isCompleted && "text-muted-foreground line-through")}>
                      {m.title}
                    </span>
                    <Button
                      id={`module-edit-trigger-${m.id}`}
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingModuleId(m.id)}
                      disabled={isPending}
                      aria-label={`${m.title} 모듈 수정`}
                      className={rowIconClass}
                    >
                      <Pencil className="size-4" strokeWidth={1.6} aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(event) => moduleDeleteConfirm.request(event.currentTarget, m.id)}
                      disabled={isPending}
                      aria-expanded={moduleDeleteConfirm.value === m.id}
                      aria-label={`${m.title} 모듈 삭제`}
                      className={cn(rowIconClass, "text-destructive hover:text-destructive")}
                    >
                      <Trash2 className="size-4" strokeWidth={1.6} aria-hidden="true" />
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
                      className="mb-3"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {addingModule ? (
            <AddModuleForm
              studentId={studentId}
              nextWeek={modules.reduce((max, module) => Math.max(max, module.weekNum ?? 0), 0) + 1}
              onClose={() => {
                setAddingModule(false);
                focusAfterClose("module-add-trigger");
              }}
            />
          ) : (
            <button id="module-add-trigger" type="button" className={LEDGER_ADD_ROW_CLASS} onClick={() => setAddingModule(true)}>
              <Plus className="size-4 md:size-3.5" strokeWidth={1.8} aria-hidden="true" />
              모듈 추가
            </button>
          )}
        </LedgerSection>

        {/* 레슨 일정: 좁은 화면에서는 맨 위 */}
        <LedgerSection labelledBy="lessons-heading" className="max-md:order-first">
          <LedgerSectionHeader
            id="lessons-heading"
            title="레슨 일정"
            aside={<Link href={scheduleHref} className={cn(LEDGER_HEADER_LINK_CLASS, "hidden md:flex")}>캘린더에서 보기</Link>}
          />
          {orderedLessons.length === 0 ? (
            <LedgerEmptyRow>등록된 레슨이 없습니다.</LedgerEmptyRow>
          ) : (
            <ul>
              {orderedLessons.map((l) => {
                const lessonLabel = formatKst(l.scheduledAt, { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
                return (
                  <li key={l.id} className="group border-b border-muted">
                    <div className="flex h-12 items-center gap-3 md:h-11 md:gap-3.5 md:px-1">
                      <span
                        className={cn(
                          "min-w-35 shrink-0 font-mono text-ui md:min-w-40",
                          l.past ? "text-muted-foreground" : "text-foreground",
                        )}
                      >
                        {formatKstDot(l.scheduledAt, { weekday: true, time: true, referenceTime: reference })}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{l.note}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(event) => lessonDeleteConfirm.request(event.currentTarget, l.id)}
                        disabled={isPending}
                        aria-expanded={lessonDeleteConfirm.value === l.id}
                        aria-label={`${lessonLabel} 레슨 삭제`}
                        className={cn(rowIconClass, "text-destructive hover:text-destructive")}
                      >
                        <Trash2 className="size-4" strokeWidth={1.6} aria-hidden="true" />
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
                        className="mb-3"
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {addingLesson ? (
            <AddLessonForm
              studentId={studentId}
              onClose={() => {
                setAddingLesson(false);
                focusAfterClose("lesson-add-trigger");
              }}
            />
          ) : (
            <button id="lesson-add-trigger" type="button" className={LEDGER_ADD_ROW_CLASS} onClick={() => setAddingLesson(true)}>
              <Plus className="size-4 md:size-3.5" strokeWidth={1.8} aria-hidden="true" />
              레슨 추가
            </button>
          )}
        </LedgerSection>
      </div>

      {/* 계정: 상태 줄을 먼저 모으고(order 1·2) 조작은 버튼 순서대로(order 3·4) 둔다. DOM은 조작마다 자기 상태 줄과 붙어 있다. */}
      <LedgerSection labelledBy="account-heading" className="md:flex-[1_1_280px]">
        <LedgerSectionHeader id="account-heading" title="계정" />
        <div className="mt-3 flex flex-col md:mt-4">
          <CalendarFeedControl
            studentId={studentId}
            issuedAt={calendarFeedIssuedAt}
            referenceTime={reference}
            statusClassName="order-2"
            actionsClassName="order-3 mt-3 md:mt-4"
          />
          {account.kind === "invite" ? (
            <StudentInviteControl
              studentId={studentId}
              expiresAt={account.expiresAt}
              expired={account.expired}
              statusClassName="order-1"
              actionsClassName="order-4 mt-3 md:mt-2"
            />
          ) : (
            <StudentPasswordResetControl
              studentId={studentId}
              changePending={account.kind === "temporary"}
              statusClassName="order-1"
              actionsClassName="order-4 mt-3 md:mt-2"
            />
          )}
          <p className="order-5 mt-3 text-xs leading-[18px] text-muted-foreground md:mt-4">
            {account.kind === "invite"
              ? "구독 URL과 가입 링크는 발급 직후 한 번만 보입니다. 다시 발급하면 이전 값은 즉시 만료됩니다."
              : "구독 URL과 임시 비밀번호는 발급 직후 한 번만 보입니다. 다시 발급하면 이전 값은 즉시 만료됩니다."}
          </p>
        </div>
      </LedgerSection>
    </div>
  );
}
