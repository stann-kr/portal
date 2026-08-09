import {
  defaultTreeAdapter,
  html,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes,
} from "parse5";

const YOUTUBE_VIDEO_EMBED_PATTERN = /^\/embed\/[A-Za-z0-9_-]+$/u;
const YOUTUBE_PLAYLIST_EMBED_PATH = "/embed/videoseries";
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SAFE_YOUTUBE_BOOLEAN_PARAMS = new Set([
  "autoplay",
  "controls",
  "loop",
  "modestbranding",
  "mute",
  "rel",
]);
const RICH_TEXT_TAGS = new Set([
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
]);
const DROP_WITH_CONTENT_TAGS = new Set([
  "base",
  "caption",
  "embed",
  "frame",
  "frameset",
  "head",
  "link",
  "meta",
  "noembed",
  "noframes",
  "noscript",
  "object",
  "plaintext",
  "script",
  "style",
  "template",
  "title",
  "xmp",
]);
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
const SAFE_TEXT_ALIGNMENTS = new Set(["left", "center", "right", "justify"]);
const UNSAFE_URL_WHITESPACE =
  /[\u0000-\u0020\u007f\u00a0\u1680\u180e\u2000-\u2029\u205f\u3000]/u;
const EXPLICIT_URL_SCHEME = /^([A-Za-z][A-Za-z\d+.-]*):/u;
const SAFE_DATA_IMAGE =
  /^data:image\/(?:gif|jpeg|png|webp);base64,[A-Za-z\d+/]+={0,2}$/iu;
const SAFE_DIMENSION = /^\d{1,7}$/u;
const SAFE_SPAN = /^\d{1,4}$/u;
const SAFE_LIST_START = /^-?\d{1,7}$/u;
const SAFE_COLWIDTH = /^\d{1,7}(?:,\d{1,7})*$/u;
const MAX_ATTRIBUTES_PER_ELEMENT = 64;
const MAX_RICH_TEXT_DEPTH = 128;
const HTML_VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

type HtmlAttribute = DefaultTreeAdapterTypes.Element["attrs"][number];
type HtmlChild = DefaultTreeAdapterTypes.ChildNode;
type HtmlParent = DefaultTreeAdapterTypes.ParentNode;

type AttributeScanState =
  | "AFTER_NAME"
  | "AFTER_QUOTED_VALUE"
  | "BEFORE_NAME"
  | "BEFORE_VALUE"
  | "DOUBLE_QUOTED_VALUE"
  | "NAME"
  | "SELF_CLOSING"
  | "SINGLE_QUOTED_VALUE"
  | "UNQUOTED_VALUE";

function isAsciiAlpha(character: string | undefined): boolean {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isHtmlSpace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" ||
    character === "\f" || character === "\r";
}

