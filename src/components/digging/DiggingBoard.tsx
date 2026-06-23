/**
 * @file src/components/digging/DiggingBoard.tsx
 * @description 디깅 게시판 메인 클라이언트 컴포넌트 (Phase 5).
 * - TanStack Table 기반 동적 컬럼 테이블
 * - 날짜 범위 필터 + 날짜별 그룹핑
 * - 인라인 셀 편집
 * - 트랙 추가/삭제, 컬럼 추가/삭제
 */
"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import { Plus, Settings2, Trash2, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddTrackDialog } from "./AddTrackDialog";
import { ColumnManager } from "./ColumnManager";
import { InlineAddRow } from "./InlineAddRow";
import { StarRating } from "./StarRating";
import { CamelotPicker } from "./CamelotPicker";
import {
  updateDiggingTrackValue,
  deleteDiggingTrack,
} from "@/lib/actions/digging";
import type { DiggingColumnType } from "@/db/schema";

type Column = {
  id: string;
  name: string;
  columnType: DiggingColumnType;
  options: string | null | undefined;
  isDefault: boolean;
  sortOrder: number;
};

type Track = {
  id: string;
  linkUrl: string | null | undefined;
  values: Record<string, unknown>;
  createdAt: Date | null | undefined;
};

interface DiggingBoardProps {
  initialColumns: Column[];
  initialTracks: Track[];
  readonly?: boolean; // 어드민 뷰: 수정 불가
}

// ─── 인라인 편집 셀 ───────────────────────────────

