/**
 * @file src/lib/actions/digging.ts
 * @description 디깅 게시판 CRUD + 링크 메타 추출 서버 액션 (Phase 5).
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { diggingColumns, diggingTracks } from "@/db/schema";
import type { DiggingColumnType } from "@/db/schema";
import { and, eq } from "drizzle-orm";
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

  // 기본 컬럼 시드
  const rows = DEFAULT_COLUMNS.map((col) => ({
    id: crypto.randomUUID(),
    userId,
    isDefault: true,
    ...col,
  }));
  await db.insert(diggingColumns).values(rows);
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

  const existing = await db
    .select({ sortOrder: diggingColumns.sortOrder })
    .from(diggingColumns)
    .where(eq(diggingColumns.userId, session.user.id!))
    .orderBy(diggingColumns.sortOrder);
  if (existing.length >= DIGGING_COLUMNS_MAX_COUNT) {
    throw new Error(`컬럼은 최대 ${DIGGING_COLUMNS_MAX_COUNT}개까지 만들 수 있습니다.`);
  }

  const maxOrder = existing.length > 0
    ? Math.max(...existing.map((c: { sortOrder: number | null }) => c.sortOrder ?? 0))
    : -1;

  await db.insert(diggingColumns).values({
    id: crypto.randomUUID(),
    userId: session.user.id!,
    name: parsed.value.name,
    columnType: parsed.value.columnType,
    options: parsed.value.options ? JSON.stringify(parsed.value.options) : null,
    sortOrder: maxOrder + 1,
    isDefault: false,
  });

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

  const [[track], [column]] = await Promise.all([
    db
      .select()
      .from(diggingTracks)
      .where(
        and(
          eq(diggingTracks.id, trackId),
          eq(diggingTracks.userId, session.user.id!),
        ),
      )
      .limit(1),
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

  if (!track || !column) {
    throw new Error("트랙 또는 컬럼을 찾을 수 없습니다.");
  }
  const parsedValue = parseDiggingColumnValue(column, value);
  if (!parsedValue.ok) throw new Error(parsedValue.error);

  const currentValues = (() => {
    try { return JSON.parse(track.values ?? "{}") as Record<string, unknown>; }
    catch { return {} as Record<string, unknown>; }
  })();
  currentValues[columnId] = parsedValue.value;
  const serialized = JSON.stringify(currentValues);
  if (new TextEncoder().encode(serialized).byteLength > DIGGING_TRACK_VALUES_MAX_BYTES) {
    throw new Error("트랙 입력값이 저장 가능한 크기를 넘었습니다.");
  }

  await db
    .update(diggingTracks)
    .set({ values: serialized })
    .where(
      and(
        eq(diggingTracks.id, trackId),
        eq(diggingTracks.userId, session.user.id!),
      ),
    );
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
