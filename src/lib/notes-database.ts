/**
 * 노트 목록 database 보기(표·목록)의 순수 규칙.
 * 서버에서 본문 HTML을 짧은 평문 미리보기와 KST 표시 문자열로 줄여 client로 보내고,
 * client는 이미 불러온 행만 정렬한다(검색은 서버 `?q=`가 맡는다).
 */
import { createFormDraftRecoveryPreview } from "@/lib/form-draft/recovery-preview";
import { formatKst } from "@/lib/kst-format";

export type NotesViewMode = "table" | "list";
export const DEFAULT_NOTES_VIEW_MODE: NotesViewMode = "table";

export type NotesSortKey = "title" | "date" | "updated" | "author";
export type NotesSortDirection = "asc" | "desc";
export type NotesSort = { key: NotesSortKey; direction: NotesSortDirection };
export const DEFAULT_NOTES_SORT: NotesSort = { key: "date", direction: "desc" };

export const NOTES_SORT_LABELS: Record<NotesSortKey, string> = {
  title: "제목",
  date: "날짜",
  updated: "수정일",
  author: "작성자",
};

export type NotesDatabaseSource = {
  id: string;
  title: string;
  contentHtml: string;
  noteDate: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  authorName: string | null;
  searchPreview?: string;
};

/** client로 보내는 가벼운 행. 본문 HTML은 포함하지 않는다. */
export type NotesDatabaseRow = {
  id: string;
  title: string;
  preview: string;
  authorName: string | null;
  /** 정렬용 epoch ms. 값이 없으면 null. */
  dateValue: number | null;
  updatedValue: number | null;
  /** 서버에서 KST로 만든 표시 문자열(hydration 중 Intl 차이를 피한다). */
  dateLabel: string;
  updatedLabel: string;
};

const DATE_LABEL_OPTIONS: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
const UPDATED_LABEL_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/** 노트 HTML은 목록에서 렌더하지 않고 안전한 짧은 평문 preview로만 표시한다. */
export function getPrivateNotePreview(contentHtml: string): string {
  return createFormDraftRecoveryPreview({ contentHtml }).body ?? "본문 미리보기 없음";
}

function toEpoch(value: Date | null): number | null {
  if (!value) return null;
  const time = value.getTime();
  return Number.isFinite(time) ? time : null;
}

export function toNotesDatabaseRow(note: NotesDatabaseSource): NotesDatabaseRow {
  const date = note.noteDate ?? note.createdAt;
  return {
    id: note.id,
    title: note.title,
    preview: note.searchPreview ?? getPrivateNotePreview(note.contentHtml),
    authorName: note.authorName,
    dateValue: toEpoch(date),
    updatedValue: toEpoch(note.updatedAt),
    dateLabel: formatKst(date, DATE_LABEL_OPTIONS, "날짜 없음"),
    updatedLabel: formatKst(note.updatedAt, UPDATED_LABEL_OPTIONS, "—"),
  };
}

export function toNotesDatabaseRows(notes: NotesDatabaseSource[]): NotesDatabaseRow[] {
  return notes.map(toNotesDatabaseRow);
}

export function resolveNotesViewMode(value: unknown): NotesViewMode | null {
  return value === "table" || value === "list" ? value : null;
}

/** 날짜 열은 최신이 먼저, 글자 열은 가나다순이 먼저 오는 방향으로 시작한다. */
export function getInitialNotesSortDirection(key: NotesSortKey): NotesSortDirection {
  return key === "date" || key === "updated" ? "desc" : "asc";
}

/** 같은 열을 다시 누르면 방향을 뒤집고, 다른 열은 그 열의 기본 방향으로 시작한다. */
export function toggleNotesSort(current: NotesSort, key: NotesSortKey): NotesSort {
  if (current.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { key, direction: getInitialNotesSortDirection(key) };
}

export function parseNotesSort(value: string): NotesSort | null {
  const [key, direction] = value.split(":");
  if (!Object.hasOwn(NOTES_SORT_LABELS, key) || (direction !== "asc" && direction !== "desc")) return null;
  return { key: key as NotesSortKey, direction };
}

export function formatNotesSortValue(sort: NotesSort): string {
  return `${sort.key}:${sort.direction}`;
}

const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });

function compareNullableNumber(a: number | null, b: number | null, direction: number): number {
  if (a === b) return 0;
  // 값이 없는 행은 방향과 무관하게 끝에 둔다.
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

function compareNullableText(a: string | null, b: string | null, direction: number): number {
  const left = a?.trim() ?? "";
  const right = b?.trim() ?? "";
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return collator.compare(left, right) * direction;
}

/** 원본 배열을 바꾸지 않고 정렬한다. 같은 값은 수정일 최신, id 순으로 고정해 렌더마다 순서가 흔들리지 않는다. */
export function sortNotesDatabaseRows(rows: NotesDatabaseRow[], sort: NotesSort): NotesDatabaseRow[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let result = 0;
    if (sort.key === "date") result = compareNullableNumber(a.dateValue, b.dateValue, direction);
    else if (sort.key === "updated") result = compareNullableNumber(a.updatedValue, b.updatedValue, direction);
    else if (sort.key === "title") result = compareNullableText(a.title, b.title, direction);
    else result = compareNullableText(a.authorName, b.authorName, direction);
    if (result !== 0) return result;
    const updated = compareNullableNumber(a.updatedValue, b.updatedValue, -1);
    if (updated !== 0) return updated;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function getNotesSortAria(sort: NotesSort, key: NotesSortKey): "ascending" | "descending" | "none" {
  if (sort.key !== key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}
