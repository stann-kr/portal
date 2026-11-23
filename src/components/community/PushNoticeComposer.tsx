/**
 * @file src/components/community/PushNoticeComposer.tsx
 * @description 글 없이 학생에게 알림 보내기 창(캔버스 PushNotices ①). 받는 사람(수강 중인 학생 전체 / 고르기),
 * 내용 120자, 학생 휴대폰에 보일 모양 미리보기. 같은 창에서 두 번 눌러도 알림은 하나만 만든다(operationId).
 */
"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PUSH_NOTICE_MAX_LENGTH } from "@/db/schema";
import { listPushNoticeStudents, sendPushNotice } from "@/lib/actions/pushNotices";
import { createCreationOperationId } from "@/lib/creation-operation";
import { cn } from "@/lib/utils";

type Student = { id: string; name: string };

export function PushNoticeComposer({
  open,
  onOpenChange,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (message: string) => void;
}) {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"all" | "pick">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const operationIdRef = useRef<string | null>(null);
  const bodyId = useId();
  const errorId = useId();

  useEffect(() => {
    if (!open || students) return;
    let cancelled = false;
    listPushNoticeStudents()
      .then((rows) => { if (!cancelled) setStudents(rows); })
      .catch(() => { if (!cancelled) setLoadError("학생 목록을 읽지 못했습니다. 창을 닫았다 다시 열어 주세요."); });
    return () => { cancelled = true; };
  }, [open, students]);

  const length = [...body.trim()].length;
  const recipientCount = mode === "all" ? students?.length ?? 0 : picked.length;
  const canSend = length > 0 && length <= PUSH_NOTICE_MAX_LENGTH && recipientCount > 0 && !isPending;

  const reset = () => {
    setBody("");
    setMode("all");
    setPicked([]);
    setError(null);
    operationIdRef.current = null;
  };

  const send = () => {
    if (!canSend) return;
    operationIdRef.current ??= createCreationOperationId();
    const operationId = operationIdRef.current;
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendPushNotice({ body, studentIds: mode === "all" ? null : picked, operationId });
        if (!result.success) {
          setError(result.error);
          return;
        }
        reset();
        onOpenChange(false);
        onSent(`${result.recipientCount}명에게 보냈습니다.`);
      } catch {
        setError("보내지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  const preview = body.trim() || "보낼 내용을 적으면 여기에 보입니다.";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isPending) onOpenChange(next); }}>
      <DialogContent dismissible={!isPending}>
        <DialogHeader>
          <DialogTitle>학생에게 알림 보내기</DialogTitle>
          <DialogDescription className="sr-only">게시물 없이 짧은 알림을 학생 휴대폰과 홈으로 보냅니다.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-[18px]" aria-busy={isPending} onSubmit={(event) => { event.preventDefault(); send(); }}>
          {error ? (
            <p id={errorId} role="alert" className="rounded-touch bg-destructive-muted px-3.5 py-2 text-ui text-destructive">{error}</p>
          ) : null}
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" disabled={isPending}>
            <legend className="pb-2 text-ui font-medium text-foreground">받는 사람</legend>
            <label className="flex h-11 items-center gap-2 text-body md:h-8">
              <input type="radio" name="push-notice-to" checked={mode === "all"} onChange={() => setMode("all")} className="accent-foreground" />
              수강 중인 학생 전체
              <span className="font-mono text-xs text-muted-foreground">{students ? `${students.length}명` : ""}</span>
            </label>
            <label className="flex h-11 items-center gap-2 text-body md:h-8">
              <input type="radio" name="push-notice-to" checked={mode === "pick"} onChange={() => setMode("pick")} className="accent-foreground" />
              고르기
            </label>
            {mode === "pick" ? (
              <div className="ml-6 flex max-h-56 flex-col overflow-y-auto">
                {loadError ? <p role="alert" className="text-ui text-destructive">{loadError}</p> : null}
                {(students ?? []).map((student) => (
                  <label key={student.id} className="flex h-11 items-center gap-2.5 border-b border-muted text-ui md:h-9">
                    <input
                      type="checkbox"
                      checked={picked.includes(student.id)}
                      onChange={(event) => setPicked((current) => event.target.checked
                        ? [...current, student.id]
                        : current.filter((id) => id !== student.id))}
                      className="size-3.5 accent-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">{student.name}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={bodyId} className="text-ui font-medium text-foreground">내용</label>
            <textarea
              id={bodyId}
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={isPending}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={length > PUSH_NOTICE_MAX_LENGTH || undefined}
              placeholder="예: 내일 레슨은 30분 늦게 7시 30분에 시작해요."
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-body text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-1"
            />
            <p className={cn("self-end font-mono text-xs", length > PUSH_NOTICE_MAX_LENGTH ? "text-destructive" : "text-muted-foreground")}>
              {length}/{PUSH_NOTICE_MAX_LENGTH}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">학생 휴대폰에 이렇게 보입니다</p>
            <div className="flex gap-2.5 rounded-xl bg-muted p-3">
              <span aria-hidden="true" className="size-7 shrink-0 rounded-md bg-foreground" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui font-semibold text-foreground">Stann의 알림</span>
                <span className="whitespace-pre-line break-words text-ui text-secondary-foreground">{preview}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">알림을 꺼 둔 학생은 홈 맨 위에서 봅니다. 학생이 알림을 열거나 &ldquo;확인&rdquo;을 누르면 읽음입니다.</p>
          </div>
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button type="button" variant="ghost" size="touch" className="md:h-9 md:rounded-md md:px-3.5 md:text-ui" onClick={() => onOpenChange(false)} disabled={isPending}>
              취소
            </Button>
            <Button type="submit" size="touch" className="md:h-9 md:rounded-md md:px-4 md:text-ui" disabled={!canSend} aria-busy={isPending || undefined}>
              {isPending ? "보내는 중..." : `${recipientCount}명에게 보내기`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