function EditableCell({
  trackId,
  columnId,
  columnType,
  value: initialValue,
  options,
  readonly,
}: {
  trackId: string;
  columnId: string;
  columnType: DiggingColumnType;
  value: unknown;
  options?: string | null;
  readonly?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [isPending, startTransition] = useTransition();

  const save = useCallback(
    (newVal: unknown) => {
      setValue(newVal);
      startTransition(() => updateDiggingTrackValue(trackId, columnId, newVal));
    },
    [trackId, columnId],
  );

  const parsedOptions: string[] = options ? JSON.parse(options) : [];

  if (readonly) {
    if (columnType === "rating")
      return <StarRating value={(value as number) ?? 0} readonly />;
    if (columnType === "camelot_key")
      return <CamelotPicker value={(value as string) ?? ""} readonly />;
    if (columnType === "link" && value)
      return (
        <a href={value as string} target="_blank" rel="noreferrer"
          className="text-primary hover:underline flex items-center gap-1 text-xs">
          <ExternalLink className="w-3 h-3" />링크
        </a>
      );
    return <span className="text-sm">{(value as string) ?? "—"}</span>;
  }

  if (columnType === "rating") {
    return (
      <StarRating
        value={(value as number) ?? 0}
        onChange={save}
      />
    );
  }

  if (columnType === "camelot_key") {
    return (
      <CamelotPicker
        value={(value as string) ?? ""}
        onChange={save}
      />
    );
  }

  if (columnType === "select") {
    return (
      <select
        value={(value as string) ?? ""}
        onChange={(e) => save(e.target.value)}
        disabled={isPending}
        className="w-full bg-transparent text-sm border-none outline-none focus:ring-1 focus:ring-ring rounded px-1"
      >
        <option value="">—</option>
        {parsedOptions.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (columnType === "link") {
    return (
      <div className="flex items-center gap-1">
        <input
          type="url"
          value={(value as string) ?? ""}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => save(e.target.value)}
          disabled={isPending}
          placeholder="https://..."
          className="flex-1 bg-transparent text-xs border-none outline-none focus:ring-1 focus:ring-ring rounded px-1 min-w-0"
        />
        {typeof value === "string" && value && (
          <a href={value} target="_blank" rel="noreferrer">
            <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-primary" />
          </a>
        )}
      </div>
    );
  }

  if (columnType === "textarea") {
    return (
      <textarea
        value={(value as string) ?? ""}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        disabled={isPending}
        rows={2}
        className="w-full bg-transparent text-sm border-none outline-none focus:ring-1 focus:ring-ring rounded px-1 resize-none"
      />
    );
  }

  // text / number
  return (
    <input
      type={columnType === "number" ? "number" : "text"}
      value={(value as string) ?? ""}
      onChange={(e) => setValue(e.target.value)}
      onBlur={(e) => save(columnType === "number" ? Number(e.target.value) : e.target.value)}
      disabled={isPending}
      className="w-full bg-transparent text-sm border-none outline-none focus:ring-1 focus:ring-ring rounded px-1"
    />
  );
}

// ─── 날짜 그룹 헤더 ──────────────────────────────

function DateGroupHeader({
  date,
  count,
  collapsed,
  onToggle,
}: {
  date: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="bg-muted/40 border-t-2 border-border">
      <td colSpan={100} className="px-4 py-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          {date}
          <span className="text-xs text-muted-foreground font-normal">
            {count}곡
          </span>
        </button>
      </td>
    </tr>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────

export function DiggingBoard({
  initialColumns,
  initialTracks,
  readonly = false,
}: DiggingBoardProps) {
  const [columns] = useState<Column[]>(initialColumns);
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  // 날짜 범위 필터 + 그룹핑
  const groupedTracks = useMemo(() => {
    const filtered = tracks.filter((t) => {
      if (!t.createdAt) return true;
      const d = new Date(t.createdAt);
      if (dateFrom && d < new Date(dateFrom)) return false;
      if (dateTo && d > new Date(dateTo + "T23:59:59")) return false;
      return true;
    });

    const groups: Record<string, Track[]> = {};
    filtered.forEach((t) => {
      const key = t.createdAt
        ? new Date(t.createdAt).toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "short",
          })
        : "날짜 없음";
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    // 최신 날짜 순 정렬
    return Object.entries(groups).sort(([a], [b]) => {
      const da = groups[a][0]?.createdAt;
      const db = groups[b][0]?.createdAt;
      if (!da || !db) return 0;
      return new Date(db).getTime() - new Date(da).getTime();
    });
  }, [tracks, dateFrom, dateTo]);

  const toggleDate = (date: string) => {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  // TanStack Table 컬럼 정의
  const tableCols = useMemo<ColumnDef<Track>[]>(
    () => [
      ...columns.map<ColumnDef<Track>>((col) => ({
        id: col.id,
        header: col.name,
        size: col.columnType === "textarea" ? 200 : col.columnType === "link" ? 160 : 120,
        cell: ({ row }) => (
          <EditableCell
            trackId={row.original.id}
            columnId={col.id}
            columnType={col.columnType}
            value={row.original.values[col.id]}
            options={col.options}
            readonly={readonly}
          />
        ),
      })),
      ...(!readonly
        ? [
            {
              id: "_actions",
              header: "",
              size: 40,
              cell: ({ row }: { row: { original: Track } }) => (
                <button
                  onClick={() => {
                    startTransition(async () => {
                      await deleteDiggingTrack(row.original.id);
                      setTracks((prev) => prev.filter((t) => t.id !== row.original.id));
                    });
                  }}
                  disabled={isPending}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              ),
            } as ColumnDef<Track>,
          ]
        : []),
    ],
    [columns, readonly, isPending],
  );

  const table = useReactTable({
    data: [],
    columns: tableCols,
    getCoreRowModel: getCoreRowModel(),
  });

  const handleTrackCreated = useCallback(
    (newTrack: Track) => {
      setTracks((prev) => [newTrack, ...prev]);
    },
    [],
  );

  // ColumnManager 성공 시 서버에서 최신 컬럼 목록 재조회
  const handleColumnsRefresh = useCallback(() => window.location.reload(), []);

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 날짜 범위 필터 */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground shrink-0">기간</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36 h-8 text-xs"
          />
          <span className="text-muted-foreground">~</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36 h-8 text-xs"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              초기화
            </button>
          )}
        </div>

        <div className="flex gap-2 ml-auto">
          {!readonly && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setManageOpen(true)}
              >
                <Settings2 className="w-3.5 h-3.5" />
                컬럼 관리
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                <Plus className="w-3.5 h-3.5" />
                트랙 추가
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 테이블 */}
      <div className="rounded-xl border border-border overflow-auto">
        <table className="w-full text-sm border-collapse">
          {/* 헤더 */}
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border bg-muted/30">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                    style={{ width: header.getSize() }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          {/* 날짜 그룹별 바디 */}
          <tbody>
            {groupedTracks.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-4 py-16 text-center text-muted-foreground text-sm"
                >
                  {tracks.length === 0
                    ? "아직 추가된 트랙이 없습니다."
                    : "선택한 기간에 트랙이 없습니다."}
                </td>
              </tr>
            ) : (
              groupedTracks.map(([date, dateRows]: [string, Track[]]) => {
                const collapsed = collapsedDates.has(date);
                // 각 날짜 그룹마다 TanStack 인스턴스 없이 직접 렌더
                return (
                  <>
                    <DateGroupHeader
                      key={`header-${date}`}
                      date={date}
                      count={dateRows.length}
                      collapsed={collapsed}
                      onToggle={() => toggleDate(date)}
                    />
                    {!collapsed &&
                      dateRows.map((track) => (
                        <tr
                          key={track.id}
                          className="border-b border-border/60 hover:bg-muted/20 transition-colors"
                        >
                          {tableCols.map((col) => (
                            <td
                              key={col.id as string}
                              className="px-3 py-2 align-top"
                              style={{ width: (col as { size?: number }).size }}
                            >
                              {col.id === "_actions" ? (
                                <button
                                  onClick={() => {
                                    startTransition(async () => {
                                      await deleteDiggingTrack(track.id);
                                      setTracks((prev) =>
                                        prev.filter((t) => t.id !== track.id),
                                      );
                                    });
                                  }}
                                  disabled={isPending}
                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <EditableCell
                                  trackId={track.id}
                                  columnId={col.id as string}
                                  columnType={
                                    columns.find((c) => c.id === col.id)?.columnType ?? "text"
                                  }
                                  value={track.values[col.id as string]}
                                  options={columns.find((c) => c.id === col.id)?.options}
                                  readonly={readonly}
                                />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </>
                );
              })
            )}

            {/* 인라인 추가 행 (readonly 모드 제외) */}
            {!readonly && (
              <InlineAddRow
                columns={columns}
                onTrackCreated={handleTrackCreated}
              />
            )}
          </tbody>
        </table>
      </div>

      {/* 트랙 추가 다이얼로그 (AddTrackDialog는 대안 경로 유지) */}
      {!readonly && (
        <>
          <AddTrackDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            columns={columns}
            onSuccess={() => {
              setAddOpen(false);
              // AddTrackDialog는 서버 재검증으로 처리
              window.location.reload();
            }}
          />
          <ColumnManager
            open={manageOpen}
            onOpenChange={setManageOpen}
            columns={columns}
            onSuccess={handleColumnsRefresh}
          />
        </>
      )}
    </div>
  );
}
