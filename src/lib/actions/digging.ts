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

const ALLOWED_LINK_META_HOSTS = [
  "youtube.com",
  "youtu.be",
  "soundcloud.com",
  "spotify.com",
  "music.apple.com",
  "bandcamp.com",
];

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
  await assertCanAccessDiggingUser(userId);

  const db = createDb();
  const existing = await db
    .select()
    .from(diggingColumns)
    .where(eq(diggingColumns.userId, userId))
    .orderBy(diggingColumns.sortOrder);

  if (existing.length > 0) return existing;

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
  const db = createDb();

  const existing = await db
    .select({ sortOrder: diggingColumns.sortOrder })
    .from(diggingColumns)
    .where(eq(diggingColumns.userId, session.user.id!))
    .orderBy(diggingColumns.sortOrder);

  const maxOrder = existing.length > 0
    ? Math.max(...existing.map((c: { sortOrder: number | null }) => c.sortOrder ?? 0))
    : -1;

  await db.insert(diggingColumns).values({
    id: crypto.randomUUID(),
    userId: session.user.id!,
    name: data.name,
    columnType: data.columnType,
    options: data.options ? JSON.stringify(data.options) : null,
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
}): Promise<{ id: string; createdAt: Date }> {
  const session = await requireAuth();
  const db = createDb();

  const id = crypto.randomUUID();
  const createdAt = new Date();

  await db.insert(diggingTracks).values({
    id,
    userId: session.user.id!,
    linkUrl: data.linkUrl ?? null,
    values: JSON.stringify(data.values),
  });

  revalidatePath("/dashboard/student/digging");
  revalidatePath("/dashboard/student");

  return { id, createdAt };
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
  const db = createDb();

  const [track] = await db
    .select()
    .from(diggingTracks)
    .where(
      and(
        eq(diggingTracks.id, trackId),
        eq(diggingTracks.userId, session.user.id!),
      ),
    )
    .limit(1);

  if (!track) return;

  const currentValues = (() => {
    try { return JSON.parse(track.values ?? "{}") as Record<string, unknown>; }
    catch { return {} as Record<string, unknown>; }
  })();
  currentValues[columnId] = value;

  await db
    .update(diggingTracks)
    .set({ values: JSON.stringify(currentValues) })
    .where(eq(diggingTracks.id, trackId));
}

/**
 * 트랙 삭제.
 */
export async function deleteDiggingTrack(trackId: string) {
  const session = await requireAuth();
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

type LinkMeta = {
  title?: string;
  artist?: string;
  siteName?: string;
};

/**
 * URL에서 트랙명/아티스트 자동 추출.
 * YouTube / SoundCloud → oEmbed API.
 * 기타 → Open Graph 태그 파싱.
 */
export async function fetchLinkMeta(url: string): Promise<LinkMeta> {
  await requireAuth();

  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) return {};

    const hostname = parsedUrl.hostname.toLowerCase();
    if (!isAllowedLinkMetaHost(hostname)) return {};

    // YouTube oEmbed
    if (/youtube\.com|youtu\.be/.test(url)) {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { next: { revalidate: 3600 } },
      );
      if (res.ok) {
        const data = await res.json();
        return { title: data.title, artist: data.author_name, siteName: "YouTube" };
      }
    }

    // SoundCloud oEmbed
    if (/soundcloud\.com/.test(url)) {
      const res = await fetch(
        `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { next: { revalidate: 3600 } },
      );
      if (res.ok) {
        const data = await res.json();
        // SoundCloud title 형식: "Artist - Track" 또는 "Track by Artist"
        const titleRaw: string = data.title ?? "";
        const byMatch = titleRaw.match(/^(.+) by (.+)$/);
        const dashMatch = titleRaw.match(/^(.+?) - (.+)$/);
        if (byMatch) return { title: byMatch[1], artist: byMatch[2], siteName: "SoundCloud" };
        if (dashMatch) return { title: dashMatch[2], artist: dashMatch[1], siteName: "SoundCloud" };
        return { title: titleRaw, artist: data.author_name, siteName: "SoundCloud" };
      }
    }

    // Open Graph 파싱 (Spotify 등 기타)
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; bot/1.0)" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return {};
    const html = await res.text();

    const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1];
    const ogSite = html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"/i)?.[1];
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];

    return {
      title: ogTitle ?? title ?? undefined,
      siteName: ogSite,
    };
  } catch {
    return {};
  }
}

async function assertCanAccessDiggingUser(userId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, userId);
}

function isAllowedLinkMetaHost(hostname: string) {
  return ALLOWED_LINK_META_HOSTS.some(
    (allowedHost) =>
      hostname === allowedHost || hostname.endsWith(`.${allowedHost}`),
  );
}
