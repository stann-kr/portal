/**
 * @file src/components/digging/DiggingBoard.tsx
 * @description 디깅 보드(Digging·MobileDigging·AdminStudentDigging 보드) 메인 클라이언트 컴포넌트.
 * - 넓은 화면: 날짜별 묶음(rowgroup)의 동적 컬럼 표, 칸을 눌러 바로 고치는 인라인 편집, 맨 아래 인라인 추가
 * - 좁은 화면: 같은 묶음의 트랙 카드 목록(라벨 위·값 아래, 링크 열기·트랙 삭제)
 * - 날짜 범위 필터, 트랙 추가/삭제, 컬럼 관리. readonly(관리자 보기)는 값만 보여 준다.
 */
"use client";

import { Fragment, useState, useMemo, useCallback, useEffect, useId, useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
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
import { cn } from "@/lib/utils";

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
  /** 학생 디깅 화면의 h1·설명. 넓은 화면에서 도구 줄과 한 줄에 놓이고, 좁은 화면에서는 화면 읽기에만 남는다. */
  heading?: ReactNode;
  /** 좁은 화면 위쪽 막대 오른쪽에 트랙 추가를 둔다(학생 디깅 화면). readonly에서는 무시한다. */
  mobileTopBar?: boolean;
}

type CellVariant = "table" | "card";

/** 카드에서 반 칸을 쓰는 짧은 값(선호도·별점처럼 나란히 놓는다). */
const COMPACT_TYPES: ReadonlySet<DiggingColumnType> = new Set(["select", "rating", "number", "camelot_key"]);

/** 캔버스 기본 컬럼 폭(트랙명 22%, 아티스트 16%, 감상평 나머지, 선호도 88, 별점 104, 링크 56/64). */
function columnWidth(column: Column, isLabelColumn: boolean, readonly: boolean): string | number | undefined {
  switch (column.columnType) {
    case "text": return isLabelColumn ? "22%" : "16%";
    case "textarea": return undefined;
    case "rating": return 104;
    case "link": return readonly ? 64 : 56;
    default: return 88;
  }
}

/** 선호도 같은 선택 값의 칩 색. 캔버스의 좋음·보통·별로 외 값은 중립 칩이다. */
function selectChipClass(value: string): string {
  if (value === "좋음") return "bg-accent text-accent-foreground";
  if (value === "별로") return "bg-destructive-muted text-destructive";
  return "bg-muted text-secondary-foreground";
}

function formatGroupLabel(date: Date): string {
  return `${formatKst(date, { year: "numeric", month: "long", day: "numeric" })} (${formatKst(date, { weekday: "short" })})`;
}

