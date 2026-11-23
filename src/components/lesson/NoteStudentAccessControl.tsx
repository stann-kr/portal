"use client";

/**
 * 수업 도구 패널의 "학생 편집" 고르기(2026-11-23 사용자 결정): 함께 쓰기(기본)·읽기 전용. 관리자가 만든 노트에만 보인다.
 * 바꾸면 바로 저장한다(한 칸짜리 설정이라 초안·이탈 보호를 두지 않는다). 실패하면 이전 값으로 돌리고 이유를 알린다.
 */
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setNoteStudentReadOnly } from "@/lib/actions/noteStudentAccess";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { readOnly: false, label: "함께 쓰기" },
  { readOnly: true, label: "읽기 전용" },
] as const;

export function NoteStudentAccessControl({
  noteId,
  initialReadOnly,
  isGroup,
}: {
  noteId: string;
  initialReadOnly: boolean;
  isGroup: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [readOnly, setReadOnly] = useState(initialReadOnly);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (next: boolean) => {
    if (next === readOnly || pending) return;
    const previous = readOnly;
    setReadOnly(next);
    setError(null);
    startTransition(async () => {
      const result = await setNoteStudentReadOnly(noteId, next).catch(() => null);
      if (!result?.ok) {
        setReadOnly(previous);
        setError(result?.error ?? "바꾸지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
        return;
      }
      // 문서 머리 안내 줄(그룹 노트)을 새 설정으로 다시 그린다. 편집기 상태는 그대로다.
      router.refresh();
    });
  };

  return (
    <section aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 id={`${id}-label`} className="text-xs font-medium text-muted-foreground">학생 편집</h3>
        <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`} className="grid grid-cols-2 rounded-md bg-muted p-0.5 text-ui">
          {OPTIONS.map((option) => (
            <label
              key={option.label}
              className={cn(
                "flex min-h-8 cursor-pointer items-center justify-center rounded-sm px-2.5 text-muted-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                readOnly === option.readOnly && "bg-background text-foreground shadow-sm",
                pending && "cursor-wait",
              )}
            >
              <input
                type="radio"
                name={`${id}-access`}
                className="sr-only"
                checked={readOnly === option.readOnly}
                onChange={() => choose(option.readOnly)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
        {readOnly
          ? `${isGroup ? "그룹 멤버는" : "학생은"} 읽기만 해요. 쓰는 내용은 실시간으로 보여요.`
          : `${isGroup ? "그룹 멤버도" : "학생도"} 이 노트를 함께 고칠 수 있어요.`}
      </p>
      <p role="status" aria-live="polite" className={cn("text-xs text-destructive", !error && "sr-only")}>
        {error ?? ""}
      </p>
    </section>
  );
}
