/**
 * @file src/lib/actions/digging.ts
 * @description 디깅 게시판 CRUD + 링크 메타 추출 서버 액션 (Phase 5).
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb, createDbContext } from "@/db/client";
import { diggingColumns, diggingTracks } from "@/db/schema";
import type { DiggingColumnType } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth, requireStudentOwnerOrAdmin } from "@/lib/auth-guard";
import { executeDocumentStatementsAtomically } from "@/lib/document-lifecycle-atomic";
import {
  DIGGING_COLUMNS_MAX_COUNT,
  DIGGING_TEXT_MAX_LENGTH,
  DIGGING_TRACK_VALUES_MAX_BYTES,
  parseDiggingColumnInput,
  parseDiggingColumnValue,
  parseDiggingTrackInput,
} from "@/lib/digging-contract";
import {
  DIGGING_IMPORT_MAX_TRACKS,
  diggingBoardImportKeys,
  diggingImportKey,
  findDiggingImportColumns,
  normalizeDiggingImportLink,
  type DiggingImportCandidate,
} from "@/lib/digging-import";
import {
  fetchDiggingLinkMetadata,
  type DiggingLinkMetadata,
} from "@/lib/digging-link-metadata";

// ─── 기본 컬럼 정의 ───────────────────────────────
const DEFAULT_COLUMNS: {
  name: string;
  columnType: DiggingColumnType;
  options?: string;
  sortOrder: number;
}[] = [
  { name: "트랙명", columnType: "text", sortOrder: 0 },
  { name: "아티스트", columnType: "text", sortOrder: 1 },
  { name: "감상평", columnType: "textarea", sortOrder: 2 },
  { name: "선호도", columnType: "select", options: JSON.stringify(["좋음", "보통", "별로"]), sortOrder: 3 },
  { name: "별점", columnType: "rating", sortOrder: 4 },
  { name: "링크", columnType: "link", sortOrder: 5 },
];

// ─── 컬럼 ─────────────────────────────────────────

/**
 * 유저의 컬럼 목록 조회. 없으면 기본 컬럼 시드.
 */
export async function getOrSeedColumns(userId: string) {
  const session = await assertCanAccessDiggingUser(userId);

  const db = createDb();
  const existing = await db
    .select()
    .from(diggingColumns)
    .where(eq(diggingColumns.userId, userId))
    .orderBy(diggingColumns.sortOrder);

  if (existing.length > 0) return existing;
  if (session.user.role === "admin") return existing;

  // 기본 컬럼 시드. 두 요청이 동시에 "열 없음"을 봐도 한 벌만 생기게, 열이 없을 때만 넣는 한 문장으로 쓴다.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const seedRows = DEFAULT_COLUMNS.map(
    (col) => sql`(${crypto.randomUUID()}, ${userId}, ${col.name}, ${col.columnType}, ${col.options ?? null}, ${col.sortOrder}, 1, ${nowSeconds})`,
  );
  await db.run(sql`
    INSERT INTO digging_columns (id, user_id, name, column_type, options, sort_order, is_default, created_at)
    SELECT * FROM (VALUES ${sql.join(seedRows, sql`, `)})
    WHERE NOT EXISTS (SELECT 1 FROM digging_columns WHERE user_id = ${userId})`);
  return db
    .select()
    .from(diggingColumns)
    .where(eq(diggingColumns.userId, userId))
    .orderBy(diggingColumns.sortOrder);
}

/**
 * 커스텀 컬럼 추가.
 */
export async function addDiggingColumn(data: {
  name: string;
  columnType: DiggingColumnType;
  options?: string[];
}) {
  const session = await requireAuth();
  assertStudentSession(session.user.role);
  const parsed = parseDiggingColumnInput(data);
  if (!parsed.ok) throw new Error(parsed.error);
  const db = createDb();

  const userId = session.user.id!;
  const options = parsed.value.options ? JSON.stringify(parsed.value.options) : null;
  // 개수 확인과 순서 계산을 INSERT 한 문장에 둔다. 따로 읽으면 동시에 추가한 두 요청이 같은 개수·같은 순서를 보고
  // 상한을 넘기거나 같은 sort_order를 받는다. 표 이름을 직접 쓴 SQL이라 안쪽 조회의 열이 바깥 표와 섞이지 않는다.
  const inserted = await db.all<{ id: string }>(sql`
    INSERT INTO digging_columns (id, user_id, name, column_type, options, sort_order, is_default)
    SELECT ${crypto.randomUUID()}, ${userId}, ${parsed.value.name}, ${parsed.value.columnType}, ${options},
      (SELECT coalesce(max(sort_order), -1) + 1 FROM digging_columns WHERE user_id = ${userId}), 0
    WHERE (SELECT count(*) FROM digging_columns WHERE user_id = ${userId}) < ${DIGGING_COLUMNS_MAX_COUNT}
    RETURNING id`);
  if (inserted.length === 0) {
    throw new Error(`컬럼은 최대 ${DIGGING_COLUMNS_MAX_COUNT}개까지 만들 수 있습니다.`);
  }

  revalidatePath("/dashboard/student/digging");
  revalidatePath("/dashboard/student");
}

