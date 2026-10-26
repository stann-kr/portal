/**
 * @file src/components/player/media-source.ts
 * @description 제출 링크의 제공처 표시(YouTube·SoundCloud)와 플레이어 선택에 쓰는 순수 표시 helper.
 */

/** SoundCloud 링크는 ReactPlayer 대신 공식 widget으로 재생한다. */
export function isSoundCloudUrl(url: string): boolean {
  return /^https?:\/\/(?:www\.)?soundcloud\.com\//iu.test(url);
}

/** 목록·상세의 "제공처" 칸. 알 수 없는 링크는 주소의 호스트를 그대로 보여 준다. */
export function mediaSourceLabel(url: string): string {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return "링크";
  }
  if (hostname === "youtu.be" || hostname === "youtube.com" || hostname.endsWith(".youtube.com")) return "YouTube";
  if (hostname === "soundcloud.com" || hostname.endsWith(".soundcloud.com")) return "SoundCloud";
  return hostname.replace(/^www\./u, "");
}
