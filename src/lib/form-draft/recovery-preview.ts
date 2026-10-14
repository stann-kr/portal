/** 복구본을 HTML 실행 없이 짧은 평문으로 표시한다. */
import {
  type FormDraftRecoveryPreview,
} from "./contract";

const FORM_DRAFT_TITLE_PREVIEW_LENGTH = 80;

const FORM_DRAFT_BODY_PREVIEW_LENGTH = 160;

const FORM_DRAFT_TITLE_PREVIEW_SCAN_LENGTH = 512;

const FORM_DRAFT_BODY_PREVIEW_SCAN_LENGTH = 4_096;

const FORM_DRAFT_PREVIEW_CONTROL_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

function decodeFormDraftPreviewEntities(value: string): string {
  const namedEntities: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/&#(?:x([\da-f]+)|(\d+));/giu, (entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
      if (
        !Number.isFinite(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return entity;
      }
      return String.fromCodePoint(codePoint);
    })
    .replace(/&([a-z]+);/giu, (entity, name: string) => namedEntities[name.toLowerCase()] ?? entity);
}

function truncateFormDraftPreview(value: string, maxLength: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, maxLength - 1).join("")}…`;
}

function createPlainTextFormDraftPreview(
  value: string | null,
  maxLength: number,
): string | null {
  if (!value) return null;

  const plainText = decodeFormDraftPreviewEntities(
    value
      .replace(/<!--[\s\S]*?(?:-->|$)/gu, " ")
      .replace(
        /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu,
        " ",
      )
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th|\/blockquote|\/pre)\b[^>]*>/giu, " ")
      .replace(/<[^>]*>/gu, " "),
  )
    .replace(FORM_DRAFT_PREVIEW_CONTROL_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return plainText
    ? truncateFormDraftPreview(plainText, maxLength)
    : null;
}

function readFormDraftPreviewField(
  data: unknown,
  fieldNames: readonly string[],
  scanLength: number,
): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (typeof value !== "string") continue;
    const boundedValue = value.slice(0, scanLength);
    if (/\S/u.test(boundedValue)) return boundedValue;
  }
  return null;
}

function createFormDraftEmbedPreview(contentHtml: string | null): string | null {
  if (!contentHtml) return null;
  const labels: string[] = [];
  if (/<img\b/iu.test(contentHtml)) labels.push("이미지 포함");
  if (/<iframe\b/iu.test(contentHtml)) labels.push("동영상 포함");
  if (/<table\b/iu.test(contentHtml)) labels.push("표 포함");
  if (/<hr\b/iu.test(contentHtml)) labels.push("구분선 포함");
  return labels.length > 0 ? labels.join(" · ") : null;
}

/** recovery data를 HTML로 렌더링하지 않고 사람이 구분할 수 있는 짧은 평문으로 축약한다. */
export function createFormDraftRecoveryPreview(
  data: unknown,
): FormDraftRecoveryPreview {
  const titleSource = readFormDraftPreviewField(
    data,
    ["title"],
    FORM_DRAFT_TITLE_PREVIEW_SCAN_LENGTH,
  );
  const bodySource = readFormDraftPreviewField(data, [
    "contentHtml",
    "content",
    "body",
    "text",
  ], FORM_DRAFT_BODY_PREVIEW_SCAN_LENGTH);
  const hasAttachment = Boolean(
    readFormDraftPreviewField(
      data,
      ["attachmentUrl", "mediaUrl"],
      FORM_DRAFT_TITLE_PREVIEW_SCAN_LENGTH,
    ),
  );

  return {
    title: createPlainTextFormDraftPreview(
      titleSource,
      FORM_DRAFT_TITLE_PREVIEW_LENGTH,
    ),
    body:
      createPlainTextFormDraftPreview(
        bodySource,
        FORM_DRAFT_BODY_PREVIEW_LENGTH,
      ) ??
      createFormDraftEmbedPreview(bodySource) ??
      (hasAttachment ? "첨부 파일 포함" : null),
  };
}
