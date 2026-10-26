"use client";

/**
 * Notion database처럼 노트를 표·목록으로 보고, 열 머리로 정렬하고, 맨 아래 행에서 제목만 적어 바로 작성을 시작한다.
 * 데이터 소유권은 서버 page가 이미 검증한 행만 받는 것으로 유지하며, 이 component는 서버에 쓰지 않는다.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Calendar, Clock3, FileText, List, Plus, Table2, User } from "lucide-react";
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
import { NoteSearch } from "./NoteSearch";
import { buildPrivateNoteHref, NoteRowList, NotesEmptyState } from "./PrivateNoteList";

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

const COLUMN_ICONS = { title: FileText, date: Calendar, updated: Clock3, author: User } as const;

function SortableHeader({ column, sort, onSort, className }: {
  column: NotesSortKey;
  sort: NotesSort;
  onSort: (key: NotesSortKey) => void;
  className?: string;
}) {
  const Icon = COLUMN_ICONS[column];
  const state = getNotesSortAria(sort, column);
  const DirectionIcon = state === "ascending" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={state} className={`h-9 px-2 text-left text-xs font-normal text-muted-foreground ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{NOTES_SORT_LABELS[column]}</span>
        {state !== "none" && <DirectionIcon className="size-3 shrink-0 text-foreground" aria-hidden="true" />}
      </button>
    </th>
  );
}

function NotesTable({ rows, returnTo, sort, onSort }: {
  rows: NotesDatabaseRow[];
  returnTo: string;
  sort: NotesSort;
  onSort: (key: NotesSortKey) => void;
}) {
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">노트 표. 열 머리를 눌러 정렬합니다.</caption>
      <thead className="border-b border-border">
        <tr>
          <SortableHeader column="title" sort={sort} onSort={onSort} />
          <SortableHeader column="date" sort={sort} onSort={onSort} className="w-36" />
          <SortableHeader column="updated" sort={sort} onSort={onSort} className="hidden w-48 md:table-cell" />
          <SortableHeader column="author" sort={sort} onSort={onSort} className="w-28" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          // 행 전체를 덮는 제목 링크 하나로 연다(행마다 링크는 하나).
          <tr key={row.id} className="relative border-b border-border transition-colors last:border-b-0 hover:bg-muted/60">
            <td className="h-10 px-3">
              <Link
                href={buildPrivateNoteHref(row.id, returnTo)}
                className="flex min-w-0 items-center gap-2 after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 truncate font-medium text-foreground">{row.title}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{row.preview}</span>
              </Link>
            </td>
            <td className="h-10 truncate px-3 text-xs text-muted-foreground">{row.dateLabel}</td>
            <td className="hidden h-10 truncate px-3 text-xs text-muted-foreground md:table-cell">{row.updatedLabel}</td>
            <td className="h-10 truncate px-3 text-xs text-muted-foreground">{row.authorName ?? "—"}</td>
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
}) {
  const router = useRouter();
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
      className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === mode ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
    >
      <Icon className="size-3.5" aria-hidden="true" />{label}
    </button>
  );

  return (
    <section aria-label="노트 데이터베이스" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <div role="group" aria-label="보기" className="flex items-center gap-0.5">
          {viewButton("table", "표", Table2)}
          {viewButton("list", "목록", List)}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <NoteSearch action={searchAction} query={query} />
          <label htmlFor="notes-sort" className="sr-only">정렬</label>
          <select
            id="notes-sort"
            value={formatNotesSortValue(sort)}
            onChange={(event) => setSort(parseNotesSort(event.target.value) ?? DEFAULT_NOTES_SORT)}
            className="h-8 shrink-0 rounded-md border border-border bg-surface px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button
            type="button"
            onClick={startAdding}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="size-3.5" aria-hidden="true" />새 노트
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        <span role="status">{query ? `전체 ${totalCount}개 중 ${rows.length}개` : `전체 ${totalCount}개`}</span>
        <span id="note-search-scope"> · 전체 기간에서 띄어 쓴 단어를 모두 포함한 노트를 찾습니다.</span>
      </p>

      <div className="overflow-hidden rounded-md border border-border bg-surface">
        {sortedRows.length === 0 ? (
          <NotesEmptyState message={emptyMessage} />
        ) : view === "table" ? (
          <>
            {/* 좁은 화면에서는 가로 스크롤 대신 같은 행을 목록으로 접는다. */}
            <div className="hidden sm:block">
              <NotesTable rows={sortedRows} returnTo={returnTo} sort={sort} onSort={(key) => setSort((current) => toggleNotesSort(current, key))} />
            </div>
            <div className="sm:hidden">
              <NoteRowList rows={sortedRows} returnTo={returnTo} />
            </div>
          </>
        ) : (
          <NoteRowList rows={sortedRows} returnTo={returnTo} />
        )}

        <div className="border-t border-border">
          {adding ? (
            <form onSubmit={submitQuickNote} className="flex h-10 items-center gap-2 px-3 sm:px-4">
              <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
              />
              <span id="quick-note-hint" className="hidden shrink-0 text-xs text-muted-foreground sm:inline">Enter로 작성 · Esc로 취소</span>
              <button type="submit" className="sr-only">작성 화면 열기</button>
            </form>
          ) : (
            <button
              ref={addButtonRef}
              type="button"
              onClick={startAdding}
              className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
            >
              <Plus className="size-4" aria-hidden="true" />새 노트
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
