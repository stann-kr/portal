/**
 * @file src/lib/actions/digging-playlists.ts
 * @description 디깅 보드 위 플레이리스트(Beatport 공유·SoundCloud 세트 링크) 조회·등록·수정·삭제 서버 액션.
 * 읽기는 학생 본인 또는 관리자, 쓰기는 학생 본인만 하며 모든 쓰기 WHERE에 session user_id를 둔다.
 * Beatport는 어떤 외부 요청도 하지 않고, SoundCloud는 새 링크의 제목이 비었을 때만 oEmbed로 제목을 채운다.
 * 입력 오류(잘못된 링크·중복·길이)는 화면이 문구를 보일 수 있게 결과 객체로, 권한 오류는 throw로 돌려준다.
 */
"use server";

import { revalidatePath } from "next/cache";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { createDb } from "@/db/client";
import { diggingPlaylists } from "@/db/schema";
import { requireAuth, requireStudentOwnerOrAdmin } from "@/lib/auth-guard";
import {
  DIGGING_PLAYLISTS_MAX_COUNT,
  clampDiggingPlaylistTitle,
  normalizeDiggingPlaylistUrl,
  parseDiggingPlaylistNote,
  parseDiggingPlaylistTitle,
  type DiggingPlaylistProviderName,
} from "@/lib/digging-contract";
import { fetchSoundCloudPlaylistTitle } from "@/lib/digging-link-metadata";

export type DiggingPlaylist = {
  id: string;
  provider: DiggingPlaylistProviderName;
  url: string;
  title: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DiggingPlaylistMutationResult =
  | { ok: true; playlist: DiggingPlaylist }
  | { ok: false; error: string };

const DUPLICATE_MESSAGE = "이미 등록한 플레이리스트입니다.";
const LIMIT_MESSAGE = `플레이리스트는 최대 ${DIGGING_PLAYLISTS_MAX_COUNT}개까지 등록할 수 있습니다.`;
const NOT_FOUND_MESSAGE = "플레이리스트를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.";

const playlistColumns = {
  id: diggingPlaylists.id,
  provider: diggingPlaylists.provider,
  url: diggingPlaylists.url,
  title: diggingPlaylists.title,
  note: diggingPlaylists.note,
  createdAt: diggingPlaylists.createdAt,
  updatedAt: diggingPlaylists.updatedAt,
};

/** 학생의 플레이리스트(최근 등록순). 학생 본인 또는 관리자만 읽는다. */
export async function getDiggingPlaylists(userId: string): Promise<DiggingPlaylist[]> {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, userId);
  const db = createDb();
  return db
    .select(playlistColumns)
    .from(diggingPlaylists)
    .where(eq(diggingPlaylists.userId, userId))
    .orderBy(desc(diggingPlaylists.createdAt), desc(diggingPlaylists.id));
}

export async function createDiggingPlaylist(input: {
  url: string;
  title?: string | null;
  note?: string | null;
}): Promise<DiggingPlaylistMutationResult> {
  const userId = await requireStudentWriter();
  const normalized = normalizeDiggingPlaylistUrl(input?.url);
  if (!normalized.ok) return normalized;
  const title = parseDiggingPlaylistTitle(input?.title);
  if (!title.ok) return title;
  const note = parseDiggingPlaylistNote(input?.note);
  if (!note.ok) return note;

  const db = createDb();
  const [existing] = await db
    .select({ id: diggingPlaylists.id })
    .from(diggingPlaylists)
    .where(and(eq(diggingPlaylists.userId, userId), eq(diggingPlaylists.url, normalized.url)))
    .limit(1);
  if (existing) return { ok: false, error: DUPLICATE_MESSAGE };
  const [{ value: owned } = { value: 0 }] = await db
    .select({ value: count() })
    .from(diggingPlaylists)
    .where(eq(diggingPlaylists.userId, userId));
  if (owned >= DIGGING_PLAYLISTS_MAX_COUNT) return { ok: false, error: LIMIT_MESSAGE };

  // SoundCloud만 제목을 자동으로 채운다. 실패해도 등록은 계속하고 화면은 기본 이름을 보인다.
  const resolvedTitle = title.value
    ?? (normalized.provider === "soundcloud"
      ? clampDiggingPlaylistTitle(await fetchSoundCloudPlaylistTitle(normalized.url))
      : null);

  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const playlist: DiggingPlaylist = {
    id: crypto.randomUUID(),
    provider: normalized.provider,
    url: normalized.url,
    title: resolvedTitle,
    note: note.value,
    createdAt: now,
    updatedAt: now,
  };
  const nowSeconds = Math.floor(now.getTime() / 1000);
  let inserted: { id: string }[];
  try {
    // 위 개수 확인은 oEmbed 요청을 아끼는 빠른 길이고, 동시 등록에서도 상한을 넘지 않게 INSERT가 개수를 다시 확인한다.
    inserted = await db.all<{ id: string }>(sql`
      INSERT INTO digging_playlists (id, user_id, provider, url, title, note, created_at, updated_at)
      SELECT ${playlist.id}, ${userId}, ${playlist.provider}, ${playlist.url}, ${playlist.title}, ${playlist.note}, ${nowSeconds}, ${nowSeconds}
      WHERE (SELECT count(*) FROM digging_playlists WHERE user_id = ${userId}) < ${DIGGING_PLAYLISTS_MAX_COUNT}
      RETURNING id`);
  } catch (error) {
    // 동시에 같은 링크를 등록하면 선검사를 지나도 unique index가 막는다.
    if (isUniqueViolation(error)) return { ok: false, error: DUPLICATE_MESSAGE };
    throw error;
  }
  if (inserted.length === 0) return { ok: false, error: LIMIT_MESSAGE };
  revalidateDigging();
  return { ok: true, playlist };
}