/**
 * 컬럼 이름(선택형이면 선택지도) 고치기. 학생 본인의 컬럼만, 유형은 바꾸지 않는다(트랙 값의 뜻이 바뀌지 않게).
 * 기본 컬럼도 이름은 고칠 수 있다. 선택지를 바꿔도 이미 고른 트랙 값은 그대로 남는다.
 */
export async function updateDiggingColumn(columnId: string, data: { name: string; options?: string[] }) {
  const session = await requireAuth();
  assertStudentSession(session.user.role);
  const userId = session.user.id!;
  if (typeof columnId !== "string" || !columnId) throw new Error("컬럼을 찾을 수 없습니다.");
  const db = createDb();
  const [current] = await db
    .select({ columnType: diggingColumns.columnType })
    .from(diggingColumns)
    .where(and(eq(diggingColumns.id, columnId), eq(diggingColumns.userId, userId)))
    .limit(1);
  if (!current) throw new Error("컬럼을 찾을 수 없습니다.");
  const parsed = parseDiggingColumnInput({ name: data?.name, columnType: current.columnType, options: data?.options });
  if (!parsed.ok) throw new Error(parsed.error);
  await db
    .update(diggingColumns)
    .set({
      name: parsed.value.name,
      options: parsed.value.options ? JSON.stringify(parsed.value.options) : null,
    })
    .where(and(eq(diggingColumns.id, columnId), eq(diggingColumns.userId, userId), eq(diggingColumns.columnType, current.columnType)));
  revalidatePath("/dashboard/student/digging");
  revalidatePath("/dashboard/student");
}

/**
 * 컬럼 순서 바꾸기: 한 칸 위(앞)·아래(뒤)로. 학생 본인의 컬럼 전체를 0부터 다시 매겨 한 batch로 쓴다.
 * 예전 행에 같은 sort_order가 있어도 이번에 정리된다.
 */
export async function moveDiggingColumn(columnId: string, direction: "up" | "down") {
  const session = await requireAuth();
  assertStudentSession(session.user.role);
  const userId = session.user.id!;
  if (direction !== "up" && direction !== "down") throw new Error("순서를 바꾸지 못했습니다.");
  const db = createDb();
  const columns = await db
    .select({ id: diggingColumns.id })
    .from(diggingColumns)
    .where(eq(diggingColumns.userId, userId))
    .orderBy(diggingColumns.sortOrder, diggingColumns.createdAt, diggingColumns.id);
  const index = columns.findIndex((column) => column.id === columnId);
  if (index < 0) throw new Error("컬럼을 찾을 수 없습니다.");
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= columns.length) return;
  const ordered = [...columns];
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  await executeDocumentStatementsAtomically(
    createDbContext(),
    ordered.map((column, sortOrder) => ({
      query: "UPDATE digging_columns SET sort_order = ? WHERE id = ? AND user_id = ?",
      params: [sortOrder, column.id, userId],
    })),
  );
  revalidatePath("/dashboard/student/digging");
  revalidatePath("/dashboard/student");
}

/**
 * 커스텀 컬럼 삭제 (isDefault=false만 허용). 트랙에 남은 그 컬럼의 값도 함께 지운다.
 */
