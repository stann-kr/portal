/**
 * @file src/components/lesson/lesson-timestamps.ts
 * @description 수업 노트의 시점 표시(`[12:34]`)와 녹음 링크 규칙. 시점은 본문에 일반 글자로 남기고
 * (편집기 schema·서버 변환·sanitize를 바꾸지 않는다), 화면에서만 눌러 재생할 수 있게 꾸민다.
 */

/** `[m:ss]`·`[mm:ss]`·`[h:mm:ss]` */
export const LESSON_TIMESTAMP_PATTERN = /\[(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)\]/gu;

export function parseLessonTimestamp(match: RegExpExecArray | RegExpMatchArray): number {
  const hours = match[1] ? Number(match[1]) : 0;
  return hours * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function formatLessonClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${String(minutes).padStart(2, "0")}:${rest}`;
}

export function lessonTimestampText(totalSeconds: number): string {
  return `[${formatLessonClock(totalSeconds)}]`;
}

export function lessonTrackText(track: number): string {
  return `▸ 트랙 ${track}`;
}

/** `95`, `1m35s`, `1:35`, `1h2m3s` 같은 시작 위치를 초로 읽는다. */
function parseStartValue(value: string | null): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) return Number(trimmed);
  const clock = /^(?:(\d+):)?(\d+):(\d{2})$/u.exec(trimmed);
  if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/u.exec(trimmed);
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  }
  return 0;
}

export type LessonRecording = {
  /** 플레이어에 넘길 주소(시작 위치 표시는 뺀다). */
  url: string;
  /** 링크에 적힌 시작 위치(초). 믹스가 녹음의 이 지점부터 시작한다는 뜻으로 시점에 더한다. */
  offsetSeconds: number;
};

const YOUTUBE_HOST = /^(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com$|^youtu\.be$/u;
const SOUNDCLOUD_HOST = /^(?:www\.|m\.)?soundcloud\.com$/u;

/** 본문의 링크·영상 주소 하나를 녹음으로 읽는다. YouTube·SoundCloud가 아니면 null. */
export function parseLessonRecording(raw: string): LessonRecording | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOST.test(host)) {
    const embed = /^\/embed\/([\w-]{6,})/u.exec(url.pathname);
    const id = embed?.[1]
      ?? (host === "youtu.be" ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v"))
      ?? /^\/(?:live|shorts)\/([\w-]{6,})/u.exec(url.pathname)?.[1];
    if (!id || !/^[\w-]{6,}$/u.test(id)) return null;
    const offsetSeconds = parseStartValue(url.searchParams.get("t") ?? url.searchParams.get("start"));
    return { url: `https://www.youtube.com/watch?v=${id}`, offsetSeconds };
  }
  if (SOUNDCLOUD_HOST.test(host)) {
    if (url.pathname.split("/").filter(Boolean).length < 2) return null;
    const hashStart = /^#t=(.+)$/u.exec(url.hash)?.[1] ?? null;
    const offsetSeconds = parseStartValue(hashStart);
    url.hash = "";
    return { url: url.toString(), offsetSeconds };
  }
  return null;
}

/** 본문 화면에서 첫 YouTube·SoundCloud 링크(영상 블록 포함)를 녹음으로 고른다. */
export function findLessonRecording(root: ParentNode): LessonRecording | null {
  for (const element of root.querySelectorAll<HTMLElement>("a[href], iframe[src], div[data-youtube-video] iframe")) {
    const raw = element.getAttribute(element.tagName === "A" ? "href" : "src") ?? "";
    const recording = parseLessonRecording(raw);
    if (recording) return recording;
  }
  return null;
}