/**
 * 링크·제목·메모를 고친다. `url`을 빼면 링크는 그대로 둔다.
 * 링크가 바뀌면 provider를 새 링크로 다시 정하고, 같은 학생의 다른 행과 겹치면 중복 안내를 돌려준다.
 * 새 링크가 SoundCloud이고 제목이 비었으면 등록처럼 oEmbed로 제목을 채운다(실패해도 저장).
 */
export async function updateDiggingPlaylist(
  playlistId: string,
  input: { url?: string | null; title?: string | null; note?: string | null },
): Promise<DiggingPlaylistMutationResult> {
  const userId = await requireStudentWriter();
  if (typeof playlistId !== "string" || !playlistId) return { ok: false, error: NOT_FOUND_MESSAGE };
  const nextUrl = input?.url === undefined || input?.url === null ? null : normalizeDiggingPlaylistUrl(input.url);
  if (nextUrl && !nextUrl.ok) return nextUrl;
  const title = parseDiggingPlaylistTitle(input?.title);
  if (!title.ok) return title;
  const note = parseDiggingPlaylistNote(input?.note);
  if (!note.ok) return note;

  const db = createDb();
  const [current] = await db
    .select(playlistColumns)
    .from(diggingPlaylists)
    .where(and(eq(diggingPlaylists.id, playlistId), eq(diggingPlaylists.userId, userId)))
    .limit(1);
  if (!current) return { ok: false, error: NOT_FOUND_MESSAGE };

  const urlChanged = nextUrl !== null && nextUrl.url !== current.url;
  const provider = urlChanged ? nextUrl.provider : current.provider;
  const url = urlChanged ? nextUrl.url : current.url;
  if (urlChanged) {
    const [existing] = await db
      .select({ id: diggingPlaylists.id })
      .from(diggingPlaylists)
      .where(and(
        eq(diggingPlaylists.userId, userId),
        eq(diggingPlaylists.url, url),
        ne(diggingPlaylists.id, playlistId),
      ))
      .limit(1);
    if (existing) return { ok: false, error: DUPLICATE_MESSAGE };
  }
  // 링크를 SoundCloud로 바꾸며 제목을 비웠을 때만 외부 제목을 가져온다. Beatport는 요청하지 않는다.
  const resolvedTitle = title.value
    ?? (urlChanged && provider === "soundcloud"
      ? clampDiggingPlaylistTitle(await fetchSoundCloudPlaylistTitle(url))
      : null);

  // 초 단위 저장이라 같은 초에 만든 뒤 고쳐도 created_at <= updated_at을 지킨다.
  const updatedAt = new Date(Math.max(
    Math.floor(Date.now() / 1000) * 1000,
    current.createdAt.getTime(),
  ));
  let updated: DiggingPlaylist[];
  try {
    updated = await db
      .update(diggingPlaylists)
      .set({ provider, url, title: resolvedTitle, note: note.value, updatedAt })
      .where(and(eq(diggingPlaylists.id, playlistId), eq(diggingPlaylists.userId, userId)))
      .returning(playlistColumns);
  } catch (error) {
    // 동시에 같은 링크로 등록·수정하면 선검사를 지나도 unique index가 막는다.
    if (isUniqueViolation(error)) return { ok: false, error: DUPLICATE_MESSAGE };
    throw error;
  }
  // 읽은 뒤 다른 탭에서 지웠으면 바뀐 행이 없다. 성공으로 보고하지 않는다.
  const [saved] = updated;
  if (!saved) return { ok: false, error: NOT_FOUND_MESSAGE };
  revalidateDigging();
  return { ok: true, playlist: saved };
}

export async function deleteDiggingPlaylist(
  playlistId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireStudentWriter();
  if (typeof playlistId !== "string" || !playlistId) return { ok: false, error: NOT_FOUND_MESSAGE };
  const db = createDb();
  const deleted = await db
    .delete(diggingPlaylists)
    .where(and(eq(diggingPlaylists.id, playlistId), eq(diggingPlaylists.userId, userId)))
    .returning({ id: diggingPlaylists.id });
  if (deleted.length === 0) return { ok: false, error: NOT_FOUND_MESSAGE };
  revalidateDigging();
  return { ok: true };
}

async function requireStudentWriter(): Promise<string> {
  const session = await requireAuth();
  if (session.user.role !== "student" || !session.user.id) {
    throw new Error("학생만 플레이리스트를 변경할 수 있습니다.");
  }
  return session.user.id;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (message.includes("UNIQUE constraint failed")) return true;
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

function revalidateDigging(): void {
  revalidatePath("/dashboard/student/digging");
  revalidatePath("/dashboard/student");
}
