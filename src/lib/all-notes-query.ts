/**
 * 관리자 "전체 노트" 목록(개선 2차 시안 3번) 조회. 학생 범위·검색·페이지를 모두 SQL에서 처리한다.
 *
 * - 학생 범위: 고른 학생(서버가 활성 학생 목록과 대조한 id) 하나, 아니면 `role = 'student'` 서브쿼리.
 *   활성 학생 = 학생 role profile(계정 폐기는 hard-delete, accountStatus 컬럼은 아직 없음)이므로
 *   `listActiveStudentProfiles`와 같은 집합이다. id 목록을 bind하지 않아 학생 수와 무관하게 D1 bind 100개 안이다.
 * - 검색: 평문 컬럼이 없어 `title`·`content_html`(HTML 원문)에 단어마다 `LIKE '%단어%' ESCAPE '\'`를 AND로 건다.
 *   학생별 노트 검색처럼 NFKC·소문자로 정규화한 띄어 쓴 단어를 모두 포함해야 한다. SQLite LIKE는 ASCII만 대소문자를 무시한다.
 * - 페이지: 최근 수정순(updatedAt DESC, id DESC) keyset 커서. 본문은 미리보기용 앞부분과 검색 일치 주변만 substr로 읽는다.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { privateNotes, profiles } from "@/db/schema";
import { getDocumentSearchExcerpt, getDocumentSearchWords, getSearchableDocumentText } from "@/lib/document-search";
import { getPrivateNotePreview } from "@/lib/notes-database";
import { UNIFIED_NOTE_PREVIEW_SOURCE_CHARS } from "@/lib/unified-items-store";

/** 한 페이지 노트 수. */
export const ALL_NOTES_PAGE_SIZE = 50;
/** SQL에 거는 검색 단어 상한(단어당 bind 최대 3개 → D1 bind 100개 제한 안). */
export const ALL_NOTES_SEARCH_MAX_WORDS = 12;
/** 검색 일치 주변을 읽는 본문 길이(HTML 글자). 앞쪽 여유를 두고 읽어 평문 발췌를 만든다. */
const SEARCH_EXCERPT_SOURCE_BEFORE = 400;
const SEARCH_EXCERPT_SOURCE_CHARS = 1_600;
const CURSOR_ID_MAX_LENGTH = 200;

/** 실제 데이터로 가를 수 있는 노트 종류: 작성자가 Stann(관리자)인지 학생 본인인지. */
export type AllNoteKind = "STANN" | "STUDENT";

export const ALL_NOTE_KIND_LABELS: Record<AllNoteKind, string> = {
  STANN: "Stann 노트",
  STUDENT: "학생 노트",
};

/** 표에 필요한 필드만 담는다. 본문은 짧은 평문 미리보기(검색이면 일치 주변 발췌)로만 싣는다. */
export type AllNoteRow = {
  id: string;
  title: string;
  /** 짧은 평문 미리보기(검색이면 일치 주변 발췌). */
  preview: string;
  studentId: string;
  authorName: string | null;
  kind: AllNoteKind;
  noteDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AllNotesCursor = { updatedAt: Date; id: string };

export type AllNotesPage = {
  notes: AllNoteRow[];
  /** 다음 페이지 커서(없으면 마지막 페이지). */
  nextCursor: string | null;
};

export function encodeAllNotesCursor(cursor: AllNotesCursor): string {
  return Buffer.from(JSON.stringify([Math.floor(cursor.updatedAt.getTime() / 1_000), cursor.id]), "utf8").toString("base64url");
}

/** 모르는 값·깨진 값은 null(첫 페이지)로 돌린다. */
export function decodeAllNotesCursor(value: string | null | undefined): AllNotesCursor | null {
  if (!value || value.length > 400) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [seconds, id] = parsed;
    if (!Number.isSafeInteger(seconds) || typeof id !== "string" || !id || id.length > CURSOR_ID_MAX_LENGTH) return null;
    return { updatedAt: new Date(seconds * 1_000), id };
  } catch {
    return null;
  }
}