export async function deleteDiggingColumn(columnId: string) {
  const session = await requireAuth();
  assertStudentSession(session.user.role);
  const userId = session.user.id!;

  // 트랙 값의 key는 컬럼 id다. 지운 컬럼의 값은 다시 표시할 수 없는데, 남겨 두면 보이지 않는 채로 트랙 입력 크기
  // 상한(`DIGGING_TRACK_VALUES_MAX_BYTES`)을 차지해 다른 칸 저장을 막는다. 지울 수 있는 내 컬럼일 때만 그 key를 빼고,
  // 컬럼 삭제와 한 batch로 함께 되거나 함께 되지 않는다. CASE는 JSON이 깨진 행과 없는 컬럼 id에서 json 함수를 부르지 않게 한다.
  await executeDocumentStatementsAtomically(createDbContext(), [
    {
      query: `UPDATE digging_tracks SET "values" = json_remove("values", '$."' || ? || '"')
        WHERE user_id = ?
          AND CASE
            WHEN json_valid("values")
              AND EXISTS (SELECT 1 FROM digging_columns WHERE id = ? AND user_id = ? AND is_default = 0)
            THEN json_type("values", '$."' || ? || '"')
          END IS NOT NULL`,
      params: [columnId, userId, columnId, userId, columnId],
    },
    {
      query: "DELETE FROM digging_columns WHERE id = ? AND user_id = ? AND is_default = 0",
      params: [columnId, userId],
    },
  ]);

  revalidatePath("/dashboard/student/digging");
  revalidatePath("/dashboard/student");
}

// ─── 트랙 ─────────────────────────────────────────

/**
 * 유저의 모든 트랙 조회 (최신순).
 */
export async function getDiggingTracks(userId: string) {
  await assertCanAccessDiggingUser(userId);

  const db = createDb();
  const rows = await db
    .select()
    .from(diggingTracks)
    .where(eq(diggingTracks.userId, userId))
    .orderBy(diggingTracks.createdAt);

  return rows.map((r: typeof rows[number]) => ({
    ...r,
    values: (() => {
      try { return JSON.parse(r.values ?? "{}") as Record<string, unknown>; }
      catch { return {} as Record<string, unknown>; }
    })(),
  }));
}

/**
 * 트랙 추가.
 * @returns 생성된 트랙의 id, createdAt (낙관적 업데이트용)
 */
export async function createDiggingTrack(data: {
  linkUrl?: string;
  values: Record<string, unknown>;
}): Promise<{
  id: string;
  createdAt: Date;
  linkUrl: string | null;
  values: Record<string, unknown>;
}> {
  const session = await requireAuth();
  assertStudentSession(session.user.role);
  const db = createDb();

  const columns = await db
    .select({
      id: diggingColumns.id,
      userId: diggingColumns.userId,
      columnType: diggingColumns.columnType,
      options: diggingColumns.options,
    })
    .from(diggingColumns)
    .where(eq(diggingColumns.userId, session.user.id!));
  const parsed = parseDiggingTrackInput(data, columns);
  if (!parsed.ok) throw new Error(parsed.error);

  const id = crypto.randomUUID();
  const createdAt = new Date();

  await db.insert(diggingTracks).values({
    id,
    userId: session.user.id!,
    linkUrl: parsed.value.linkUrl,
    values: JSON.stringify(parsed.value.values),
  });

  revalidatePath("/dashboard/student/digging");
  revalidatePath("/dashboard/student");

  return {
    id,
    createdAt,
    linkUrl: parsed.value.linkUrl,
    values: parsed.value.values,
  };
}

/** D1은 문장 하나에 bind 값을 100개까지 받는다. 행마다 4개(id·user_id·link_url·values)를 쓴다. */
const IMPORT_ROWS_PER_STATEMENT = 25;

export type ImportDiggingTracksResult =
  | {
      ok: true;
      created: { id: string; createdAt: Date; linkUrl: string | null; values: Record<string, unknown> }[];
      /** 보드에 이미 있거나 같은 목록 안에서 겹쳐 건너뛴 곡 수. */
      skipped: number;
    }
  | { ok: false; error: string };

/**
 * 플레이리스트에서 고른 곡을 학생 본인 보드에 한 번에 넣는다(2026-11-21 사용자 결정, 트랙 보드는 학생 본인만).
 * 트랙명·아티스트·링크 칸에만 값을 넣고, 보드에 있는 곡(링크, 링크가 없으면 트랙명·아티스트)은 건너뛴다.
 * 잘못된 링크가 하나라도 있으면 아무것도 넣지 않는다. 모든 행은 한 batch로 함께 들어가거나 함께 실패한다.
 */
