/**
 * @file src/components/digging/AddTrackInlineForm.tsx
 * @description 트랙 추가 인라인 폼 (Dialog 없는 순수 폼).
 * AddTrackDialog 및 UnifiedCreateDialog에서 재사용.
 */
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createDiggingTrack, fetchLinkMeta } from "@/lib/actions/digging";
import { StarRating } from "./StarRating";
import { CamelotPicker } from "./CamelotPicker";
import type { DiggingColumnType } from "@/db/schema";
import { parseStoredDiggingOptions } from "@/lib/digging-contract";

const LABEL_CLASS = "text-ui font-semibold text-secondary-foreground";

type Column = {
  id: string;
  name: string;
  columnType: DiggingColumnType;
  options: string | null | undefined;
};

interface AddTrackInlineFormProps {
  columns: Column[];
  onSuccess: (created: Awaited<ReturnType<typeof createDiggingTrack>>) => void;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export function AddTrackInlineForm({
  columns,
  onSuccess,
  onCancel,
  onBusyChange,
}: AddTrackInlineFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [linkUrl, setLinkUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isPending, startTransition] = useTransition();
  const metadataRequest = useRef(0);

  useEffect(() => {
    onBusyChange?.(isPending);
    return () => onBusyChange?.(false);
  }, [isPending, onBusyChange]);

  useEffect(() => () => { metadataRequest.current += 1; }, []);

  const setValue = (colId: string, val: unknown) =>
    setValues((prev) => ({ ...prev, [colId]: val }));

  const linkColId = columns.find((c) => c.columnType === "link")?.id;

  const handleLinkBlur = async (url: string) => {
    if (!url || !/^https?:\/\//i.test(url) || isPending) return;
    const request = ++metadataRequest.current;
    setIsFetching(true);
    setFetchError("");
    try {
      const meta = await fetchLinkMeta(url);
      if (request !== metadataRequest.current) return;
      const trackNameCol = columns.find((c) => c.name === "트랙명");
      const artistCol = columns.find((c) => c.name === "아티스트");
      setValues((current) => ({
        ...current,
        ...(meta.title && trackNameCol && !current[trackNameCol.id] ? { [trackNameCol.id]: meta.title } : {}),
        ...(meta.artist && artistCol && !current[artistCol.id] ? { [artistCol.id]: meta.artist } : {}),
      }));
    } catch {
      if (request === metadataRequest.current) setFetchError("링크 정보를 가져오지 못했습니다. 직접 입력할 수 있습니다.");
    } finally {
      if (request === metadataRequest.current) setIsFetching(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPending) return;
    metadataRequest.current += 1;
    setIsFetching(false);
    setSubmitError("");
    startTransition(async () => {
      try {
        const finalValues = { ...values };
        if (linkColId && linkUrl) finalValues[linkColId] = linkUrl;
        const created = await createDiggingTrack({
          linkUrl: linkUrl || undefined,
          values: finalValues,
        });
        setValues({});
        setLinkUrl("");
        onSuccess(created);
      } catch {
        setSubmitError("트랙을 저장하지 못했습니다. 입력을 확인하고 다시 시도해주세요.");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" aria-busy={isPending}>
      {submitError ? (
        <p id="digging-form-error" role="alert" className="rounded-md bg-destructive-muted px-3 py-2 text-ui text-destructive">
          {submitError}
        </p>
      ) : null}
      {/* 링크 (최상단 — 자동 추출 트리거) */}
      {linkColId && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="digging-link" className={LABEL_CLASS}>링크</label>
          <div className="flex gap-2">
            <Input
              id="digging-link"
              type="url"
              placeholder="https://youtube.com/..."
              value={linkUrl}
              onChange={(e) => {
                metadataRequest.current += 1;
                setLinkUrl(e.target.value);
                setIsFetching(false);
                setFetchError("");
              }}
              onBlur={(e) => handleLinkBlur(e.target.value)}
              disabled={isPending}
              aria-describedby={submitError ? "digging-form-error" : undefined}
            />
            {isFetching && (
              <span role="status" className="self-center whitespace-nowrap text-xs text-muted-foreground">
                추출 중...
              </span>
            )}
          </div>
          {fetchError && (
            <p role="status" className="text-xs text-muted-foreground">{fetchError}</p>
          )}
        </div>
      )}

      {/* 나머지 컬럼 (링크 제외) */}
      {columns
        .filter((col) => col.columnType !== "link")
        .map((col) => {
          const val = values[col.id];
          const options = parseStoredDiggingOptions(col.options ?? null) ?? [];

          return (
            <div key={col.id} className="flex flex-col gap-1.5">
              <label htmlFor={`digging-column-${col.id}`} className={LABEL_CLASS}>{col.name}</label>

              {col.columnType === "text" && (
                <Input
                  id={`digging-column-${col.id}`}
                  value={(val as string) ?? ""}
                  onChange={(e) => setValue(col.id, e.target.value)}
                  disabled={isPending}
                />
              )}

              {col.columnType === "textarea" && (
                <textarea
                  id={`digging-column-${col.id}`}
                  value={(val as string) ?? ""}
                  onChange={(e) => setValue(col.id, e.target.value)}
                  rows={3}
                  disabled={isPending}
                  className="w-full resize-none rounded-touch border border-input bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:rounded-md md:py-2 md:text-sm"
                />
              )}

              {col.columnType === "number" && (
                <Input
                  id={`digging-column-${col.id}`}
                  type="number"
                  value={(val as string) ?? ""}
                  onChange={(e) => setValue(col.id, e.target.value)}
                  disabled={isPending}
                  className="font-mono"
                />
              )}

              {col.columnType === "select" && (
                <select
                  id={`digging-column-${col.id}`}
                  value={(val as string) ?? ""}
                  onChange={(e) => setValue(col.id, e.target.value)}
                  disabled={isPending}
                  className="h-11 w-full rounded-touch border border-input bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:h-9 md:rounded-md md:text-sm"
                >
                  <option value="">선택</option>
                  {options.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              )}

              {col.columnType === "rating" && (
                <StarRating
                  aria-label={col.name}
                  value={Number(val) || 0}
                  disabled={isPending}
                  onChange={(v) => setValue(col.id, v || "")}
                />
              )}

              {col.columnType === "camelot_key" && (
                <CamelotPicker
                  aria-label={col.name}
                  value={(val as string) ?? ""}
                  disabled={isPending}
                  onChange={(v) => setValue(col.id, v)}
                />
              )}
            </div>
          );
        })}

      {/* 좁은 화면(시트)은 48px 주 버튼, 넓은 화면은 32px */}
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={isPending} size="touch" className="flex-1 md:h-8 md:rounded-md md:text-ui">
          {isPending ? "추가 중..." : "추가"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="touch"
          onClick={onCancel}
          disabled={isPending}
          className="md:h-8 md:rounded-md md:text-ui"
        >
          취소
        </Button>
      </div>
    </form>
  );
}
