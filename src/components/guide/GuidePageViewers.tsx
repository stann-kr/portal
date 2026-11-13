"use client";

/**
 * @file src/components/guide/GuidePageViewers.tsx
 * @description 가이드 페이지 머리줄의 "열람 학생 N명" 버튼과 패널(관리자 전용, GuidePageAccess 보드).
 * "선택" 학생은 체크로 이 페이지를 바로 열거나 닫는다(학생 상세 · 가이드 구획과 같은 action, 누른 순서대로 하나씩 저장).
 * "전체"·"닫힘" 학생은 상태만 보이고 학생 상세로 보낸다. 이 패널은 학생의 닫힘·전체·선택을 바꾸지 않는다.
 * 목록은 페이지와 함께 받아 바로 보이고, 패널을 열 때 한 번 다시 읽는다. 저장이 하나라도 실패하면 서버 값으로 되돌린다.
 */
import Link from "next/link";
import { useRef, useState } from "react";
import { Check, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  getGuidePageViewers,
  setStudentGuideAccessPage,
  type GuideAccessWriteResult,
  type GuidePageViewersView,
} from "@/lib/actions/guideAccess";
import type { GuidePageViewer } from "@/lib/guide-access";
import { cn } from "@/lib/utils";

const SAVE_ERROR = "열람 설정을 저장하지 못했습니다. 다시 시도해 주세요.";

function selectedMeta(student: GuidePageViewer, totalPages: number): string {
  const opened = `${totalPages}개 중 ${student.openCount}개 열림`;
  return student.openCount === 0 ? `${opened} · 닫힘과 같음` : opened;
}

export function GuidePageViewers({ pageTitle, initial }: { pageTitle: string; initial: GuidePageViewersView }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const failedRef = useRef<string | null>(null);
  // 읽기를 시작한 뒤 저장을 하나라도 보냈으면 그 읽기 결과는 이미 늦은 값이라 화면에 쓰지 않는다.
  const writeCountRef = useRef(0);
  const pageId = initial.pageId;

  const reload = async () => {
    const startedAt = writeCountRef.current;
    const saved = await getGuidePageViewers(pageId);
    if (saved && pendingRef.current === 0 && writeCountRef.current === startedAt) setView(saved);
    return saved;
  };

  const enqueue = (write: () => Promise<GuideAccessWriteResult>) => {
    writeCountRef.current += 1;
    pendingRef.current += 1;
    setStatus("saving");
    setError(null);
    queueRef.current = queueRef.current.then(async () => {
      try {
        const result = await write();
        if (!result.ok) failedRef.current = result.error;
      } catch {
        failedRef.current = SAVE_ERROR;
      }
      pendingRef.current -= 1;
      if (pendingRef.current > 0) return;
      const failure = failedRef.current;
      if (!failure) {
        setStatus("saved");
        return;
      }
      // 실패한 저장이 섞였으면 화면이 서버와 달라졌을 수 있다. 저장된 값을 다시 읽어 맞춘다.
      let saved: GuidePageViewersView | null = null;
      try {
        saved = await reload();
      } catch {
        saved = null;
      }
      // 다시 읽는 사이 새 저장을 보냈으면 실패 사유를 남겨 두고, 그 저장이 끝날 때 다시 읽고 함께 알린다.
      if (pendingRef.current > 0) return;
      failedRef.current = null;
      setError(saved ? failure : `${failure} 화면을 새로고침해 저장된 값을 확인해 주세요.`);
      setStatus("idle");
    });
  };

  const toggle = (studentId: string, checked: boolean) => {
    setView((current) => ({
      ...current,
      students: current.students.map((student) =>
        student.studentId !== studentId || student.canView === checked
          ? student
          : { ...student, canView: checked, openCount: Math.max(0, student.openCount + (checked ? 1 : -1)) },
      ),
    }));
    enqueue(() => setStudentGuideAccessPage(studentId, pageId, checked));
  };

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setStatus("idle");
    setError(null);
    if (pendingRef.current === 0) void reload().catch(() => {});
  };

  const viewerCount = view.students.filter((student) => student.canView).length;
  const selected = view.students.filter((student) => student.setting === "SELECTED");
  const others = view.students.filter((student) => student.setting !== "SELECTED");

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost">
          <Users className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
          열람 학생 {viewerCount}명
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-0">
        <DialogHeader>
          <DialogTitle>이 페이지를 볼 수 있는 학생</DialogTitle>
          <DialogDescription>
            {view.students.length === 0
              ? pageTitle
              : `${pageTitle} · 학생 ${view.students.length}명 중 ${viewerCount}명`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {view.students.length === 0 ? <p className="text-ui text-muted-foreground">아직 학생이 없습니다.</p> : null}
          {selected.length > 0 ? (
            <fieldset className="flex min-w-0 flex-col">
              <legend className="pb-1 text-xs text-muted-foreground">선택 학생 · 체크하면 이 페이지가 열립니다</legend>
              {selected.map((student) => (
                <label
                  key={student.studentId}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2.5 border-b border-muted text-body md:text-ui",
                    student.canView ? "text-foreground" : "text-secondary-foreground",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={student.canView}
                    onChange={(event) => toggle(student.studentId, event.target.checked)}
                    className="size-4 shrink-0 accent-[var(--color-foreground)] md:size-3.5"
                  />
                  <span className="min-w-0 flex-1 break-words">{student.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{selectedMeta(student, view.totalPages)}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {others.length > 0 ? (
            <div role="group" aria-labelledby="guide-page-viewers-others" className="flex min-w-0 flex-col">
              <span id="guide-page-viewers-others" className="pb-1 text-xs text-muted-foreground">
                전체 · 닫힘 학생 · 학생 상세에서 바꿉니다
              </span>
              <ul className="flex flex-col">
                {others.map((student) => (
                  <li key={student.studentId} className="flex min-h-11 items-center gap-2.5 border-b border-muted text-body md:text-ui">
                    <span aria-hidden="true" className="flex w-4 shrink-0 justify-center text-muted-foreground md:w-3.5">
                      {student.setting === "ALL" ? "✓" : "–"}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-foreground">{student.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{student.setting === "ALL" ? "전체" : "닫힘"}</span>
                    <Link
                      href={`/dashboard/admin/students/${encodeURIComponent(student.studentId)}?tab=overview`}
                      aria-label={`${student.name} 학생 상세`}
                      className="inline-flex min-h-11 shrink-0 items-center text-xs text-secondary-foreground underline underline-offset-[3px] hover:text-foreground md:min-h-0"
                    >
                      학생 상세
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p role="status" className="flex min-h-[18px] items-center gap-1.5 text-xs text-muted-foreground">
            {status === "saved" ? (
              <>
                <Check className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
                저장됨
              </>
            ) : status === "saving" ? "저장 중…" : null}
          </p>
          {error ? <p role="alert" className="text-xs leading-[18px] text-destructive">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
