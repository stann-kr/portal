/**
 * @file src/lib/legacy-draft-content.ts
 * @description 이전 초안 보관함이 쓰는 순수 helper. 저장된 초안 data(기기 초안·서버 초안 공통)에서
 * 제목과 본문 HTML을 안전하게 꺼내고, 복사용 평문을 만든다. 저장소에는 아무것도 쓰지 않는다.
 */

export type LegacyDraftContent = {
  title: string;
  contentHtml: string;
};

/**
 * 실시간 공동 편집으로 옮겨 가 이제 기기 초안을 쓰지 않는 문서 종류. 보관함은 이 종류의 기기 초안만 "이전 초안"으로 보인다.
 * 댓글·과제 피드백·제출·수업 메모·과제 폼은 지금도 같은 키로 기기 초안을 쓰고 폼이 직접 되살리므로 넣지 않는다.
 */
const LEGACY_ARCHIVE_DRAFT_KINDS: ReadonlySet<string> = new Set(["note", "community-post", "qna-thread", "qna-reply", "guide-page"]);

export function isLegacyArchiveDraftKind(kind: string): boolean {
  return LEGACY_ARCHIVE_DRAFT_KINDS.has(kind);
}

// 편집기가 예전에 본문을 담던 필드 이름(recovery-preview와 같은 우선순위).
const BODY_FIELDS = ["contentHtml", "content", "body", "text"] as const;

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

/** 초안 data 객체에서 제목·본문을 읽는다. 객체가 아니거나 필드가 문자열이 아니면 빈 문자열이다. */
export function readLegacyDraftContent(data: unknown): LegacyDraftContent {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { title: "", contentHtml: "" };
  }
  const record = data as Record<string, unknown>;
  const bodyField = BODY_FIELDS.find((field) => /\S/u.test(readString(record, field)));
  return {
    title: readString(record, "title"),
    contentHtml: bodyField ? readString(record, bodyField) : "",
  };
}

/** 서버 초안 payloadJson(`{version, data}`)을 읽는다. 깨진 JSON이어도 던지지 않고 빈 내용을 돌려준다. */
export function parseLegacyServerDraftPayload(payloadJson: string): LegacyDraftContent {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { title: "", contentHtml: "" };
    }
    return readLegacyDraftContent((parsed as Record<string, unknown>).data);
  } catch {
    return { title: "", contentHtml: "" };
  }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(?:x([\da-f]+)|(\d+));/giu, (entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff &&
        !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .replace(/&([a-z]+);/giu, (entity, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? entity);
}

/** HTML 본문을 줄바꿈이 남는 평문으로 바꾼다(블록 끝·<br>은 줄바꿈, 나머지 태그는 제거). */
export function legacyDraftHtmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu, "")
    .replace(/<br\b[^>]*>/giu, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|tr|blockquote|pre)\s*>/giu, "\n")
    .replace(/<\/(?:td|th)\s*>/giu, "\t")
    .replace(/<[^>]*>/gu, "");
  return decodeEntities(withBreaks)
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** 클립보드에 넣을 평문: 제목, 빈 줄, 본문. 둘 중 하나가 비면 있는 쪽만 쓴다. */
export function legacyDraftCopyText(content: LegacyDraftContent): string {
  const title = content.title.trim();
  const body = legacyDraftHtmlToPlainText(content.contentHtml);
  return [title, body].filter(Boolean).join("\n\n");
}