/** parse5의 attribute·중첩 O(n²) 경로를 입력 선형 scan으로 제한한다. */
function hasAcceptableAttributeComplexity(rawHtml: string): boolean {
  let cursor = 0;
  const openTagStack: string[] = [];

  while (cursor < rawHtml.length) {
    const open = rawHtml.indexOf("<", cursor);
    if (open === -1) return true;

    let tagCursor = open + 1;
    if (rawHtml[tagCursor] === "!" || rawHtml[tagCursor] === "?") {
      const declarationEnd = rawHtml.indexOf(">", tagCursor + 1);
      if (declarationEnd === -1) return true;
      cursor = declarationEnd + 1;
      continue;
    }
    const isEndTag = rawHtml[tagCursor] === "/";
    if (isEndTag) tagCursor += 1;
    if (!isAsciiAlpha(rawHtml[tagCursor])) {
      cursor = open + 1;
      continue;
    }

    const tagNameStart = tagCursor;
    tagCursor += 1;
    while (
      tagCursor < rawHtml.length &&
      !isHtmlSpace(rawHtml[tagCursor]) &&
      rawHtml[tagCursor] !== "/" &&
      rawHtml[tagCursor] !== ">"
    ) {
      tagCursor += 1;
    }
    const tagName = rawHtml.slice(tagNameStart, tagCursor).toLowerCase();

    let attributeCount = 0;
    let state: AttributeScanState = "BEFORE_NAME";
    let tagClosed = false;
    while (tagCursor < rawHtml.length && !tagClosed) {
      const character = rawHtml[tagCursor];

      switch (state) {
        case "BEFORE_NAME":
          if (isHtmlSpace(character)) {
            tagCursor += 1;
          } else if (character === "/") {
            state = "SELF_CLOSING";
            tagCursor += 1;
          } else if (character === ">") {
            tagCursor += 1;
            tagClosed = true;
          } else {
            attributeCount += 1;
            if (attributeCount > MAX_ATTRIBUTES_PER_ELEMENT) return false;
            state = "NAME";
            tagCursor += 1;
          }
          break;
        case "NAME":
          if (isHtmlSpace(character)) {
            state = "AFTER_NAME";
            tagCursor += 1;
          } else if (character === "=") {
            state = "BEFORE_VALUE";
            tagCursor += 1;
          } else if (character === "/" || character === ">") {
            state = "AFTER_NAME";
          } else {
            tagCursor += 1;
          }
          break;
        case "AFTER_NAME":
          if (isHtmlSpace(character)) {
            tagCursor += 1;
          } else if (character === "=") {
            state = "BEFORE_VALUE";
            tagCursor += 1;
          } else if (character === "/") {
            state = "SELF_CLOSING";
            tagCursor += 1;
          } else if (character === ">") {
            tagCursor += 1;
            tagClosed = true;
          } else {
            attributeCount += 1;
            if (attributeCount > MAX_ATTRIBUTES_PER_ELEMENT) return false;
            state = "NAME";
            tagCursor += 1;
          }
          break;
        case "BEFORE_VALUE":
          if (isHtmlSpace(character)) {
            tagCursor += 1;
          } else if (character === '"') {
            state = "DOUBLE_QUOTED_VALUE";
            tagCursor += 1;
          } else if (character === "'") {
            state = "SINGLE_QUOTED_VALUE";
            tagCursor += 1;
          } else if (character === ">") {
            tagCursor += 1;
            tagClosed = true;
          } else {
            state = "UNQUOTED_VALUE";
            tagCursor += 1;
          }
          break;
        case "DOUBLE_QUOTED_VALUE":
          if (character === '"') state = "AFTER_QUOTED_VALUE";
          tagCursor += 1;
          break;
        case "SINGLE_QUOTED_VALUE":
          if (character === "'") state = "AFTER_QUOTED_VALUE";
          tagCursor += 1;
          break;
        case "AFTER_QUOTED_VALUE":
          if (isHtmlSpace(character)) {
            state = "BEFORE_NAME";
            tagCursor += 1;
          } else if (character === "/") {
            state = "SELF_CLOSING";
            tagCursor += 1;
          } else if (character === ">") {
            tagCursor += 1;
            tagClosed = true;
          } else {
            state = "BEFORE_NAME";
          }
          break;
        case "UNQUOTED_VALUE":
          if (isHtmlSpace(character)) {
            state = "BEFORE_NAME";
            tagCursor += 1;
          } else if (character === ">") {
            tagCursor += 1;
            tagClosed = true;
          } else {
            tagCursor += 1;
          }
          break;
        case "SELF_CLOSING":
          if (character === ">") {
            tagCursor += 1;
            tagClosed = true;
          } else {
            state = "BEFORE_NAME";
          }
          break;
      }
    }

    if (tagClosed) {
      if (isEndTag) {
        if (openTagStack.at(-1) === tagName) openTagStack.pop();
      } else if (!HTML_VOID_TAGS.has(tagName)) {
        // HTML에서 non-void `<div/>`의 slash는 닫힘 표시가 아니므로 중첩으로 센다.
        openTagStack.push(tagName);
        if (openTagStack.length > MAX_RICH_TEXT_DEPTH) return false;
      }
    }

    cursor = tagCursor;
  }

  return true;
}