/** 날짜 입력값(YYYY-MM-DD)을 기간 버튼의 짧은 표시(MM.DD)로. */
function shortDateInput(value: string): string {
  return value.length === 10 ? `${value.slice(5, 7)}.${value.slice(8, 10)}` : value;
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
  variant,
  emphasis = false,
  onSaved,
}: {
  trackId: string;
  columnId: string;
  columnName: string;
  columnType: DiggingColumnType;
  value: unknown;
  options?: string | null;
  readonly?: boolean;
  variant: CellVariant;
  /** 트랙명처럼 행을 대표하는 값 */
  emphasis?: boolean;
  /** 저장이 확정된 값을 보드의 트랙 상태에도 반영한다(링크 열기·설명 이름이 새 값을 쓴다). */
  onSaved?: (trackId: string, columnId: string, value: unknown) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const savedValueRef = useRef(initialValue);
  const [isPending, startTransition] = useTransition();
  const [saveStatus, setSaveStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [editingLink, setEditingLink] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkEditButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editingLink) linkInputRef.current?.focus();
  }, [editingLink]);

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
          onSaved?.(trackId, columnId, newVal);
          setSaveStatus({ kind: "success", message: `${columnName} 저장됨` });
        } catch {
          setValue(previousValue);
          setSaveStatus({ kind: "error", message: `${columnName}을 저장하지 못했습니다. 다시 시도해 주세요.` });
        }
      });
    },
    [columnId, columnName, onSaved, trackId],
  );

  const parsedOptions = parseStoredDiggingOptions(options ?? null) ?? [];
  const text = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  const table = variant === "table";
  const withStatus = (control: ReactNode) => (
    <div aria-busy={isPending} className="min-w-0">
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
      return <StarRating aria-label={columnName} value={Number(value) || 0} readonly size={table ? "sm" : "md"} />;
    if (columnType === "camelot_key")
      return <CamelotPicker aria-label={columnName} value={text} readonly />;
    if (columnType === "link")
      return text ? (
        <a
          href={text}
          target="_blank"
          rel="noreferrer"
          aria-label={`${columnName} 링크 열기`}
          className="text-ui text-secondary-foreground underline underline-offset-[3px] hover:text-foreground"
        >
          링크
        </a>
      ) : <span className="text-ui text-muted-foreground">미입력</span>;
    if (!text) return <span className={cn("text-muted-foreground", table ? "text-ui" : "text-md")}>미입력</span>;
    return (
      <span
        className={cn(
          "block min-w-0",
          table ? "truncate" : "break-words",
          emphasis
            ? cn("font-medium text-foreground", !table && "text-base font-semibold")
            : cn("text-secondary-foreground", table ? (columnType === "textarea" || columnType === "select" ? "text-ui" : "text-body") : "text-md"),
        )}
      >
        {text}
      </span>
    );
  }

  // 표 칸은 글자처럼 보이다가 누르면 바로 고친다. 카드 칸은 터치 높이 44와 16px 글자(확대 방지)를 쓴다.
  const fieldClass = cn(
    "w-full min-w-0 bg-transparent outline-none placeholder:text-faint transition-colors duration-[var(--duration-fast)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none",
    table ? "h-11 rounded-sm px-1 hover:bg-sidebar focus-visible:bg-background" : "-mx-2 h-11 w-[calc(100%+1rem)] rounded-touch px-2 text-base hover:bg-sidebar",
    emphasis ? cn("font-medium text-foreground", !table && "font-semibold") : table ? "text-secondary-foreground" : "text-foreground",
  );

  if (columnType === "rating") {
    return withStatus(
      <StarRating
        aria-label={columnName}
        size={table ? "sm" : "touch"}
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
        variant={table ? "table" : "field"}
        value={text}
        onChange={save}
      />,
    );
  }

  if (columnType === "select") {
    // 보이는 것은 칩, 실제 조작은 칸 높이(44)를 덮는 투명한 기본 select가 맡는다.
    return withStatus(
      <span className="relative inline-flex h-11 max-w-full items-center rounded-sm has-[select:focus-visible]:ring-2 has-[select:focus-visible]:ring-ring">
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex max-w-full items-center truncate rounded-sm px-2",
            table ? "h-[22px] text-xs" : "h-6 text-ui",
            text ? selectChipClass(text) : "text-faint",
          )}
        >
          {text || "—"}
        </span>
        <select
          aria-label={columnName}
          value={text}
          onChange={(e) => save(e.target.value)}
          disabled={isPending}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-default"
        >
          <option value="">선택 안 함</option>
          {parsedOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </span>,
    );
  }

  if (columnType === "link") {
    if (!table) {
      return withStatus(
        <input
          aria-label={columnName}
          type="url"
          value={text}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => save(e.target.value)}
          disabled={isPending}
          placeholder="https://..."
          className={fieldClass}
        />,
      );
    }
    // 표의 링크 칸(56px)은 열기 아이콘과 수정 버튼만 두고, 고칠 때는 칸 왼쪽으로 펼친 입력을 띄운다.
    const closeEditor = (restoreFocus: boolean) => {
      setEditingLink(false);
      if (restoreFocus) requestAnimationFrame(() => linkEditButtonRef.current?.focus());
    };
    return withStatus(
      <div className="relative flex h-11 items-center">
        {text ? (
          <a
            href={text}
            target="_blank"
            rel="noreferrer"
            aria-label={`${columnName} 링크 새 창에서 열기`}
            className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
          </a>
        ) : null}
        <button
          ref={linkEditButtonRef}
          type="button"
          aria-label={text ? `${columnName} 수정` : `${columnName} 추가`}
          aria-expanded={editingLink}
          disabled={isPending}
          onClick={() => setEditingLink(true)}
          className={cn(
            "flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            text && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          {text ? <Pencil className="size-3" strokeWidth={1.6} aria-hidden="true" /> : <Plus className="size-3.5" strokeWidth={1.6} aria-hidden="true" />}
        </button>
        {editingLink ? (
          <input
            ref={linkInputRef}
            aria-label={columnName}
            type="url"
            value={text}
            placeholder="https://..."
            onChange={(e) => setValue(e.target.value)}
            onBlur={(e) => { save(e.target.value); closeEditor(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(e.currentTarget.value); closeEditor(true); }
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setValue(savedValueRef.current); closeEditor(true); }
            }}
            className="absolute right-0 top-1/2 h-9 w-64 -translate-y-1/2 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-floating outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring"
            style={{ zIndex: "var(--z-dropdown)" }}
          />
        ) : null}
      </div>,
    );
  }

  if (columnType === "textarea") {
    return withStatus(
      <textarea
        aria-label={columnName}
        value={text}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        disabled={isPending}
        rows={1}
        className={cn(
          fieldClass,
          "resize-none",
          table
            ? "overflow-hidden whitespace-nowrap py-[11px] text-ui leading-[22px] focus-visible:h-24 focus-visible:overflow-auto focus-visible:whitespace-pre-wrap"
            : "min-h-11 py-2.5 leading-6 field-sizing-content",
        )}
      />,
    );
  }

  // text / number
  return withStatus(
    <input
      aria-label={columnName}
      type={columnType === "number" ? "number" : "text"}
      value={text}
      onChange={(e) => setValue(e.target.value)}
      onBlur={(e) => save(e.target.value)}
      disabled={isPending}
      className={cn(fieldClass, "truncate", columnType === "number" && "font-mono", table && !emphasis && "text-body")}
    />,
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────

export function DiggingBoard({
  initialColumns,
  initialTracks,
  readonly = false,
  heading,
  mobileTopBar = false,
}: DiggingBoardProps) {
  // 컬럼은 서버가 소유하고 변경 뒤 router.refresh로 다시 받는다. 트랙은 편집 중 상태를 유지한다.
  const columns = initialColumns;
  const router = useRouter();
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const handleCellSaved = useCallback((trackId: string, columnId: string, value: unknown) => {
    setTracks((previous) => previous.map((track) => (
      track.id === trackId ? { ...track, values: { ...track.values, [columnId]: value } } : track
    )));
  }, []);
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [mutationError, setMutationError] = useState("");
  const rangeId = useId();
  const rangeTriggerRef = useRef<HTMLButtonElement>(null);
  const rangePanelRef = useRef<HTMLDivElement>(null);

  // 넓은 화면의 기간 패널은 바깥을 누르면 닫는다(좁은 화면은 항상 펼친 입력이다).
  useEffect(() => {
    if (!rangeOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rangePanelRef.current?.contains(target) || rangeTriggerRef.current?.contains(target)) return;
      setRangeOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [rangeOpen]);

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
        label: t.createdAt ? formatGroupLabel(new Date(t.createdAt)) : "날짜 없음",
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
  const primaryLinkColumn = columns.find((column) => column.columnType === "link");
  const describeTrack = (track: Track) => {
    const label = trackLabelColumn ? track.values[trackLabelColumn.id] : null;
    return typeof label === "string" && label.trim() ? `‘${label.trim()}’ 트랙` : "이 트랙";
  };
  const trackLink = (track: Track) => {
    const value = primaryLinkColumn ? track.values[primaryLinkColumn.id] : null;
    if (typeof value === "string" && value) return value;
    return track.linkUrl || null;
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

  const handleTrackCreated = useCallback(
    (newTrack: Track) => {
      setTracks((prev) => [newTrack, ...prev]);
    },
    [],
  );

  // ColumnManager 성공 시 서버에서 최신 컬럼 목록 재조회
  const handleColumnsRefresh = useCallback(() => router.refresh(), [router]);

  const topBarActions = useMemo(() => (
    <button
      type="button"
      aria-label="트랙 추가"
      onClick={() => setAddOpen(true)}
      className="flex size-11 shrink-0 items-center justify-center rounded-touch text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Plus className="size-5" strokeWidth={1.6} aria-hidden="true" />
    </button>
  ), []);

  const columnCount = columns.length + (readonly ? 0 : 1);
  const tableMinWidth = Math.max(860, columns.length * 120 + (readonly ? 0 : 56));
  const emptyMessage = tracks.length === 0 ? "아직 추가된 트랙이 없습니다." : "선택한 기간에 트랙이 없습니다.";
  const rangeLabel = dateFrom && dateTo
    ? `${shortDateInput(dateFrom)} – ${shortDateInput(dateTo)}`
    : dateFrom ? `${shortDateInput(dateFrom)} 이후`
      : dateTo ? `${shortDateInput(dateTo)} 이전` : "기간 전체";
  const closeRange = () => {
    setRangeOpen(false);
    rangeTriggerRef.current?.focus();
  };

  // 날짜 범위: 좁은 화면은 늘 펼친 두 칸, 넓은 화면은 관리자 보기에서 한 줄 입력·학생 보기에서 "기간" 버튼의 패널.
  const dateRange = (
    <div
      ref={rangePanelRef}
      id={rangeId}
      role="group"
      aria-label="기간"
      onKeyDown={(event) => {
        if (event.key === "Escape" && rangeOpen) {
          event.preventDefault();
          closeRange();
        }
      }}
      className={cn(
        "grid grid-cols-2 gap-2",
        readonly
          ? "md:flex md:items-end"
          : cn(
            "md:absolute md:right-0 md:top-full md:z-[var(--z-dropdown)] md:mt-2 md:w-80 md:rounded-lg md:border md:border-border md:bg-background md:p-3 md:shadow-floating",
            rangeOpen ? "md:grid" : "md:hidden",
          ),
      )}
    >
      <label htmlFor="digging-date-from" className="flex flex-col gap-1 text-xs text-muted-foreground">
        시작일
        <Input
          id="digging-date-from"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className={cn("px-2.5 font-mono text-foreground", readonly && "md:h-8 md:w-36 md:px-2 md:text-xs")}
        />
      </label>
      <label htmlFor="digging-date-to" className="flex flex-col gap-1 text-xs text-muted-foreground">
        종료일
        <Input
          id="digging-date-to"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className={cn("px-2.5 font-mono text-foreground", readonly && "md:h-8 md:w-36 md:px-2 md:text-xs")}
        />
      </label>
      {(dateFrom || dateTo) && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => { setDateFrom(""); setDateTo(""); }}
          className="col-span-2 h-11 justify-self-start md:col-span-1 md:h-8"
        >
          초기화
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 md:gap-6">
      {mobileTopBar && !readonly ? <MobileTopBar title="디깅 보드" actions={topBarActions} /> : null}

      {/* 머리: 넓은 화면은 제목(왼쪽)과 기간·컬럼·트랙 추가(오른쪽)가 한 줄, 좁은 화면은 기간 입력만 보인다. */}
      <div className="relative flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-4">
        {heading ? <div className="sr-only md:not-sr-only md:flex md:flex-col md:gap-1">{heading}</div> : null}
        {!readonly ? (
          <div className="hidden gap-2 md:flex">
            <Button
              ref={rangeTriggerRef}
              type="button"
              variant="outline"
              aria-expanded={rangeOpen}
              aria-controls={rangeId}
              onClick={() => setRangeOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && rangeOpen) {
                  event.preventDefault();
                  setRangeOpen(false);
                }
              }}
              className="px-2.5 text-secondary-foreground"
            >
              <CalendarRange className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
              {rangeLabel}
            </Button>
            <Button type="button" variant="outline" onClick={() => setManageOpen(true)} className="px-2.5 text-secondary-foreground">
              컬럼
            </Button>
            <Button type="button" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
              트랙 추가
            </Button>
          </div>
        ) : null}
        {dateRange}
      </div>

      {!readonly ? (
        // 좁은 화면: 위쪽 막대가 트랙 추가를 맡고, 컬럼 관리는 기간 아래 보조 줄에 둔다.
        <div className="-mt-1 flex justify-end md:hidden">
          <Button type="button" variant="ghost" onClick={() => setManageOpen(true)} className="h-11 text-body">
            컬럼 관리
          </Button>
        </div>
      ) : null}
      {mutationError ? <p className="text-ui text-destructive" role="alert">{mutationError}</p> : null}

      {/* 좁은 화면: 날짜 묶음별 트랙 카드 */}
      <div className="flex flex-col gap-3 md:hidden">
        {groupedTracks.length === 0 ? (
          <p className="rounded-lg border border-muted px-4 py-12 text-center text-ui text-muted-foreground">{emptyMessage}</p>
        ) : (
          groupedTracks.map(([date, dateRows]) => {
            const collapsed = collapsedDates.has(date);
            const labelId = `digging-date-${encodeURIComponent(date)}`;

            return (
              <section key={date} aria-labelledby={labelId} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => toggleDate(date)}
                  aria-expanded={!collapsed}
                  className="flex h-11 w-full items-center justify-between gap-3 border-b border-border text-left text-ui font-semibold text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span id={labelId}>{date}</span>
                  <span className="font-mono font-normal text-muted-foreground">{dateRows.length}곡</span>
                </button>
                {!collapsed ? (
                  <div className="flex flex-col gap-2.5 pt-3">
                    {dateRows.map((track) => {
                      const link = trackLink(track);
                      const fields = readonly && primaryLinkColumn
                        ? columns.filter((column) => column.id !== primaryLinkColumn.id)
                        : columns;
                      return (
                        <article
                          key={track.id}
                          aria-label={describeTrack(track)}
                          className="flex flex-col gap-2.5 rounded-lg border border-border px-4 pb-1.5 pt-3.5"
                        >
                          <div className="grid grid-cols-2 gap-x-2 gap-y-2.5">
                            {fields.map((column) => (
                              <div
                                key={column.id}
                                className={cn(
                                  "flex min-w-0 flex-col",
                                  // 고칠 수 있는 별점은 별 다섯 개가 각각 44px이라 한 줄을 다 쓴다.
                                  COMPACT_TYPES.has(column.columnType) && !(column.columnType === "rating" && !readonly)
                                    ? "col-span-1 gap-1"
                                    : "col-span-2 gap-0.5",
                                )}
                              >
                                <span className="text-xs text-muted-foreground">{column.name}</span>
                                <EditableCell
                                  trackId={track.id}
                                  columnId={column.id}
                                  columnName={column.name}
                                  columnType={column.columnType}
                                  value={track.values[column.id]}
                                  options={column.options}
                                  readonly={readonly}
                                  variant="card"
                                  onSaved={handleCellSaved}
                                  emphasis={column.id === trackLabelColumn?.id}
                                />
                              </div>
                            ))}
                          </div>
                          {link || !readonly ? (
                            <div className="flex items-center justify-between border-t border-muted">
                              {link ? (
                                <a
                                  href={link}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-11 items-center gap-1.5 text-body text-secondary-foreground underline underline-offset-[3px] hover:text-foreground"
                                >
                                  링크 열기
                                  <ExternalLink className="size-3" strokeWidth={1.8} aria-hidden="true" />
                                </a>
                              ) : <span />}
                              {!readonly ? (
                                <button
                                  type="button"
                                  disabled={isPending}
                                  aria-expanded={trackDeleteConfirm.value === track.id}
                                  onClick={(event) => requestTrackDelete(event.currentTarget, track.id)}
                                  className="h-11 rounded-sm px-1 text-body text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                                >
                                  트랙 삭제
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {renderTrackDeleteConfirm(track, "mb-2.5")}
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>

      {/* 넓은 화면: 날짜 묶음(rowgroup)별 표 */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full table-fixed border-collapse text-body" style={{ minWidth: tableMinWidth }}>
          <thead>
            <tr className="border-b border-border">
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className="h-9 truncate px-2 text-left text-xs font-normal text-muted-foreground"
                  style={{ width: columnWidth(column, column.id === trackLabelColumn?.id, readonly) }}
                >
                  {column.name}
                </th>
              ))}
              {!readonly ? (
                <th scope="col" className="px-2" style={{ width: 56 }}>
                  <span className="sr-only">트랙 삭제</span>
                </th>
              ) : null}
            </tr>
          </thead>

          {groupedTracks.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={columnCount} className="px-2 py-16 text-center text-ui text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            </tbody>
          ) : (
            groupedTracks.map(([date, dateRows]: [string, Track[]]) => {
              const collapsed = collapsedDates.has(date);
              return (
                <tbody key={date}>
                  <tr>
                    <th scope="rowgroup" colSpan={columnCount} className="h-10 px-2 pb-1 pt-3 text-left text-xs font-medium text-secondary-foreground">
                      <button
                        type="button"
                        onClick={() => toggleDate(date)}
                        aria-expanded={!collapsed}
                        className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {date} <span className="font-normal text-muted-foreground">· {dateRows.length}곡</span>
                      </button>
                    </th>
                  </tr>
                  {!collapsed &&
                    dateRows.map((track) => (
                      <Fragment key={track.id}>
                        <tr className="group border-b border-muted">
                          {columns.map((column) => (
                            <td key={column.id} className={cn("h-11 overflow-visible align-middle", readonly ? "px-2" : "px-1")}>
                              <EditableCell
                                trackId={track.id}
                                columnId={column.id}
                                columnName={column.name}
                                columnType={column.columnType}
                                value={track.values[column.id]}
                                options={column.options}
                                readonly={readonly}
                                variant="table"
                                emphasis={column.id === trackLabelColumn?.id}
                                onSaved={handleCellSaved}
                              />
                            </td>
                          ))}
                          {!readonly ? (
                            <td className="px-2 align-middle">
                              <button
                                type="button"
                                onClick={(event) => requestTrackDelete(event.currentTarget, track.id)}
                                disabled={isPending}
                                aria-expanded={trackDeleteConfirm.value === track.id}
                                aria-label="디깅 트랙 삭제"
                                className="flex size-6 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-destructive-muted hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 aria-expanded:opacity-100 disabled:opacity-50 motion-reduce:transition-none"
                              >
                                <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                              </button>
                            </td>
                          ) : null}
                        </tr>
                        {trackDeleteConfirm.value === track.id ? (
                          <tr className="border-b border-muted">
                            <td colSpan={columnCount} className="px-2 py-2">
                              {renderTrackDeleteConfirm(track, "max-w-xl")}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                </tbody>
              );
            })
          )}

          {/* 인라인 추가 행 (readonly 모드 제외) */}
          {!readonly && (
            <tbody>
              <InlineAddRow
                columns={columns}
                onTrackCreated={handleTrackCreated}
              />
            </tbody>
          )}
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
