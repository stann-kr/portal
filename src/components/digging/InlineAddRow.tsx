/**
 * @file src/components/digging/InlineAddRow.tsx
 * @description 디깅 표 맨 아래의 인라인 트랙 추가.
 * 평소에는 "링크를 붙여넣어 트랙 추가" 한 줄이고, 누르면 컬럼별 입력 행이 열려 링크 칸에 초점이 간다.
 * 추가 버튼/Enter로 즉시 제출하고, 링크 칸은 onBlur 시 fetchLinkMeta로 트랙명/아티스트를 채운다. Esc는 입력 행을 닫는다.
 */
"use client";

import { useEffect, useId, useRef, useState, useTransition, useCallback } from "react";
import { Plus, X } from "lucide-react";
import { ButtonSpinner } from "@/components/ui/button";
import { createDiggingTrack, fetchLinkMeta } from "@/lib/actions/digging";
import { parseStoredDiggingOptions } from "@/lib/digging-contract";
import { StarRating } from "./StarRating";
import { CamelotPicker } from "./CamelotPicker";
import type { DiggingColumnType } from "@/db/schema";

type Column = {
  id: string;
  name: string;
  columnType: DiggingColumnType;
  options: string | null | undefined;
  sortOrder: number;
};

type NewTrack = {
  id: string;
  linkUrl: string | null | undefined;
  values: Record<string, unknown>;
  createdAt: Date | null | undefined;
};

interface InlineAddRowProps {
  columns: Column[];
  onTrackCreated: (track: NewTrack) => void;
}

const CELL_INPUT =
  "h-11 w-full min-w-0 rounded-sm bg-transparent px-1 text-body outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50";