export async function importDiggingTracks(items: DiggingImportCandidate[]): Promise<ImportDiggingTracksResult> {
  const session = await requireAuth();
  assertStudentSession(session.user.role);
  const userId = session.user.id!;
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "가져올 곡을 골라 주세요." };
  if (items.length > DIGGING_IMPORT_MAX_TRACKS) {
    return { ok: false, error: `한 번에 ${DIGGING_IMPORT_MAX_TRACKS}곡까지 가져올 수 있습니다.` };
  }

  const db = createDb();
  const columns = await db
    .select({
      id: diggingColumns.id,
      userId: diggingColumns.userId,
      name: diggingColumns.name,
      columnType: diggingColumns.columnType,
      options: diggingColumns.options,
    })
    .from(diggingColumns)
    .where(eq(diggingColumns.userId, userId));
  const ids = findDiggingImportColumns(columns);
  if (!ids.titleId && !ids.artistId) {
    return { ok: false, error: "트랙명·아티스트 칸이 없어 가져올 수 없습니다. 칸 관리에서 글자 칸을 더해 주세요." };
  }

  const existing = await db
    .select({ linkUrl: diggingTracks.linkUrl, values: diggingTracks.values })
    .from(diggingTracks)
    .where(eq(diggingTracks.userId, userId));
  const seen = diggingBoardImportKeys(
    existing.map((row: (typeof existing)[number]) => ({
      linkUrl: row.linkUrl,
      values: (() => {
        try { return JSON.parse(row.values ?? "{}") as Record<string, unknown>; }
        catch { return {}; }
      })(),
    })),
    ids,
  );

  const rows: { id: string; linkUrl: string | null; values: Record<string, unknown> }[] = [];
  let skipped = 0;
  for (const item of items) {
    const title = typeof item?.title === "string" ? item.title.replace(/\s+/gu, " ").trim().slice(0, DIGGING_TEXT_MAX_LENGTH) : "";
    const artist = typeof item?.artist === "string" ? item.artist.replace(/\s+/gu, " ").trim().slice(0, DIGGING_TEXT_MAX_LENGTH) : "";
    const rawLink = item?.linkUrl;
    const linkUrl = rawLink === null || rawLink === undefined || rawLink === "" ? null : normalizeDiggingImportLink(rawLink);
    if (rawLink && !linkUrl) return { ok: false, error: "지원하는 HTTPS 음악 링크를 입력해 주세요." };
    if (!title && !artist && !linkUrl) continue;

    const values: Record<string, unknown> = {};
    if (ids.titleId && title) values[ids.titleId] = title;
    if (ids.artistId && artist) values[ids.artistId] = artist;
    if (ids.linkId && linkUrl) values[ids.linkId] = linkUrl;
    const parsed = parseDiggingTrackInput({ linkUrl: linkUrl ?? undefined, values }, columns);
    if (!parsed.ok) return parsed;

    const key = diggingImportKey({ title, artist, linkUrl });
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    // 링크 key와 함께 이름 key도 넣어, 뒤따르는 링크 없는 같은 곡을 건너뛴다(보드 key와 같은 규칙).
    for (const added of diggingBoardImportKeys([{ linkUrl, values }], ids)) seen.add(added);
    seen.add(key);
    rows.push({ id: crypto.randomUUID(), linkUrl: parsed.value.linkUrl, values: parsed.value.values });
  }
  if (rows.length === 0 && skipped === 0) return { ok: false, error: "가져올 곡을 골라 주세요." };

  if (rows.length > 0) {
    const statements = [];
    for (let start = 0; start < rows.length; start += IMPORT_ROWS_PER_STATEMENT) {
      const chunk = rows.slice(start, start + IMPORT_ROWS_PER_STATEMENT);
      statements.push({
        query: `INSERT INTO digging_tracks (id, user_id, link_url, "values") VALUES ${chunk.map(() => "(?, ?, ?, ?)").join(", ")}`,
        params: chunk.flatMap((row) => [row.id, userId, row.linkUrl, JSON.stringify(row.values)]),
      });
    }
    await executeDocumentStatementsAtomically(createDbContext(), statements);
    revalidatePath("/dashboard/student/digging");
    revalidatePath("/dashboard/student");
  }

  const createdAt = new Date();
  return { ok: true, created: rows.map((row) => ({ ...row, createdAt })), skipped };
}

/** 칸 저장이 다른 저장과 겹쳤을 때 다시 읽어 시도하는 횟수. */
const TRACK_VALUE_WRITE_ATTEMPTS = 4;

/**
 * 트랙 단일 셀 값 업데이트 (인라인 편집).
 */
