import DOMPurify from "isomorphic-dompurify";

const YOUTUBE_EMBED_PATTERN = /^\/embed\/[A-Za-z0-9_-]+$/u;
const SAFE_YOUTUBE_BOOLEAN_PARAMS = new Set([
  "autoplay",
  "controls",
  "loop",
  "modestbranding",
  "mute",
  "rel",
]);
const RICH_TEXT_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "col",
  "colgroup",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "iframe",
  "img",
  "label",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
] as const;
const RICH_TEXT_ATTRIBUTES = [
  "alt",
  "colspan",
  "colwidth",
  "data-checked",
  "data-text-align",
  "data-type",
  "data-youtube-video",
  "height",
  "href",
  "rowspan",
  "src",
  "start",
  "title",
  "width",
] as const;

function createSafeYoutubeSource(url: URL): string | null {
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.youtube-nocookie.com" ||
    url.port ||
    url.username ||
    url.password ||
    !YOUTUBE_EMBED_PATTERN.test(url.pathname)
  ) {
    return null;
  }

  const safeUrl = new URL(`https://www.youtube-nocookie.com${url.pathname}`);
  for (const [key, value] of url.searchParams) {
    if (SAFE_YOUTUBE_BOOLEAN_PARAMS.has(key) && /^(?:0|1)$/u.test(value)) {
      safeUrl.searchParams.set(key, value);
    } else if ((key === "start" || key === "end") && /^\d{1,7}$/u.test(value)) {
      safeUrl.searchParams.set(key, value);
    } else if (key === "playlist" && /^[A-Za-z0-9_-]+$/u.test(value)) {
      safeUrl.searchParams.set(key, value);
    }
  }

  return safeUrl.toString();
}

function keepSafeYoutubeEmbeds(html: string): string {
  return html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/giu, (iframe) => {
    const srcMatch = iframe.match(/\bsrc=(?:"([^"]+)"|'([^']+)')/iu);
    const source = srcMatch?.[1] ?? srcMatch?.[2];
    if (!source) return "";

    try {
      const url = new URL(source.replaceAll("&amp;", "&"));
      const safeYoutubeSource = createSafeYoutubeSource(url);
      if (!safeYoutubeSource) return "";

      const safeSource = safeYoutubeSource.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
      return `<iframe src="${safeSource}" title="YouTube 동영상" loading="lazy" allowfullscreen></iframe>`;
    } catch {
      return "";
    }
  });
}

export function sanitizeHtml(rawHtml: string) {
  const sanitized = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [...RICH_TEXT_TAGS],
    ALLOWED_ATTR: [...RICH_TEXT_ATTRIBUTES],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
  });

  return keepSafeYoutubeEmbeds(sanitized);
}
