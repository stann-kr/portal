/**
 * @file src/components/admin-portal/LessonGroupDialog.tsx
 * @description 그룹 만들기·관리 창(캔버스 GroupLesson ①). 이름과 멤버(2명 이상)를 정하고, 관리일 때는 해제도 한다.
 * 다른 그룹에 있는 학생은 고를 수 없고 그 그룹 이름이 함께 보인다. 서버 action이 같은 규칙을 다시 확인한다.
 * 한두 칸짜리 짧은 form이라 로컬 초안·이탈 보호 대상이 아니다(2026-11-13 사용자 결정).
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteLessonGroupAction, saveLessonGroupAction } from "@/lib/actions/lessonGroups";
import { LESSON_GROUP_MIN_MEMBERS, LESSON_GROUP_NAME_MAX, type LessonGroupSummary } from "@/lib/lesson-group-rules";

export type LessonGroupStudentChoice = { id: string; label: string };

export function LessonGroupDialog({
  open,
  onOpenChange,
  group,
  groups,
  students,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 관리할 그룹. 없으면 새 그룹을 만든다. */
  group: LessonGroupSummary | null;
  groups: readonly LessonGroupSummary[];
  students: readonly LessonGroupStudentChoice[];
}) {
  const router = useRouter();
  const [name, setName] = useState(group?.name ?? "");
  const [memberIds, setMemberIds] = useState<string[]>(group?.memberIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 열 때마다 대상 그룹 값으로 새로 채운다. 이전 값과 렌더 중에 비교해 바로 맞춘다.
  const [resetSource, setResetSource] = useState({ open, groupId: group?.id ?? null });
  if (resetSource.open !== open || resetSource.groupId !== (group?.id ?? null)) {
    setResetSource({ open, groupId: group?.id ?? null });
    if (open) {
      setName(group?.name ?? "");
      setMemberIds(group?.memberIds ?? []);
      setError(null);
    }
  }

  const otherGroupOf = new Map<string, string>();
  for (const other of groups) {
    if (other.id === group?.id) continue;
    for (const id of other.memberIds) otherGroupOf.set(id, other.name);
  }

  const toggle = (id: string, checked: boolean) => {
    setMemberIds((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  };

  const run = (task: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.ok) {
          setError(result.error ?? "저장하지 못했습니다.");
          return;
        }
        onOpenChange(false);
        router.refresh();
      } catch {
        setError("저장 결과를 확인하지 못했습니다. 목록을 새로 고친 뒤 다시 시도해 주세요.");
      }
    });
  };

  const save = () => {
    if (!name.trim()) return setError("그룹 이름을 적어 주세요.");
    if (memberIds.length < LESSON_GROUP_MIN_MEMBERS) return setError(`학생을 ${LESSON_GROUP_MIN_MEMBERS}명 이상 골라 주세요.`);
    run(() => saveLessonGroupAction({ groupId: group?.id ?? null, name, memberIds }));
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) onOpenChange(nextOpen); }}>
      <DialogContent dismissible={!isPending}>
        <DialogHeader>
          <DialogTitle>{group ? "그룹 관리" : "그룹 만들기"}</DialogTitle>
          <DialogDescription>
            함께 레슨하는 학생을 묶습니다. 과제·제출·피드백·개인 노트는 학생별로 그대로 남습니다.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          aria-busy={isPending}
          onSubmit={(event) => { event.preventDefault(); save(); }}
        >
          {error ? (
            <p id="lesson-group-error" role="alert" className="rounded-touch bg-destructive-muted px-3.5 py-2 text-ui text-destructive">
              {error}
            </p>
          ) : null}
          <label htmlFor="lesson-group-name" className="flex flex-col gap-1.5 text-xs text-secondary-foreground">
            그룹 이름
            <Input
              id="lesson-group-name"
              value={name}
              maxLength={LESSON_GROUP_NAME_MAX}
              required
              onChange={(event) => setName(event.target.value)}
              disabled={isPending}
              placeholder="예: 화요일반"
              aria-describedby={error ? "lesson-group-error" : undefined}
              className="md:px-2.5 md:text-ui"
            />
          </label>
          <fieldset className="m-0 flex flex-col border-0 p-0" disabled={isPending}>
            <legend className="pb-1 text-xs text-secondary-foreground">멤버 · {LESSON_GROUP_MIN_MEMBERS}명 이상</legend>
            {students.map((student) => {
              const otherGroup = otherGroupOf.get(student.id);
              return (
                <label
                  key={student.id}
                  className="flex h-11 items-center gap-2.5 border-b border-muted text-ui text-foreground has-[:disabled]:text-muted-foreground md:h-9"
                >
                  <input
                    type="checkbox"
                    checked={memberIds.includes(student.id)}
                    disabled={Boolean(otherGroup)}
                    onChange={(event) => toggle(student.id, event.target.checked)}
                    className="size-3.5 accent-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">{student.label}</span>
                  {otherGroup ? <span className="shrink-0 text-xs text-muted-foreground">{otherGroup}</span> : null}
                </label>
              );
            })}
          </fieldset>
          <div className="flex flex-col-reverse gap-2 md:flex-row md:items-center md:justify-between">
            {group ? (
              <Button
                type="button"
                variant="ghost"
                size="touch"
                className="text-destructive md:h-8 md:rounded-md md:px-2.5 md:text-ui"
                disabled={isPending}
                onClick={() => run(() => deleteLessonGroupAction(group.id))}
              >
                그룹 해제
              </Button>
            ) : <span aria-hidden="true" />}
            <div className="flex flex-col-reverse gap-2 md:flex-row">
              <Button
                type="button"
                variant="outline"
                size="touch"
                className="md:h-8 md:rounded-md md:px-3.5 md:text-ui"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                취소
              </Button>
              <Button type="submit" size="touch" className="md:h-8 md:rounded-md md:px-3.5 md:text-ui" disabled={isPending}>
                {isPending ? "저장 중..." : "저장"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
