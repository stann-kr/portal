import { isAllowedDiggingLinkUrl } from "@/lib/digging-contract";

const LINK_META_TIMEOUT_MS = 5_000;
const LINK_META_MAX_BYTES = 256 * 1_024;
const LINK_META_MAX_REDIRECTS = 3;

export type DiggingLinkMetadata = {
  title?: string;
  artist?: string;
  siteName?: string;
};

type FetchLike = typeof fetch;

async function fetchBoundedText(
  initialUrl: string,
  expectedContentType: "application/json" | "text/html",
  fetchImpl: FetchLike,
): Promise<string | null> {
  let currentUrl = initialUrl;
  for (let redirect = 0; redirect <= LINK_META_MAX_REDIRECTS; redirect += 1) {
    if (!isAllowedDiggingLinkUrl(currentUrl)) return null;
    const response = await fetchImpl(currentUrl, {
      headers: { "User-Agent": "StannLumoPortal/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(LINK_META_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === LINK_META_MAX_REDIRECTS) return null;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes(expectedContentType)) return null;

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > LINK_META_MAX_BYTES) {
      return null;
    }
    if (!response.body) return null;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > LINK_META_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }
  return null;
}

export async function fetchDiggingLinkMetadata(
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<DiggingLinkMetadata> {
  try {
    if (!isAllowedDiggingLinkUrl(url)) return {};
    const hostname = new URL(url).hostname.toLowerCase();

    if (hostname === "youtu.be" || hostname.endsWith(".youtube.com")) {
      const payload = await fetchBoundedText(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        "application/json",
        fetchImpl,
      );
      if (!payload) return {};
      const data = JSON.parse(payload) as Record<string, unknown>;
      return {
        title: typeof data.title === "string" ? data.title : undefined,
        artist: typeof data.author_name === "string" ? data.author_name : undefined,
        siteName: "YouTube",
      };
    }

    if (hostname === "soundcloud.com" || hostname.endsWith(".soundcloud.com")) {
      const payload = await fetchBoundedText(
        `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        "application/json",
        fetchImpl,
      );
      if (!payload) return {};
      const data = JSON.parse(payload) as Record<string, unknown>;
      const titleRaw = typeof data.title === "string" ? data.title : "";
      const byMatch = titleRaw.match(/^(.+) by (.+)$/);
      const dashMatch = titleRaw.match(/^(.+?) - (.+)$/);
      if (byMatch) return { title: byMatch[1], artist: byMatch[2], siteName: "SoundCloud" };
      if (dashMatch) return { title: dashMatch[2], artist: dashMatch[1], siteName: "SoundCloud" };
      return {
        title: titleRaw || undefined,
        artist: typeof data.author_name === "string" ? data.author_name : undefined,
        siteName: "SoundCloud",
      };
    }

    const html = await fetchBoundedText(url, "text/html", fetchImpl);
    if (!html) return {};
    return {
      title:
        html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1] ??
        html.match(/<title>([^<]+)<\/title>/i)?.[1] ??
        undefined,
      siteName: html.match(
        /<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"/i,
      )?.[1],
    };
  } catch {
    return {};
  }
}

/**
 * SoundCloud 세트(플레이리스트) 제목을 oEmbed로 읽는다. 트랙 메타와 달리 제목을 "아티스트 - 곡"으로 가르지 않고
 * oEmbed가 붙이는 " by <작성자>"만 뗀다. 실패하면 null을 돌려 호출한 쪽이 기본 이름을 쓰게 한다.
 * Beatport처럼 다른 host의 링크는 요청하지 않는다.
 */
export async function fetchSoundCloudPlaylistTitle(
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  try {
    if (!isAllowedDiggingLinkUrl(url)) return null;
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname !== "soundcloud.com") return null;
    const payload = await fetchBoundedText(
      `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      "application/json",
      fetchImpl,
    );
    if (!payload) return null;
    const data = JSON.parse(payload) as Record<string, unknown>;
    const title = typeof data.title === "string" ? data.title.trim() : "";
    const author = typeof data.author_name === "string" ? data.author_name.trim() : "";
    const suffix = author ? ` by ${author}` : "";
    const stripped = suffix && title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
    return stripped || null;
  } catch {
    return null;
  }
}
