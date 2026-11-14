/**
 * @file src/lib/actions/digging.ts
 * @description 디깅 게시판 CRUD + 링크 메타 추출 서버 액션 (Phase 5).
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { diggingColumns, diggingTracks } from "@/db/schema";
import type { DiggingColumnType } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth, requireStudentOwnerOrAdmin } from "@/lib/auth-guard";
import {
  DIGGING_COLUMNS_MAX_COUNT,
  DIGGING_TRACK_VALUES_MAX_BYTES,
  parseDiggingColumnInput,
  parseDiggingColumnValue,
  parseDiggingTrackInput,
} from "@/lib/digging-contract";
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
 * 커스텀 컬럼 삭제 (isDefault=false만 허용).
 */
export async function deleteDiggingColumn(columnId: string) {
  const session = await requireAuth();
  assertStudentSession(session.user.role);
  const db = createDb();

  await db
    .delete(diggingColumns)
    .where(
      and(
        eq(diggingColumns.id, columnId),
        eq(diggingColumns.userId, session.user.id!),
        eq(diggingColumns.isDefault, false),
      ),
    );

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
        ),
      )
      .returning({ id: diggingTracks.id });
    if (written.length > 0) return;
    [track] = await readTrackValues();
  }
  throw new Error("다른 곳에서 이 트랙을 함께 고치고 있어 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
}

/**
 * 트랙 삭제.
 */
export async function deleteDiggingTrack(trackId: string) {
  const session = await requireAuth();
  assertStudentSession(session.user.role);
  const db = createDb();

  await db
    .delete(diggingTracks)
    .where(
      and(
        eq(diggingTracks.id, trackId),
        eq(diggingTracks.userId, session.user.id!),
      ),
    );

  revalidatePath("/dashboard/student/digging");
  revalidatePath("/dashboard/student");
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