/** LIKE 패턴의 와일드카드(`%`, `_`)와 escape 문자(`\`)를 글자 그대로 찾게 한다. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

/** 편집기가 저장한 HTML에서 글자 `&`, `<`, `>`, `"`는 엔티티로 바뀌므로 본문은 그 형태로도 찾는다. */
function escapeHtmlText(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function like(column: SQL | typeof privateNotes.title | typeof privateNotes.contentHtml, word: string): SQL {
  return sql`${column} LIKE ${`%${escapeLikePattern(word)}%`} ESCAPE '\\'`;
}

/** 검색어를 SQL에 걸 단어로 줄인다(정규화·중복 제거·상한). */
export function getAllNotesSearchWords(query: string): string[] {
  return [...new Set(getDocumentSearchWords(query))].slice(0, ALL_NOTES_SEARCH_MAX_WORDS);
}

function searchCondition(words: readonly string[]): SQL | undefined {
  if (words.length === 0) return undefined;
  return and(...words.map((word) => {
    const htmlWord = escapeHtmlText(word);
    return or(
      like(privateNotes.title, word),
      like(privateNotes.contentHtml, word),
      ...(htmlWord === word ? [] : [like(privateNotes.contentHtml, htmlWord)]),
    );
  }));
}

/** 일치 주변을 중간부터 읽으면 앞쪽에 잘린 태그 꼬리(`ss="x">`)가 남으니 버린다. 본문 글자의 `>`는 `&gt;`로 저장된다. */
function dropPartialLeadingTag(source: string): string {
  return source.startsWith("<") ? source : source.replace(/^[^<>]*>/u, "");
}

export async function queryAllStudentNotesPage(
  db: DrizzleDb,
  options: {
    /** 서버가 활성 학생 목록과 대조한 학생 id. null이면 활성 학생 전체. */
    studentId: string | null;
    query?: string;
    cursor?: AllNotesCursor | null;
    pageSize?: number;
  },
): Promise<AllNotesPage> {
  const pageSize = options.pageSize ?? ALL_NOTES_PAGE_SIZE;
  const words = getAllNotesSearchWords(options.query ?? "");
  const cursor = options.cursor ?? null;
  const firstWord = words[0];
  // 검색이면 첫 단어가 처음 나오는 곳 앞뒤를, 아니면 미리보기용 앞부분만 읽는다(lower는 ASCII만 접는다).
  const bodySource = firstWord
    ? sql<string>`substr(${privateNotes.contentHtml}, max(1, instr(lower(${privateNotes.contentHtml}), ${firstWord}) - ${SEARCH_EXCERPT_SOURCE_BEFORE}), ${SEARCH_EXCERPT_SOURCE_CHARS})`
    : sql<string>`substr(${privateNotes.contentHtml}, 1, ${UNIFIED_NOTE_PREVIEW_SOURCE_CHARS})`;

  const rows = await db
    .select({
      id: privateNotes.id,
      title: privateNotes.title,
      bodySource,
      studentId: privateNotes.studentId,
      authorId: privateNotes.authorId,
      authorName: profiles.displayName,
      authorRole: profiles.role,
      noteDate: privateNotes.noteDate,
      createdAt: privateNotes.createdAt,
      updatedAt: privateNotes.updatedAt,
    })
    .from(privateNotes)
    .leftJoin(profiles, eq(profiles.id, privateNotes.authorId))
    .where(and(
      options.studentId
        ? eq(privateNotes.studentId, options.studentId)
        : inArray(privateNotes.studentId, db.select({ id: profiles.id }).from(profiles).where(eq(profiles.role, "student"))),
      isNull(privateNotes.deletedAt),
      searchCondition(words),
      cursor
        ? or(
          lt(privateNotes.updatedAt, cursor.updatedAt),
          and(eq(privateNotes.updatedAt, cursor.updatedAt), lt(privateNotes.id, cursor.id)),
        )
        : undefined,
    ))
    .orderBy(desc(privateNotes.updatedAt), desc(privateNotes.id))
    .limit(pageSize + 1);

  const page = rows.slice(0, pageSize);
  const notes = page.map(({ authorRole, authorId, bodySource, ...row }): AllNoteRow => ({
    ...row,
    preview: words.length
      ? getDocumentSearchExcerpt(getSearchableDocumentText(dropPartialLeadingTag(bodySource ?? "")), words) ?? getPrivateNotePreview(bodySource ?? "")
      : getPrivateNotePreview(bodySource ?? ""),
    // 작성자가 학생 본인이면 학생 노트, 관리자(또는 지워진 작성자)는 Stann 노트로 본다.
    kind: authorRole === "student" && authorId === row.studentId ? "STUDENT" : "STANN",
  }));
  const last = page.at(-1);
  return {
    notes,
    nextCursor: rows.length > pageSize && last ? encodeAllNotesCursor({ updatedAt: last.updatedAt, id: last.id }) : null,
  };
}
