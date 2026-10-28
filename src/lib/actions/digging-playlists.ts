/**
 * @file src/lib/actions/digging-playlists.ts
 * @description 디깅 보드 위 플레이리스트(Beatport 공유·SoundCloud 세트 링크) 조회·등록·수정·삭제 서버 액션.
 * 읽기는 학생 본인 또는 관리자, 쓰기는 학생 본인만 하며 모든 쓰기 WHERE에 session user_id를 둔다.
 * Beatport는 어떤 외부 요청도 하지 않고, SoundCloud는 제목이 비었을 때만 oEmbed로 제목을 채운다.
 * 입력 오류(잘못된 링크·중복·길이)는 화면이 문구를 보일 수 있게 결과 객체로, 권한 오류는 throw로 돌려준다.
 */
"use server";

import { revalidatePath } from "next/cache";
import { and, count, desc, eq } from "drizzle-orm";
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
  if (owned >= DIGGING_PLAYLISTS_MAX_COUNT) {
    return { ok: false, error: `플레이리스트는 최대 ${DIGGING_PLAYLISTS_MAX_COUNT}개까지 등록할 수 있습니다.` };
  }

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
  try {
    await db.insert(diggingPlaylists).values({ ...playlist, userId });
  } catch (error) {
    // 동시에 같은 링크를 등록하면 선검사를 지나도 unique index가 막는다.
    if (isUniqueViolation(error)) return { ok: false, error: DUPLICATE_MESSAGE };
    throw error;
  }
  revalidateDigging();
  return { ok: true, playlist };
}

/**
 * 제목·메모만 고친다. 링크를 바꾸려면 삭제 뒤 다시 등록한다(provider·중복 판정이 링크에 묶여 있다).
 */
export async function updateDiggingPlaylist(
  playlistId: string,
  input: { title?: string | null; note?: string | null },
): Promise<DiggingPlaylistMutationResult> {
  const userId = await requireStudentWriter();
  if (typeof playlistId !== "string" || !playlistId) return { ok: false, error: NOT_FOUND_MESSAGE };
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

  // 초 단위 저장이라 같은 초에 만든 뒤 고쳐도 created_at <= updated_at을 지킨다.
  const updatedAt = new Date(Math.max(
    Math.floor(Date.now() / 1000) * 1000,
    current.createdAt.getTime(),
  ));
  await db
    .update(diggingPlaylists)
    .set({ title: title.value, note: note.value, updatedAt })
    .where(and(eq(diggingPlaylists.id, playlistId), eq(diggingPlaylists.userId, userId)));
  revalidateDigging();
  return { ok: true, playlist: { ...current, title: title.value, note: note.value, updatedAt } };
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
