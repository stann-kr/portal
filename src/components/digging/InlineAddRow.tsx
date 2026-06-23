/**
 * @file src/components/digging/InlineAddRow.tsx
 * @description 디깅 테이블 하단 인라인 트랙 추가 행.
 * 각 컬럼의 입력 위젯을 렌더링하고, 추가 버튼/Enter로 즉시 제출.
 * 링크 컬럼은 onBlur 시 fetchLinkMeta로 트랙명/아티스트 자동 채움.
 */
"use client";

import { useState, useTransition, useCallback } from "react";
import { Plus } from "lucide-react";
import { createDiggingTrack, fetchLinkMeta } from "@/lib/actions/digging";
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

export function InlineAddRow({ columns, onTrackCreated }: InlineAddRowProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [linkUrl, setLinkUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [isPending, startTransition] = useTransition();

  const setValue = useCallback((colId: string, val: unknown) => {
    setValues((prev) => ({ ...prev, [colId]: val }));
  }, []);

  const linkColId = columns.find((c) => c.columnType === "link")?.id;

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
    startTransition(async () => {
      const finalValues = { ...values };
      if (linkColId && linkUrl) finalValues[linkColId] = linkUrl;
      const { id, createdAt } = await createDiggingTrack({
        linkUrl: linkUrl || undefined,
        values: finalValues,
      });
      onTrackCreated({ id, linkUrl: linkUrl || null, values: finalValues, createdAt });
      setValues({});
      setLinkUrl("");
    });
  }, [values, linkUrl, linkColId, onTrackCreated]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const colWidth = (col: Column) =>
    col.columnType === "textarea" ? 200 : col.columnType === "link" ? 160 : 120;

  return (
    <tr className="border-b border-border/40 bg-muted/10">
      {columns.map((col) => {
        const val = values[col.id];
        const options: string[] = col.options ? JSON.parse(col.options) : [];

        return (
          <td
            key={col.id}
            className="px-3 py-1.5 align-middle"
            style={{ width: colWidth(col) }}
          >
            {col.columnType === "rating" ? (
              <StarRating
                value={(val as number) ?? 0}
                onChange={(v) => setValue(col.id, v)}
              />
            ) : col.columnType === "camelot_key" ? (
              <CamelotPicker
                value={(val as string) ?? ""}
                onChange={(v) => setValue(col.id, v)}
              />
            ) : col.columnType === "select" ? (
              <select
                value={(val as string) ?? ""}
                onChange={(e) => setValue(col.id, e.target.value)}
                disabled={isPending}
                className="w-full bg-transparent text-sm border-none outline-none focus:ring-1 focus:ring-ring rounded px-1"
              >
                <option value="">—</option>
                {options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : col.columnType === "textarea" ? (
              <textarea
                value={(val as string) ?? ""}
                onChange={(e) => setValue(col.id, e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isPending}
                rows={1}
                placeholder="입력"
                className="w-full bg-transparent text-sm border-none outline-none focus:ring-1 focus:ring-ring rounded px-1 resize-none"
              />
            ) : col.columnType === "link" ? (
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onBlur={(e) => handleLinkBlur(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isPending}
                placeholder={isFetching ? "추출 중..." : "https://..."}
                className="w-full bg-transparent text-xs border-none outline-none focus:ring-1 focus:ring-ring rounded px-1"
              />
            ) : (
              <input
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
                placeholder="입력"
                className="w-full bg-transparent text-sm border-none outline-none focus:ring-1 focus:ring-ring rounded px-1"
              />
            )}
          </td>
        );
      })}

      {/* 추가 버튼 셀 (_actions 위치) */}
      <td className="px-3 py-1.5 align-middle" style={{ width: 40 }}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          title="트랙 추가 (Enter)"
          className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  );
}
