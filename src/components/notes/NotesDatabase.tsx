"use client";

/**
 * Notion database처럼 노트를 표·목록으로 보고, 열 머리로 정렬하고, 맨 아래 행에서 제목만 적어 바로 작성을 시작한다(Notes·MobileNotes 보드).
 * 데이터 소유권은 서버 page가 이미 검증한 행만 받는 것으로 유지하며, 이 component는 서버에 쓰지 않는다.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, List, Plus, Table2 } from "lucide-react";
import { assertAccountOwnerMayPersist } from "@/lib/account-terminal-lock";
import { toKstDateInputValue } from "@/lib/date-input";
import { createAccountNotesViewStorageKey } from "@/lib/local-owner-keys";
import { buildNoteCreateHref } from "@/lib/note-create-route";
import { PRIVATE_NOTE_MAX_TITLE_LENGTH } from "@/lib/private-note-continuity";
import {
  DEFAULT_NOTES_SORT,
  DEFAULT_NOTES_VIEW_MODE,
  NOTES_SORT_LABELS,
  formatNotesSortValue,
  getNotesSortAria,
  parseNotesSort,
  resolveNotesViewMode,
  sortNotesDatabaseRows,
  toggleNotesSort,
  type NotesDatabaseRow,
  type NotesSort,
  type NotesSortKey,
  type NotesViewMode,
} from "@/lib/notes-database";
import { cn } from "@/lib/utils";
import { NoteSearch } from "./NoteSearch";
import { buildPrivateNoteHref, NoteRowList, NotesEmptyState } from "./PrivateNoteList";
import { formatListUpdatedLabel, toLedgerDateLabel } from "./note-display";

const NOTES_VIEW_CHANGE_EVENT = "portal:notes-view-change";

function subscribeNotesView(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(NOTES_VIEW_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(NOTES_VIEW_CHANGE_EVENT, onChange);
  };
}

function readStoredNotesView(storageKey: string): NotesViewMode | null {
  try {
    return resolveNotesViewMode(window.localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

/** 서버 렌더와 첫 hydration은 기본 보기로 맞추고, 저장된 선택은 client snapshot에서만 읽는다. */
function useNotesViewMode(ownerId: string): [NotesViewMode, (mode: NotesViewMode) => void] {
  const storageKey = createAccountNotesViewStorageKey(ownerId);
  const stored = useSyncExternalStore(
    subscribeNotesView,
    () => readStoredNotesView(storageKey),
    () => null,
  );
  // 저장소를 쓸 수 없는 환경에서도 이번 화면 안에서는 전환이 동작해야 한다.
  const [selected, setSelected] = useState<NotesViewMode | null>(null);
  const setMode = (mode: NotesViewMode) => {
    setSelected(mode);
    try {
      assertAccountOwnerMayPersist(window.localStorage, ownerId);
      window.localStorage.setItem(storageKey, mode);
      window.dispatchEvent(new Event(NOTES_VIEW_CHANGE_EVENT));
    } catch {
      /* localStorage 접근 불가·종료된 계정은 이번 화면에서만 유지한다. */
    }
  };
  return [selected ?? stored ?? DEFAULT_NOTES_VIEW_MODE, setMode];
}

const SORT_OPTIONS: { value: string; label: string }[] = (["date", "updated", "title", "author"] as NotesSortKey[]).flatMap((key) => {
  const isDate = key === "date" || key === "updated";
  return [
    { sort: { key, direction: isDate ? "desc" : "asc" } as NotesSort, label: `${NOTES_SORT_LABELS[key]} · ${isDate ? "최신순" : "가나다순"}` },
    { sort: { key, direction: isDate ? "asc" : "desc" } as NotesSort, label: `${NOTES_SORT_LABELS[key]} · ${isDate ? "오래된순" : "역순"}` },
  ].map(({ sort, label }) => ({ value: formatNotesSortValue(sort), label }));
});

/** 표 열 머리(Notes 보드). 정렬 이름은 `NOTES_SORT_LABELS`를 그대로 쓰고 열 머리만 짧게 쓴다. */
const COLUMN_LABELS: Record<NotesSortKey, string> = { title: "제목", date: "날짜", updated: "수정", author: "작성자" };

