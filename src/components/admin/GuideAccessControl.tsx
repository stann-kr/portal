"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { AccountStatusRow } from "@/components/admin/OneTimeSecret";
import { ChoiceGroup, type ChoiceOption } from "@/components/ui/choice-group";
import {
  getStudentGuideAccess,
  setStudentGuideAccessPage,
  setStudentGuideAccessSetting,
  type GuideAccessWriteResult,
  type StudentGuideAccessView,
} from "@/lib/actions/guideAccess";
import type { GuideAccessSetting } from "@/lib/guide-access";
import { cn } from "@/lib/utils";

const SETTING_OPTIONS: readonly ChoiceOption<GuideAccessSetting>[] = [
  { value: "CLOSED", label: "닫힘" },
  { value: "ALL", label: "전체" },
  { value: "SELECTED", label: "선택" },
];

const SAVE_ERROR = "가이드 열람 설정을 저장하지 못했습니다. 다시 시도해 주세요.";

/** 상태 줄의 값: 닫힘 / 전체 · N개 페이지 / 선택 · N개 중 M개. */
export function describeGuideAccess(setting: GuideAccessSetting, pageCount: number, openCount: number): string {
  if (setting === "ALL") return `전체 · ${pageCount}개 페이지`;
  if (setting === "SELECTED") return `선택 · ${pageCount}개 중 ${openCount}개`;
  return "닫힘";
}

/**
 * 학생 상세 · 개요의 "가이드" 구획(GuideAccess 보드): 이 학생이 가이드를 볼 수 있는지와 열어 줄 페이지.
 * 세 칸 중 하나를 고르거나 페이지를 체크하면 바로 저장한다. 저장은 누른 순서대로 하나씩 보내고,
 * 하나라도 실패하면 서버에 저장된 값으로 화면을 되돌린다.
 */
export function GuideAccessControl({ studentId, initial }: { studentId: string; initial: StudentGuideAccessView }) {
  const [setting, setSetting] = useState<GuideAccessSetting>(initial.setting);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(initial.pageIds));
  const [pages, setPages] = useState(initial.pages);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const failedRef = useRef<string | null>(null);

  const enqueue = (write: () => Promise<GuideAccessWriteResult>) => {
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
      failedRef.current = null;
      if (!failure) {
        setStatus("saved");
        return;
      }
      // 실패한 저장이 섞였으면 화면이 서버와 달라졌을 수 있다. 저장된 값을 다시 읽어 맞춘다.
      try {
        const saved = await getStudentGuideAccess(studentId);
        if (pendingRef.current > 0) return;
        setSetting(saved.setting);
        setOpenIds(new Set(saved.pageIds));
        setPages(saved.pages);
        setError(failure);
      } catch {
        if (pendingRef.current > 0) return;
        setError(`${failure} 화면을 새로고침해 저장된 값을 확인해 주세요.`);
      }
      setStatus("idle");
    });
  };

  const changeSetting = (next: GuideAccessSetting) => {
    setSetting(next);
    enqueue(() => setStudentGuideAccessSetting(studentId, next));
  };

  const togglePage = (pageId: string, open: boolean) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (open) next.add(pageId);
      else next.delete(pageId);
      return next;
    });
    enqueue(() => setStudentGuideAccessPage(studentId, pageId, open));
  };

  const openCount = pages.filter((page) => openIds.has(page.id)).length;
  const hint =
    setting === "CLOSED"
      ? "닫힘이면 학생 메뉴에 가이드가 보이지 않습니다."
      : setting === "ALL"
        ? "나중에 만든 페이지도 함께 열립니다."
        : pages.length === 0
          ? "아직 만든 가이드 페이지가 없습니다."
          : openCount === 0
            ? "고른 페이지가 없으면 학생에게는 닫힘과 같습니다."
            : null;

  return (
    <div className="mt-3 flex flex-col gap-3 md:mt-4 md:gap-4">
      <AccountStatusRow label="열람">{describeGuideAccess(setting, pages.length, openCount)}</AccountStatusRow>
      <ChoiceGroup label="가이드 열람" labelHidden options={SETTING_OPTIONS} value={setting} onChange={changeSetting} variant="segment" />
      {hint ? <p className="text-xs leading-[18px] text-muted-foreground">{hint}</p> : null}
      {setting === "SELECTED" && pages.length > 0 ? (
        <fieldset className="flex min-w-0 flex-col">
          <legend className="pb-1 text-xs text-muted-foreground">열어 줄 페이지</legend>
          {pages.map((page) => {
            const checked = openIds.has(page.id);
            return (
              <label
                key={page.id}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2.5 border-b border-muted py-1.5 text-body md:min-h-8 md:text-ui",
                  checked ? "text-foreground" : "text-secondary-foreground",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => togglePage(page.id, event.target.checked)}
                  className="size-4 shrink-0 accent-[var(--color-foreground)] md:size-3.5"
                />
                <span className="min-w-0 break-words">{page.title}</span>
              </label>
            );
          })}
        </fieldset>
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
  );
}
