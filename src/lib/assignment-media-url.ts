/**
 * 과제로 제출하는 믹스셋 링크의 허용 형식과 저장 표현.
 * 플레이어가 재생할 수 있는 YouTube 영상(watch·youtu.be·Shorts·라이브·embed)과
 * SoundCloud 트랙·세트만 받고, 모바일·뮤직 host는 같은 영상의 www 주소로 맞춘다.
 */

export type AssignmentMediaUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const YOUTUBE_VIDEO_ID = /^[\w-]{11}$/u;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const YOUTUBE_PATH_VIDEO = /^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/u;
const SOUNDCLOUD_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"]);

export const ASSIGNMENT_MEDIA_URL_MAX_LENGTH = 2_048;

const UNSUPPORTED_MESSAGE = "YouTube 영상 또는 SoundCloud 트랙 링크만 제출할 수 있습니다.";

function serialize(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}${url.hash}`;
}

export function normalizeAssignmentMediaUrl(raw: unknown): AssignmentMediaUrlResult {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, error: "미디어 URL을 입력해주세요." };
  if (value.length > ASSIGNMENT_MEDIA_URL_MAX_LENGTH) {
    return { ok: false, error: "링크가 너무 깁니다. 공유 링크를 다시 복사해 주세요." };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: UNSUPPORTED_MESSAGE };
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.port) {
    return { ok: false, error: UNSUPPORTED_MESSAGE };
  }
  url.protocol = "https:";
  const host = url.hostname.toLowerCase();

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).replace(/\/$/u, "");
    return YOUTUBE_VIDEO_ID.test(id) ? { ok: true, url: serialize(url) } : { ok: false, error: UNSUPPORTED_MESSAGE };
  }

  if (YOUTUBE_HOSTS.has(host)) {
    url.hostname = "www.youtube.com";
    const isWatch = url.pathname === "/watch" || url.pathname === "/watch/";
    if (isWatch && YOUTUBE_VIDEO_ID.test(url.searchParams.get("v") ?? "")) {
      return { ok: true, url: serialize(url) };
    }
    if (YOUTUBE_PATH_VIDEO.test(url.pathname)) return { ok: true, url: serialize(url) };
    return { ok: false, error: "YouTube는 재생할 영상의 링크(영상·Shorts·라이브)를 붙여 넣어 주세요." };
  }

  if (host === "on.soundcloud.com") {
    return {
      ok: false,
      error: "SoundCloud 앱의 짧은 공유 링크(on.soundcloud.com)는 재생할 수 없습니다. 링크를 브라우저에서 연 뒤 주소창의 soundcloud.com 주소를 붙여 넣어 주세요.",
    };
  }

  if (SOUNDCLOUD_HOSTS.has(host)) {
    url.hostname = "soundcloud.com";
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.length >= 2
      ? { ok: true, url: serialize(url) }
      : { ok: false, error: "SoundCloud는 아티스트 페이지가 아닌 트랙이나 세트 링크를 붙여 넣어 주세요." };
  }

  return { ok: false, error: UNSUPPORTED_MESSAGE };
}