export function InlineAddRow({ columns, onTrackCreated }: InlineAddRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [linkUrl, setLinkUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [isPending, startTransition] = useTransition();
  const rowId = useId();
  const promptRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLTableRowElement>(null);
  const restorePromptFocus = useRef(false);

  // 열리면 링크 칸(없으면 첫 칸)에, 닫히면 다시 한 줄 버튼으로 초점을 옮긴다.
  useEffect(() => {
    if (expanded) {
      rowRef.current?.querySelector<HTMLElement>("[data-inline-add-first]")?.focus();
    } else if (restorePromptFocus.current) {
      restorePromptFocus.current = false;
      promptRef.current?.focus();
    }
  }, [expanded]);

  const setValue = useCallback((colId: string, val: unknown) => {
    setValues((prev) => ({ ...prev, [colId]: val }));
  }, []);

  const linkColId = columns.find((c) => c.columnType === "link")?.id;
  const firstColId = linkColId ?? columns[0]?.id;

  const handleLinkBlur = async (url: string) => {
    if (!url || !url.startsWith("http")) return;
    setIsFetching(true);
    try {
      const meta = await fetchLinkMeta(url);
      const trackNameCol = columns.find((c) => c.name === "트랙명");
      const artistCol = columns.find((c) => c.name === "아티스트");
      if (meta.title && trackNameCol && !values[trackNameCol.id]) {
        setValue(trackNameCol.id, meta.title);
      }
      if (meta.artist && artistCol && !values[artistCol.id]) {
        setValue(artistCol.id, meta.artist);
      }
    } catch { /* 메타 추출 실패 무시 */ }
    finally {
      setIsFetching(false);
    }
  };

  const handleSubmit = useCallback(() => {
    setSubmitError("");
    startTransition(async () => {
      try {
        const finalValues = { ...values };
        if (linkColId && linkUrl) finalValues[linkColId] = linkUrl;
        const created = await createDiggingTrack({ linkUrl: linkUrl || undefined, values: finalValues });
        onTrackCreated(created);
        setValues({});
        setLinkUrl("");
      } catch {
        setSubmitError("트랙을 추가하지 못했습니다. 입력을 확인하고 다시 시도해 주세요.");
      }
    });
  }, [values, linkUrl, linkColId, onTrackCreated]);

  const collapse = () => {
    if (isPending) return;
    restorePromptFocus.current = true;
    setSubmitError("");
    setExpanded(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!expanded) {
    return (
      <tr>
        <td colSpan={columns.length + 1} className="h-11 p-0">
          <button
            ref={promptRef}
            type="button"
            onClick={() => setExpanded(true)}
            className="flex h-11 w-full items-center gap-2 rounded-sm px-2 text-ui text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:bg-sidebar hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
          >
            <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            링크를 붙여넣어 트랙 추가
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr
      ref={rowRef}
      className="border-b border-muted bg-sidebar"
      aria-busy={isPending}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        collapse();
      }}
    >
      {columns.map((col) => {
        const val = values[col.id];
        const options = parseStoredDiggingOptions(col.options ?? null) ?? [];
        const first = col.id === firstColId ? { "data-inline-add-first": "" } : {};

        return (
          <td key={col.id} className="px-1 align-middle">
            {col.columnType === "rating" ? (
              <StarRating
                aria-label={col.name}
                size="sm"
                value={Number(val) || 0}
                disabled={isPending}
                onChange={(v) => setValue(col.id, v || "")}
              />
            ) : col.columnType === "camelot_key" ? (
              <CamelotPicker
                aria-label={col.name}
                variant="table"
                value={(val as string) ?? ""}
                disabled={isPending}
                onChange={(v) => setValue(col.id, v)}
              />
            ) : col.columnType === "select" ? (
              <select
                {...first}
                aria-label={col.name}
                value={(val as string) ?? ""}
                onChange={(e) => setValue(col.id, e.target.value)}
                disabled={isPending}
                className={`${CELL_INPUT} text-ui`}
              >
                <option value="">선택 안 함</option>
                {options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : col.columnType === "textarea" ? (
              <textarea
                {...first}
                aria-label={col.name}
                value={(val as string) ?? ""}
                onChange={(e) => setValue(col.id, e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isPending}
                rows={1}
                placeholder={col.name}
                className={`${CELL_INPUT} resize-none py-[11px] text-ui leading-[22px]`}
              />
            ) : col.columnType === "link" ? (
              <>
              <input
                {...first}
                aria-label={col.name}
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onBlur={(e) => handleLinkBlur(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isPending}
                placeholder="https://..."
                aria-describedby={isFetching ? `${rowId}-link-status` : undefined}
                className={`${CELL_INPUT} text-ui`}
              />
              {isFetching ? (
                <span id={`${rowId}-link-status`} role="status" className="flex items-center gap-1 px-2 pb-1 text-xs text-muted-foreground">
                  <ButtonSpinner className="size-3" />링크 정보를 가져오는 중
                </span>
              ) : null}
              </>
            ) : (
              <input
                {...first}
                aria-label={col.name}
                type={col.columnType === "number" ? "number" : "text"}
                value={(val as string) ?? ""}
                onChange={(e) =>
                  setValue(
                    col.id,
                    col.columnType === "number" ? Number(e.target.value) : e.target.value,
                  )
                }
                onKeyDown={handleKeyDown}
                disabled={isPending}
                placeholder={col.name}
                className={CELL_INPUT}
              />
            )}
          </td>
        );
      })}

      {/* 추가·닫기 (_actions 위치) */}
      <td className="px-1 align-middle">
        {submitError ? <p className="mb-1 min-w-40 text-xs text-destructive" role="alert">{submitError}</p> : null}
        <div className="flex items-center">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            title="트랙 추가 (Enter)"
            aria-label="디깅 트랙 추가"
            aria-busy={isPending || undefined}
            className="flex size-6 items-center justify-center rounded-sm text-secondary-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {isPending ? <ButtonSpinner /> : <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={collapse}
            disabled={isPending}
            aria-label="트랙 추가 행 닫기"
            className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <X className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  );
}
