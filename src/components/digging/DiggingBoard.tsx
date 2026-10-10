/**
 * @file src/components/digging/DiggingBoard.tsx
 * @description 디깅 게시판 메인 클라이언트 컴포넌트 (Phase 5).
 * - TanStack Table 기반 동적 컬럼 테이블
 * - 날짜 범위 필터 + 날짜별 그룹핑
 * - 인라인 셀 편집
 * - 트랙 추가/삭제, 컬럼 추가/삭제
 */
"use client";

import { Fragment, useState, useMemo, useCallback, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import { Plus, Settings2, Trash2, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
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
import { parseStoredDiggingOptions } from "@/lib/digging-contract";
import { formatKst } from "@/lib/kst-format";
import { toKstDateInputValue } from "@/lib/date-input";

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
  columnName,
  columnType,
  value: initialValue,
  options,
  readonly,
}: {
  trackId: string;
  columnId: string;
  columnName: string;
  columnType: DiggingColumnType;
  value: unknown;
  options?: string | null;
  readonly?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const savedValueRef = useRef(initialValue);
  const [isPending, startTransition] = useTransition();
  const [saveStatus, setSaveStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const save = useCallback(
    (newVal: unknown) => {
      // 포커스만 이동한 경우 같은 값을 다시 저장하지 않는다.
      if (String(newVal ?? "") === String(savedValueRef.current ?? "")) {
        setValue(newVal);
        return;
      }
      const previousValue = savedValueRef.current;
      setValue(newVal);
      setSaveStatus(null);
      startTransition(async () => {
        try {
          await updateDiggingTrackValue(trackId, columnId, newVal);
          savedValueRef.current = newVal;
          setSaveStatus({ kind: "success", message: `${columnName} 저장됨` });
        } catch {
          setValue(previousValue);
          setSaveStatus({ kind: "error", message: `${columnName}을 저장하지 못했습니다. 다시 시도해 주세요.` });
        }
      });
    },
    [columnId, columnName, trackId],
  );

  const parsedOptions = parseStoredDiggingOptions(options ?? null) ?? [];
  const withStatus = (control: React.ReactNode) => (
    <div aria-busy={isPending}>
      {control}
      {saveStatus ? (
        <p
          className={saveStatus.kind === "error" ? "mt-1 text-xs text-destructive" : "sr-only"}
          role={saveStatus.kind === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {saveStatus.message}
        </p>
      ) : null}
    </div>
  );

  if (readonly) {
    if (columnType === "rating")
      return <StarRating aria-label={columnName} value={Number(value) || 0} readonly />;
    if (columnType === "camelot_key")
      return <CamelotPicker aria-label={columnName} value={(value as string) ?? ""} readonly />;
    if (columnType === "link" && value)
      return (
        <a href={value as string} target="_blank" rel="noreferrer" aria-label={`${columnName} 링크 열기`}
          className="text-primary hover:underline flex items-center gap-1 text-xs">
          <ExternalLink className="w-3 h-3" />링크
        </a>
      );
    return <span className="text-sm">{(value as string) ?? "미입력"}</span>;
  }

  if (columnType === "rating") {
    return withStatus(
      <StarRating
        aria-label={columnName}
        value={Number(value) || 0}
        disabled={isPending}
        onChange={(rating) => save(rating || "")}
      />,
    );
  }

  if (columnType === "camelot_key") {
    return withStatus(
      <CamelotPicker
        aria-label={columnName}
        value={(value as string) ?? ""}
        onChange={save}
      />,
    );
  }

  if (columnType === "select") {
    return withStatus(
      <select
        aria-label={columnName}
        value={(value as string) ?? ""}
        onChange={(e) => save(e.target.value)}
        disabled={isPending}
        className="w-full bg-transparent text-sm border-none outline-none focus:ring-1 focus:ring-ring rounded px-1"
      >
        <option value="">선택 안 함</option>
        {parsedOptions.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>,
    );
  }

  if (columnType === "link") {
    return withStatus(
      <div className="flex items-center gap-1">
        <input
          aria-label={columnName}
          type="url"
          value={(value as string) ?? ""}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => save(e.target.value)}
          disabled={isPending}
          placeholder="https://..."
          className="flex-1 bg-transparent text-xs border-none outline-none focus:ring-1 focus:ring-ring rounded px-1 min-w-0"
        />
        {typeof value === "string" && value && (
          <a href={value} target="_blank" rel="noreferrer" aria-label={`${columnName} 링크 새 창에서 열기`}>
            <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-primary" />
          </a>
        )}
      </div>,
    );
  }

  if (columnType === "textarea") {
    return withStatus(
      <textarea
        aria-label={columnName}
        value={(value as string) ?? ""}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        disabled={isPending}
        rows={2}
        className="w-full bg-transparent text-sm border-none outline-none focus:ring-1 focus:ring-ring rounded px-1 resize-none"
      />,
    );
  }

  // text / number
  return withStatus(
    <input
      aria-label={columnName}
      type={columnType === "number" ? "number" : "text"}
      value={(value as string) ?? ""}
      onChange={(e) => setValue(e.target.value)}
      onBlur={(e) => save(e.target.value)}
      disabled={isPending}
      className="w-full bg-transparent text-sm border-none outline-none focus:ring-1 focus:ring-ring rounded px-1"
    />,
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
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
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
  // 컬럼은 서버가 소유하고 변경 뒤 router.refresh로 다시 받는다. 트랙은 편집 중 상태를 유지한다.
  const columns = initialColumns;
  const router = useRouter();
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [mutationError, setMutationError] = useState("");

  // 날짜 범위 필터 + 그룹핑
  const groupedTracks = useMemo(() => {
    // 날짜 입력과 그룹은 모두 KST 날짜 key(YYYY-MM-DD)로 비교한다.
    const filtered = tracks.filter((t) => {
      if (!t.createdAt) return true;
      const dateKey = toKstDateInputValue(new Date(t.createdAt));
      if (dateFrom && dateKey < dateFrom) return false;
      if (dateTo && dateKey > dateTo) return false;
      return true;
    });

    const groups = new Map<string, { label: string; tracks: Track[] }>();
    filtered.forEach((t) => {
      const dateKey = t.createdAt ? toKstDateInputValue(new Date(t.createdAt)) : "";
      const group = groups.get(dateKey) ?? {
        label: t.createdAt
          ? formatKst(t.createdAt, { year: "numeric", month: "long", day: "numeric", weekday: "short" })
          : "날짜 없음",
        tracks: [],
      };
      group.tracks.push(t);
      groups.set(dateKey, group);
    });

    // 최신 날짜 순 정렬, 날짜 없는 트랙은 마지막
    return [...groups.entries()]
      .sort(([a], [b]) => (a && b ? b.localeCompare(a) : a ? -1 : b ? 1 : 0))
      .map(([, group]) => [group.label, group.tracks] as [string, Track[]]);
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

  const trackDeleteConfirm = useConfirmAction<string>();
  const requestTrackDelete = trackDeleteConfirm.request;
  const trackLabelColumn = columns.find((column) => column.name === "트랙명")
    ?? columns.find((column) => column.columnType === "text");
  const describeTrack = (track: Track) => {
    const label = trackLabelColumn ? track.values[trackLabelColumn.id] : null;
    return typeof label === "string" && label.trim() ? `‘${label.trim()}’ 트랙` : "이 트랙";
  };
  const renderTrackDeleteConfirm = (track: Track, className?: string) => (
    trackDeleteConfirm.value === track.id ? (
      <ConfirmPanel
        confirm={trackDeleteConfirm}
        message={`${describeTrack(track)}을 삭제할까요? 삭제 후에는 복구할 수 없습니다.`}
        confirmLabel="트랙 삭제 확인"
        pendingLabel="삭제 중..."
        pending={isPending}
        onConfirm={() => removeTrack(track.id)}
        className={className}
      />
    ) : null
  );

  const removeTrack = useCallback((trackId: string) => {
    setMutationError("");
    startTransition(async () => {
      try {
        await deleteDiggingTrack(trackId);
        setTracks((previous) => previous.filter((track) => track.id !== trackId));
      } catch {
        setMutationError("트랙을 삭제하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  }, []);

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
            columnName={col.name}
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
                  type="button"
                  onClick={(event) => requestTrackDelete(event.currentTarget, row.original.id)}
                  disabled={isPending}
                  aria-label="디깅 트랙 삭제"
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              ),
            } as ColumnDef<Track>,
          ]
        : []),
    ],
    [columns, readonly, isPending, requestTrackDelete],
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
  const handleColumnsRefresh = useCallback(() => router.refresh(), [router]);

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 날짜 범위 필터 */}
        <div className="grid w-full grid-cols-2 gap-2 text-sm sm:flex sm:w-auto sm:items-end">
          <div className="space-y-1">
            <label htmlFor="digging-date-from" className="text-xs text-muted-foreground">시작일</label>
            <Input
              id="digging-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 w-full text-xs sm:w-36"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="digging-date-to" className="text-xs text-muted-foreground">종료일</label>
            <Input
              id="digging-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 w-full text-xs sm:w-36"
            />
          </div>
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="col-span-2 justify-self-start text-xs text-muted-foreground hover:text-foreground sm:col-span-1 sm:pb-2"
            >
              초기화
            </button>
          )}
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
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
      {mutationError ? <p className="text-sm text-destructive" role="alert">{mutationError}</p> : null}

      {/* Mobile record list */}
      <div className="space-y-4 md:hidden">
        {groupedTracks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
            {tracks.length === 0
              ? "아직 추가된 트랙이 없습니다."
              : "선택한 기간에 트랙이 없습니다."}
          </div>
        ) : (
          groupedTracks.map(([date, dateRows]) => {
            const collapsed = collapsedDates.has(date);

            return (
              <section key={date} aria-labelledby={`digging-date-${encodeURIComponent(date)}`}>
                <button
                  type="button"
                  onClick={() => toggleDate(date)}
                  aria-expanded={!collapsed}
                  className="mb-2 flex w-full items-center gap-2 rounded-md px-1 py-2 text-left text-sm font-semibold text-foreground"
                >
                  {collapsed ? (
                    <ChevronRight className="size-4" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="size-4" aria-hidden="true" />
                  )}
                  <span id={`digging-date-${encodeURIComponent(date)}`}>{date}</span>
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{dateRows.length}곡</span>
                </button>
                {!collapsed ? (
                  <div className="space-y-3">
                    {dateRows.map((track) => (
                      <div key={track.id} className="rounded-lg border border-border bg-surface p-4">
                        <div className="space-y-4">
                          {columns.map((column) => (
                            <div key={column.id} className="grid gap-1.5">
                              <span className="text-xs font-medium text-muted-foreground">
                                {column.name}
                              </span>
                              <EditableCell
                                trackId={track.id}
                                columnId={column.id}
                                columnName={column.name}
                                columnType={column.columnType}
                                value={track.values[column.id]}
                                options={column.options}
                                readonly={readonly}
                              />
                            </div>
                          ))}
                        </div>
                        {!readonly ? (
                          <div className="mt-4 border-t border-border pt-3 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isPending}
                              className="text-destructive"
                              aria-expanded={trackDeleteConfirm.value === track.id}
                              onClick={(event) => requestTrackDelete(event.currentTarget, track.id)}
                            >
                              <Trash2 className="mr-1.5 size-3.5" aria-hidden="true" />
                              트랙 삭제
                            </Button>
                            {renderTrackDeleteConfirm(track, "mt-3 text-left")}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-auto rounded-lg border border-border md:block">
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
                  <Fragment key={date}>
                    <DateGroupHeader
                      date={date}
                      count={dateRows.length}
                      collapsed={collapsed}
                      onToggle={() => toggleDate(date)}
                    />
                    {!collapsed &&
                      dateRows.map((track) => (
                        <Fragment key={track.id}>
                        <tr
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
                                  type="button"
                                  onClick={(event) => requestTrackDelete(event.currentTarget, track.id)}
                                  disabled={isPending}
                                  aria-expanded={trackDeleteConfirm.value === track.id}
                                  aria-label="디깅 트랙 삭제"
                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              ) : (
                                <EditableCell
                                  trackId={track.id}
                                  columnId={col.id as string}
                                  columnName={columns.find((c) => c.id === col.id)?.name ?? "트랙 값"}
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
                        {trackDeleteConfirm.value === track.id ? (
                          <tr className="border-b border-border/60">
                            <td colSpan={tableCols.length} className="px-3 py-2">
                              {renderTrackDeleteConfirm(track, "max-w-xl")}
                            </td>
                          </tr>
                        ) : null}
                        </Fragment>
                      ))}
                  </Fragment>
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
            onTrackCreated={handleTrackCreated}
            onSuccess={() => setAddOpen(false)}
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