function createSafeYoutubeSource(url: URL): string | null {
  const isPlaylist = url.pathname === YOUTUBE_PLAYLIST_EMBED_PATH;
  const isVideo = !isPlaylist && YOUTUBE_VIDEO_EMBED_PATTERN.test(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.youtube-nocookie.com" ||
    url.port ||
    url.username ||
    url.password ||
    (!isPlaylist && !isVideo)
  ) {
    return null;
  }

  const safeUrl = new URL(`https://www.youtube-nocookie.com${url.pathname}`);
  if (isPlaylist) {
    const playlistIds = url.searchParams.getAll("list");
    if (playlistIds.length !== 1 || !YOUTUBE_ID_PATTERN.test(playlistIds[0])) return null;
    safeUrl.searchParams.set("list", playlistIds[0]);
  }
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

function hasSafeUrlShape(value: string): boolean {
  if (UNSAFE_URL_WHITESPACE.test(value)) return false;

  try {
    new URL(value, "https://portal.invalid");
    return true;
  } catch {
    return false;
  }
}

function isSafeUrl(value: string, protocols: ReadonlySet<string>): boolean {
  if (!hasSafeUrlShape(value)) return false;
  const scheme = EXPLICIT_URL_SCHEME.exec(value)?.[1];
  return !scheme || protocols.has(`${scheme.toLowerCase()}:`);
}

function isSafeImageSource(value: string): boolean {
  if (!hasSafeUrlShape(value)) return false;
  if (value.toLowerCase().startsWith("data:")) return SAFE_DATA_IMAGE.test(value);
  return isSafeUrl(value, SAFE_IMAGE_PROTOCOLS);
}

function isValidSpan(value: string): boolean {
  if (!SAFE_SPAN.test(value)) return false;
  const parsed = Number(value);
  return parsed >= 0 && parsed <= 1_000;
}

function isValidColwidth(value: string): boolean {
  return (
    SAFE_COLWIDTH.test(value) &&
    value.split(",").every((width) => {
      const parsed = Number(width);
      return parsed > 0 && parsed <= 10_000;
    })
  );
}

function sanitizeAttribute(tagName: string, attribute: HtmlAttribute): HtmlAttribute | null {
  if (attribute.namespace || attribute.prefix) return null;

  const { name, value } = attribute;
  if (name === "title") return { name, value };

  if (tagName === "a" && name === "href" && isSafeUrl(value, SAFE_LINK_PROTOCOLS)) {
    return { name, value };
  }

  if (tagName === "img") {
    if ((name === "alt" || name === "title") && typeof value === "string") {
      return { name, value };
    }
    if (name === "src" && isSafeImageSource(value)) return { name, value };
    if ((name === "width" || name === "height") && SAFE_DIMENSION.test(value)) {
      return { name, value };
    }
  }

  if (
    name === "data-text-align" &&
    (tagName === "p" || /^h[1-6]$/u.test(tagName)) &&
    SAFE_TEXT_ALIGNMENTS.has(value)
  ) {
    return { name, value };
  }

  if (tagName === "ul" && name === "data-type" && value === "taskList") {
    return { name, value };
  }
  if (tagName === "li" && name === "data-type" && value === "taskItem") {
    return { name, value };
  }
  if (tagName === "li" && name === "data-checked" && /^(?:true|false)$/u.test(value)) {
    return { name, value };
  }
  if (tagName === "div" && name === "data-youtube-video" && value === "") {
    return { name, value };
  }

  if ((tagName === "td" || tagName === "th") && name === "colspan" && isValidSpan(value)) {
    return { name, value };
  }
  if ((tagName === "td" || tagName === "th") && name === "rowspan" && isValidSpan(value)) {
    return { name, value };
  }
  if ((tagName === "td" || tagName === "th") && name === "colwidth" && isValidColwidth(value)) {
    return { name, value };
  }
  if (tagName === "col" && name === "width" && SAFE_DIMENSION.test(value)) {
    return { name, value };
  }
  if (tagName === "ol" && name === "start" && SAFE_LIST_START.test(value)) {
    return { name, value };
  }

  return null;
}

function appendSafeIframe(parent: HtmlParent, element: DefaultTreeAdapterTypes.Element): void {
  const source = element.attrs.find(
    (attribute) => !attribute.namespace && !attribute.prefix && attribute.name === "src",
  )?.value;
  if (!source) return;

  let safeSource: string | null = null;
  try {
    safeSource = createSafeYoutubeSource(new URL(source));
  } catch {
    return;
  }
  if (!safeSource) return;

  defaultTreeAdapter.appendChild(
    parent,
    defaultTreeAdapter.createElement("iframe", html.NS.HTML, [
      { name: "src", value: safeSource },
      { name: "title", value: "YouTube 동영상" },
      { name: "loading", value: "lazy" },
      { name: "allowfullscreen", value: "" },
    ]),
  );
}

function appendSanitizedNode(parent: HtmlParent, node: HtmlChild, depth = 0): void {
  if (defaultTreeAdapter.isTextNode(node)) {
    defaultTreeAdapter.appendChild(
      parent,
      defaultTreeAdapter.createTextNode(defaultTreeAdapter.getTextNodeContent(node)),
    );
    return;
  }

  if (!defaultTreeAdapter.isElementNode(node)) return;
  if (depth >= MAX_RICH_TEXT_DEPTH) return;
  if (defaultTreeAdapter.getNamespaceURI(node) !== html.NS.HTML) return;

  const tagName = defaultTreeAdapter.getTagName(node).toLowerCase();
  if (tagName === "iframe") {
    appendSafeIframe(parent, node);
    return;
  }
  if (DROP_WITH_CONTENT_TAGS.has(tagName)) return;

  const children = defaultTreeAdapter.getChildNodes(node);
  if (!RICH_TEXT_TAGS.has(tagName)) {
    for (const child of children) appendSanitizedNode(parent, child, depth + 1);
    return;
  }

  const attributes = node.attrs.flatMap((attribute) => {
    const safeAttribute = sanitizeAttribute(tagName, attribute);
    return safeAttribute ? [safeAttribute] : [];
  });
  const safeElement = defaultTreeAdapter.createElement(tagName, html.NS.HTML, attributes);
  defaultTreeAdapter.appendChild(parent, safeElement);
  for (const child of children) appendSanitizedNode(safeElement, child, depth + 1);
}

function sanitizeOnce(rawHtml: string): string {
  const context = defaultTreeAdapter.createElement("div", html.NS.HTML, []);
  const parsed = parseFragment(context, rawHtml, {});
  const sanitized = defaultTreeAdapter.createDocumentFragment();
  for (const child of defaultTreeAdapter.getChildNodes(parsed)) {
    appendSanitizedNode(sanitized, child);
  }
  return serialize(sanitized);
}

export function sanitizeHtml(rawHtml: string): string {
  if (!hasAcceptableAttributeComplexity(rawHtml)) return "";

  const firstPass = sanitizeOnce(rawHtml);
  if (firstPass === rawHtml) return firstPass;

  const secondPass = sanitizeOnce(firstPass);
  if (secondPass === firstPass) return secondPass;

  // wrapper 제거가 만든 임시 invalid hierarchy도 실제 div sink에서 반드시 fixed point가 된다.
  const fixedPoint = sanitizeOnce(secondPass);
  return fixedPoint === secondPass ? fixedPoint : "";
}