export async function updateDiggingTrackValue(
  trackId: string,
  columnId: string,
  value: unknown,
) {
  const session = await requireAuth();
  assertStudentSession(session.user.role);
  const db = createDb();

  const readTrackValues = () =>
    db
      .select({ values: diggingTracks.values })
      .from(diggingTracks)
      .where(
        and(
          eq(diggingTracks.id, trackId),
          eq(diggingTracks.userId, session.user.id!),
        ),
      )
      .limit(1);
  const readColumnId = () =>
    db
      .select({ id: diggingColumns.id })
      .from(diggingColumns)
      .where(and(eq(diggingColumns.id, columnId), eq(diggingColumns.userId, session.user.id!)))
      .limit(1);
  const [[firstRead], [column]] = await Promise.all([
    readTrackValues(),
    db
      .select({
        id: diggingColumns.id,
        userId: diggingColumns.userId,
        columnType: diggingColumns.columnType,
        options: diggingColumns.options,
      })
      .from(diggingColumns)
      .where(
        and(
          eq(diggingColumns.id, columnId),
          eq(diggingColumns.userId, session.user.id!),
        ),
      )
      .limit(1),
  ]);

  if (!firstRead || !column) {
    throw new Error("트랙 또는 컬럼을 찾을 수 없습니다.");
  }
  const parsedValue = parseDiggingColumnValue(column, value);
  if (!parsedValue.ok) throw new Error(parsedValue.error);

  // 칸 값은 트랙의 JSON 한 덩어리에 들어 있다. 읽은 값이 그대로일 때만 쓰고, 그 사이 다른 탭·기기가
  // 같은 트랙의 다른 칸을 고쳤으면 다시 읽어 그 위에 이 칸만 바꾼다(통째로 덮어써 남의 칸을 지우지 않는다).
  let track: { values: string } | undefined = firstRead;
  for (let attempt = 0; attempt < TRACK_VALUE_WRITE_ATTEMPTS; attempt += 1) {
    if (!track) throw new Error("트랙 또는 컬럼을 찾을 수 없습니다.");
    const readValues = track.values;
    const currentValues = (() => {
      try { return JSON.parse(readValues ?? "{}") as Record<string, unknown>; }
      catch { return {} as Record<string, unknown>; }
    })();
    currentValues[columnId] = parsedValue.value;
    const serialized = JSON.stringify(currentValues);
    if (new TextEncoder().encode(serialized).byteLength > DIGGING_TRACK_VALUES_MAX_BYTES) {
      throw new Error("트랙 입력값이 저장 가능한 크기를 넘었습니다.");
    }

    const written = await db
      .update(diggingTracks)
      .set({ values: serialized })
      .where(
        and(
          eq(diggingTracks.id, trackId),
          eq(diggingTracks.userId, session.user.id!),
          eq(diggingTracks.values, readValues),
          // 쓰는 순간에도 그 컬럼이 내 것으로 남아 있을 때만 쓴다. 컬럼 삭제는 그 값을 함께 지우므로, 읽은 뒤 다른 탭이
          // 지운 컬럼의 값을 여기서 되살리지 않는다.
          sql`EXISTS (SELECT 1 FROM digging_columns c WHERE c.id = ${columnId} AND c.user_id = ${session.user.id!})`,
        ),
      )
      .returning({ id: diggingTracks.id });
    if (written.length > 0) return;
    const [[nextTrack], [columnLeft]] = await Promise.all([readTrackValues(), readColumnId()]);
    if (!columnLeft) throw new Error("트랙 또는 컬럼을 찾을 수 없습니다.");
    track = nextTrack;
  }
  throw new Error("다른 곳에서 이 트랙을 함께 고치고 있어 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
}

/**
 * 트랙 삭제.
 */
export type DeletedDiggingTrack = {
  id: string;
  linkUrl: string | null;
  values: Record<string, unknown>;
  createdAt: Date | null;
};

/**
 * 트랙을 지우고 지운 행을 돌려준다(화면이 잠깐 "되돌리기"를 보여 주고 `restoreDiggingTrack`에 다시 넘긴다).
 * 삭제는 바로 일어난다(화면을 떠나도 삭제가 유실되지 않게). 없거나 남의 트랙이면 null.
 */
export async function deleteDiggingTrack(trackId: string): Promise<DeletedDiggingTrack | null> {
  const session = await requireAuth();
  assertStudentSession(session.user.role);
  const db = createDb();

  const [deleted] = await db
    .delete(diggingTracks)
    .where(
      and(
        eq(diggingTracks.id, trackId),
        eq(diggingTracks.userId, session.user.id!),
      ),
    )
    .returning({
      id: diggingTracks.id,
      linkUrl: diggingTracks.linkUrl,
      values: diggingTracks.values,
      createdAt: diggingTracks.createdAt,
    });

  revalidatePath("/dashboard/student/digging");
  revalidatePath("/dashboard/student");
  if (!deleted) return null;
  return { id: deleted.id, linkUrl: deleted.linkUrl, values: parseStoredTrackValues(deleted.values), createdAt: deleted.createdAt };
}

const TRACK_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * 방금 지운 트랙을 같은 id·만든 시각으로 되돌린다(학생 본인만, 트랙 보드는 학생 본인만이라는 규칙 그대로).
 * 값은 새로 넣을 때와 같은 검사를 거친다. 그 사이 지운 컬럼의 값과 지금 컬럼 규칙에 맞지 않는 값은 뺀다.
 * 이미 같은 id가 있으면(두 번 누름) 새로 넣지 않고 성공으로 본다.
 */
export async function restoreDiggingTrack(snapshot: DeletedDiggingTrack): Promise<{
  id: string;
  createdAt: Date;
  linkUrl: string | null;
  values: Record<string, unknown>;
}> {
  const session = await requireAuth();
  assertStudentSession(session.user.role);
  if (!snapshot || typeof snapshot.id !== "string" || !TRACK_ID_PATTERN.test(snapshot.id)) {
    throw new Error("되돌릴 트랙을 찾지 못했습니다.");
  }
  const db = createDb();
  const columns = await db
    .select({
      id: diggingColumns.id,
      userId: diggingColumns.userId,
      columnType: diggingColumns.columnType,
      options: diggingColumns.options,
    })
    .from(diggingColumns)
    .where(eq(diggingColumns.userId, session.user.id!));
  const rawValues = snapshot.values && typeof snapshot.values === "object" && !Array.isArray(snapshot.values) ? snapshot.values : {};
  const values: Record<string, unknown> = {};
  for (const column of columns) {
    if (!(column.id in rawValues)) continue;
    const parsed = parseDiggingTrackInput({ values: { [column.id]: rawValues[column.id] } }, columns);
    if (parsed.ok) Object.assign(values, parsed.value.values);
  }
  const parsed = parseDiggingTrackInput({ linkUrl: snapshot.linkUrl, values }, columns);
  if (!parsed.ok) throw new Error(parsed.error);

  const now = new Date();
  const original = snapshot.createdAt ? new Date(snapshot.createdAt) : null;
  // 만든 시각을 지켜 보드의 원래 자리로 돌아가게 한다(미래 시각은 받지 않는다).
  const createdAt = original && Number.isFinite(original.getTime()) && original.getTime() <= now.getTime()
    ? new Date(Math.floor(original.getTime() / 1000) * 1000)
    : new Date(Math.floor(now.getTime() / 1000) * 1000);
  await db
    .insert(diggingTracks)
    .values({
      id: snapshot.id,
      userId: session.user.id!,
      linkUrl: parsed.value.linkUrl,
      values: JSON.stringify(parsed.value.values),
      createdAt,
    })
    .onConflictDoNothing({ target: diggingTracks.id });
  const [row] = await db
    .select({ id: diggingTracks.id, userId: diggingTracks.userId, linkUrl: diggingTracks.linkUrl, values: diggingTracks.values, createdAt: diggingTracks.createdAt })
    .from(diggingTracks)
    .where(eq(diggingTracks.id, snapshot.id))
    .limit(1);
  // 같은 id가 남의 행이면(있을 수 없지만) 되돌린 것으로 보지 않는다.
  if (!row || row.userId !== session.user.id) throw new Error("되돌릴 트랙을 찾지 못했습니다.");

  revalidatePath("/dashboard/student/digging");
  revalidatePath("/dashboard/student");
  return { id: row.id, createdAt: row.createdAt ?? createdAt, linkUrl: row.linkUrl, values: parseStoredTrackValues(row.values) };
}

function parseStoredTrackValues(raw: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ─── 링크 메타 추출 ───────────────────────────────

/**
 * URL에서 트랙명/아티스트 자동 추출.
 * YouTube / SoundCloud → oEmbed API.
 * 기타 → Open Graph 태그 파싱.
 */
export async function fetchLinkMeta(url: string): Promise<DiggingLinkMetadata> {
  const session = await requireAuth();
  assertStudentSession(session.user.role);
  return fetchDiggingLinkMetadata(url);
}

async function assertCanAccessDiggingUser(userId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, userId);
  return session;
}

function assertStudentSession(role: unknown): void {
  if (role !== "student") throw new Error("학생만 디깅 보드를 변경할 수 있습니다.");
}