function SortableHeader({ column, sort, onSort, className }: {
  column: NotesSortKey;
  sort: NotesSort;
  onSort: (key: NotesSortKey) => void;
  className?: string;
}) {
  const state = getNotesSortAria(sort, column);
  const DirectionIcon = state === "ascending" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={state} className={cn("h-9 px-2 text-left text-xs font-normal text-muted-foreground", className)}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "-mx-1 inline-flex h-7 max-w-full items-center gap-1 rounded-sm px-1 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          state !== "none" && "font-medium text-foreground",
        )}
      >
        <span className="truncate">{COLUMN_LABELS[column]}</span>
        {state !== "none" && <DirectionIcon className="size-3 shrink-0" strokeWidth={1.8} aria-hidden="true" />}
      </button>
    </th>
  );
}

function NotesTable({ rows, returnTo, sort, onSort, now }: {
  rows: NotesDatabaseRow[];
  returnTo: string;
  sort: NotesSort;
  onSort: (key: NotesSortKey) => void;
  now?: number;
}) {
  return (
    <table className="w-full table-fixed border-collapse text-body">
      <caption className="sr-only">노트 표. 열 머리를 눌러 정렬합니다.</caption>
      <thead>
        <tr className="border-b border-border">
          <SortableHeader column="title" sort={sort} onSort={onSort} />
          <SortableHeader column="date" sort={sort} onSort={onSort} className="w-[140px]" />
          <SortableHeader column="updated" sort={sort} onSort={onSort} className="w-[160px]" />
          <SortableHeader column="author" sort={sort} onSort={onSort} className="w-[100px]" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          // 행 전체를 덮는 제목 링크 하나로 연다(행마다 링크는 하나).
          <tr key={row.id} className="relative border-b border-muted transition-colors hover:bg-sidebar">
            <td className="h-11 overflow-hidden px-2">
              <Link
                href={buildPrivateNoteHref(row.id, returnTo)}
                className="flex min-w-0 items-center gap-2.5 text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
              >
                <FileText className="size-[15px] shrink-0 text-item-note" strokeWidth={1.6} aria-hidden="true" />
                <span className="min-w-0 max-w-[70%] shrink-0 truncate font-medium">{row.title}</span>
                <span className="min-w-0 flex-1 truncate text-ui text-muted-foreground">{row.preview}</span>
              </Link>
            </td>
            <td className="truncate px-2 font-mono text-xs text-secondary-foreground">{toLedgerDateLabel(row.dateLabel)}</td>
            <td className="truncate px-2 text-ui text-muted-foreground">{formatListUpdatedLabel(row, now)}</td>
            <td className="truncate px-2 text-ui text-secondary-foreground">{row.authorName ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function NotesDatabase({
  rows,
  ownerId,
  returnTo,
  returnFallback,
  composerPath,
  searchAction,
  query,
  totalCount,
  emptyMessage,
  now,
}: {
  rows: NotesDatabaseRow[];
  /** 보기 선택을 기억할 현재 로그인 계정. */
  ownerId: string;
  returnTo: string;
  returnFallback: string;
  /** 새 노트 full-page composer 경로(대상 학생 문맥 포함). */
  composerPath: string;
  searchAction: string;
  query: string;
  totalCount: number;
  emptyMessage: string;
  /** 서버 기준 시각(`getRequestNow()`). 주면 하루 안 수정은 "2시간 전"처럼, 같은 해 날짜는 좁은 화면에서 월·일로 줄인다. */
  now?: number;
}) {
  const router = useProgressRouter();
  const [view, setView] = useNotesViewMode(ownerId);
  const [sort, setSort] = useState<NotesSort>(DEFAULT_NOTES_SORT);
  const [adding, setAdding] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const sortedRows = sortNotesDatabaseRows(rows, sort);

  useEffect(() => {
    if (adding) {
      inputRef.current?.focus();
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      addButtonRef.current?.focus();
    }
  }, [adding]);

  const startAdding = () => {
    if (adding) inputRef.current?.focus();
    else setAdding(true);
  };

  const cancelAdding = (restoreFocus: boolean) => {
    restoreFocusRef.current = restoreFocus;
    setAdding(false);
    setDraftTitle("");
  };

  const submitQuickNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 노트는 본문이 있어야 저장되므로 여기서는 만들지 않고 제목·오늘 날짜를 담아 작성 화면으로 보낸다.
    router.push(buildNoteCreateHref({
      pathname: composerPath,
      defaultTitle: draftTitle,
      defaultDate: toKstDateInputValue(),
      returnTo,
      returnFallback,
    }));
  };

  const handleQuickKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelAdding(true);
      return;
    }
    // 한글 조합을 확정하는 Enter는 제출로 보지 않는다.
    if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) {
      event.preventDefault();
    }
  };

  const viewButton = (mode: NotesViewMode, label: string, Icon: typeof List) => (
    <button
      type="button"
      aria-pressed={view === mode}
      onClick={() => setView(mode)}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-ui transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        view === mode ? "bg-muted font-medium text-foreground" : "text-secondary-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" strokeWidth={1.6} aria-hidden="true" />{label}
    </button>
  );

  const countLabel = query ? `전체 ${totalCount}개 중 ${rows.length}개` : `노트 ${totalCount}개`;

  return (
    <section aria-label="노트 데이터베이스" className="flex flex-col gap-1 md:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 md:border-b md:border-border md:pb-3">
        <div role="group" aria-label="보기" className="hidden items-center gap-1 md:flex">
          {viewButton("table", "표", Table2)}
          {viewButton("list", "목록", List)}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 max-md:w-full">
          <NoteSearch action={searchAction} query={query} />
          {/* 좁은 화면에서는 개수 줄 오른쪽에 같은 정렬을 둔다. */}
          <SortSelect id="notes-sort" sort={sort} onChange={setSort} className="hidden md:flex" />
        </div>
      </div>

      <div className="flex h-11 items-center justify-between gap-3 md:h-auto">
        <p className="text-ui text-muted-foreground md:text-xs">
          <span role="status">{countLabel}</span>{" "}
          <span id="note-search-scope" className="sr-only">전체 기간에서 띄어 쓴 단어를 모두 포함한 노트를 찾습니다.</span>
        </p>
        <SortSelect id="notes-sort-mobile" sort={sort} onChange={setSort} compact className="flex md:hidden" />
      </div>

      <div>
        {sortedRows.length === 0 ? (
          <NotesEmptyState message={emptyMessage} />
        ) : view === "table" ? (
          <>
            {/* 좁은 화면에서는 가로 스크롤 대신 같은 행을 목록으로 접는다. */}
            <div className="hidden md:block">
              <NotesTable rows={sortedRows} returnTo={returnTo} sort={sort} onSort={(key) => setSort((current) => toggleNotesSort(current, key))} now={now} />
            </div>
            <div className="md:hidden">
              <NoteRowList rows={sortedRows} returnTo={returnTo} now={now} />
            </div>
          </>
        ) : (
          <NoteRowList rows={sortedRows} returnTo={returnTo} now={now} />
        )}

        {adding ? (
          <form onSubmit={submitQuickNote} className="flex h-11 items-center gap-2 border-b border-muted md:px-2">
            <Plus className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={handleQuickKeyDown}
              onBlur={() => { if (!draftTitle.trim()) cancelAdding(false); }}
              maxLength={PRIVATE_NOTE_MAX_TITLE_LENGTH}
              aria-label="새 노트 제목"
              aria-describedby="quick-note-hint"
              placeholder="제목 입력 후 Enter"
              className="h-9 min-w-0 flex-1 rounded-sm bg-transparent text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none md:text-ui"
            />
            <span id="quick-note-hint" className="hidden shrink-0 text-xs text-muted-foreground md:inline">Enter로 작성 · Esc로 취소</span>
            <button type="submit" className="sr-only">작성 화면 열기</button>
          </form>
        ) : (
          <button
            ref={addButtonRef}
            type="button"
            onClick={startAdding}
            className="flex h-11 w-full items-center gap-2 rounded-sm text-left text-ui text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-md:text-body md:px-2"
          >
            <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />새 노트
          </button>
        )}
      </div>
    </section>
  );
}

/** "날짜 · 최신순" 정렬(Notes 보드 버튼 모양). 기본 select를 써서 키보드·좁은 화면 선택기를 그대로 쓴다. */
function SortSelect({ id, sort, onChange, compact = false, className }: {
  id: string;
  sort: NotesSort;
  onChange: (sort: NotesSort) => void;
  /** 좁은 화면: 선 없는 44px 버튼 모양. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative shrink-0 items-center", compact && "-mr-2", className)}>
      <label htmlFor={id} className="sr-only">정렬</label>
      <ArrowUpDown
        className={cn("pointer-events-none absolute size-3.5 text-secondary-foreground", compact ? "left-2" : "left-2.5")}
        strokeWidth={1.6}
        aria-hidden="true"
      />
      <select
        id={id}
        value={formatNotesSortValue(sort)}
        onChange={(event) => onChange(parseNotesSort(event.target.value) ?? DEFAULT_NOTES_SORT)}
        className={cn(
          "appearance-none bg-background text-ui text-secondary-foreground transition-colors field-sizing-content hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact
            ? "h-11 rounded-touch pl-[30px] pr-2"
            : "h-8 rounded-md border border-border pl-8 pr-2.5 hover:bg-muted",
        )}
      >
        {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}
