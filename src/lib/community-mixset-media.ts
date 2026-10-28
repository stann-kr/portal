/**
 * 커뮤니티 믹스셋 게시물의 재생 매체 판별과 댓글 재생 시점의 공통 규칙.
 *
 * 링크 게시물은 별도 column 없이 `posts.media_url`에 정규화된 YouTube·SoundCloud 주소를 저장하고
 * `media_object_id`를 비운다. 업로드 오디오는 `media_object_id`가 있고, 그 밖의 `media_url`만 있는 행은
 * 이전 방식으로 올린 오디오(legacy)다.
 */
import { normalizeAssignmentMediaUrl } from "@/lib/assignment-media-url";

/** 새 게시물·수정 form의 믹스셋 링크 칸 이름. legacy `mediaUrl` 칸과 섞이지 않게 따로 둔다. */
export const MIXSET_LINK_FIELD = "mixsetLinkUrl";
/** 댓글 form의 재생 시점 칸 이름. 비우면 시점 없는 일반 댓글이다. */
export const COMMENT_TIME_MARKER_FIELD = "timeMarker";
/** 댓글 시점 상한(23:59:59). DB CHECK(`comments_time_marker_check`)와 같은 값이다. */
export const COMMENT_TIME_MARKER_MAX_SECONDS = 86_399;

export type MixsetMedia =
  | { kind: "link"; url: string }
  | { kind: "audio"; url: string };

const MIXSET_LINK_HOSTS = new Set(["www.youtube.com", "youtu.be", "soundcloud.com"]);

/**
 * 저장된 https 주소의 host가 정규화 결과로 나오는 YouTube·SoundCloud host일 때 링크로 본다.
 * 쓰기는 항상 정규화하므로, 정규화 세부 규칙이 나중에 바뀌어도 이미 저장된 링크를 오디오로 잘못 읽지 않게
 * 판별은 host로만 한다. legacy 업로드 오디오 주소(R2 공개 origin·`/api/media/*`)는 이 host가 아니다.
 */
export function isMixsetLinkUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && MIXSET_LINK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function classifyMixsetMedia(post: {
  mediaUrl: string | null;
  mediaObjectId?: string | null;
}): MixsetMedia | null {
  if (!post.mediaUrl) return null;
  if (!post.mediaObjectId && isMixsetLinkUrl(post.mediaUrl)) return { kind: "link", url: post.mediaUrl };
  return { kind: "audio", url: post.mediaUrl };
}

export type MixsetLinkResult = { ok: true; url: string } | { ok: false; error: string };

/** 과제 제출과 같은 허용 형식으로 정규화하되 안내 문구는 게시물 기준으로 바꾼다. */
export function normalizeMixsetLinkUrl(raw: unknown): MixsetLinkResult {
  const result = normalizeAssignmentMediaUrl(raw);
  if (result.ok) return result;
  if (result.error === "미디어 URL을 입력해주세요.") return { ok: false, error: "믹스셋 링크를 입력해 주세요." };
  if (result.error === "YouTube 영상 또는 SoundCloud 트랙 링크만 제출할 수 있습니다.") {
    return { ok: false, error: "YouTube 영상 또는 SoundCloud 트랙·세트 링크만 올릴 수 있습니다." };
  }
  return result;
}

export type TimeMarkerResult = { ok: true; seconds: number | null } | { ok: false; error: string };

const TIME_MARKER_ERROR = "재생 시점은 1:05:30, 12:34 또는 초(예: 754) 형식으로 입력해 주세요.";

/** 빈 값은 시점 없음. `h:mm:ss`, `m:ss`, 정수 초를 받고 0 이상 상한 이하만 허용한다. */
export function parseTimeMarker(raw: unknown): TimeMarkerResult {
  if (raw === null || raw === undefined) return { ok: true, seconds: null };
  if (typeof raw !== "string") return { ok: false, error: TIME_MARKER_ERROR };
  const value = raw.trim();
  if (!value) return { ok: true, seconds: null };
  let seconds: number;
  const hms = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/u.exec(value);
  const ms = /^(\d{1,4}):([0-5]\d)$/u.exec(value);
  if (hms) seconds = Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  else if (ms) seconds = Number(ms[1]) * 60 + Number(ms[2]);
  else if (/^\d{1,6}$/u.test(value)) seconds = Number(value);
  else return { ok: false, error: TIME_MARKER_ERROR };
  if (!Number.isSafeInteger(seconds) || seconds < 0) return { ok: false, error: TIME_MARKER_ERROR };
  if (seconds > COMMENT_TIME_MARKER_MAX_SECONDS) {
    return { ok: false, error: "재생 시점은 23:59:59 이하로 입력해 주세요." };
  }
  return { ok: true, seconds };
}

/** 1시간 미만은 `mm:ss`, 그 이상은 `h:mm:ss`. parseTimeMarker가 그대로 다시 읽는다. */
export function formatTimeMarker(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
