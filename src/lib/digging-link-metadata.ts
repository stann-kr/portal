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
