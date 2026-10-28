/**
 * 과제(관리자 출제)와 학생 제출의 형식 검증·상태 계산(순수 함수).
 *
 * 글 제출과 과제 설명은 rich text 편집기 대신 일반 글 상자로 받는다.
 * 저장할 때는 HTML escape 뒤 문단(<p>)·줄바꿈(<br>)만 쓰는 고정 형식으로 바꾸고 sanitize한다.
 * 이 형식만 만들기 때문에 수정 화면에서는 같은 규칙으로 다시 글로 되돌릴 수 있다.
 */
import { sanitizeHtml } from "@/lib/sanitize-html";
import { isRichTextEmpty } from "@/lib/rich-text";
import { normalizeAssignmentMediaUrl } from "@/lib/assignment-media-url";
import type { AssignmentSubmissionFormatValue } from "@/lib/assignment-recurrence";

export const ASSIGNMENT_TEXT_MAX_LENGTH = 5_000;
export const ASSIGNMENT_TEXT_MAX_LENGTH_LABEL = "5,000";
export const ASSIGNMENT_TITLE_MAX_LENGTH = 120;
export const ASSIGNMENT_DESCRIPTION_MAX_LENGTH = 2_000;

/** 글 제출 제목이 없을 때(자유 글 제출) 목록에 보일 이름. */
export const TEXT_SUBMISSION_FALLBACK_TITLE = "글 제출";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&nbsp;|&#160;/gu, " ")
    .replace(/&amp;/gu, "&");
}

/** 일반 글을 문단 HTML로 바꾼다. 빈 줄은 문단 경계, 한 줄 바꿈은 <br>. */
export function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return "";
  const html = normalized
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.split("\n").map(escapeHtml).join("<br>")}</p>`)
    .join("");
  return sanitizeHtml(html);
}

/** plainTextToHtml로 만든 HTML(또는 단순 문단 HTML)을 글 상자 값으로 되돌린다. */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  return unescapeHtml(
    html
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<\/p>\s*<p[^>]*>/giu, "\n\n")
      .replace(/<[^>]+>/gu, ""),
  ).trim();
}

export type TextFieldResult = { ok: true; html: string } | { ok: false; error: string };

/** 글 상자 입력을 저장할 HTML로 검증한다. 빈 값은 html ""로 돌려준다. */
export function normalizePlainTextField(
  raw: unknown,
  { maxLength, label }: { maxLength: number; label: string },
): TextFieldResult {
  const text = typeof raw === "string" ? raw.replace(/\r\n?/gu, "\n").trim() : "";
  if (text.length > maxLength) {
    return { ok: false, error: `${label}은 ${maxLength}자까지 쓸 수 있습니다. 지금 ${text.length}자입니다.` };
  }
  const html = plainTextToHtml(text);
  return { ok: true, html: isRichTextEmpty(html) ? "" : html };
}

export type SubmissionPayloadResult =
  | { ok: true; mediaUrl: string | null; textHtml: string | null }
  | { ok: false; error: string };

/** 과제 제출 형식에 맞는 입력만 받는다. 형식에 없는 칸은 저장하지 않는다. */
export function validateSubmissionPayload(
  format: AssignmentSubmissionFormatValue,
  { mediaUrl, text }: { mediaUrl: unknown; text: unknown },
): SubmissionPayloadResult {
  let normalizedUrl: string | null = null;
  let textHtml: string | null = null;
  if (format === "MIX" || format === "BOTH") {
    const media = normalizeAssignmentMediaUrl(mediaUrl);
    if (!media.ok) return { ok: false, error: media.error };
    normalizedUrl = media.url;
  }
  if (format === "TEXT" || format === "BOTH") {
    const textResult = normalizePlainTextField(text, { maxLength: ASSIGNMENT_TEXT_MAX_LENGTH, label: "글" });
    if (!textResult.ok) return textResult;
    if (!textResult.html) return { ok: false, error: "제출할 글을 입력해 주세요." };
    textHtml = textResult.html;
  }
  return { ok: true, mediaUrl: normalizedUrl, textHtml };
}

export const FREE_SUBMISSION_EMPTY_ERROR = "링크나 글 중 하나 이상을 입력해 주세요.";

/**
 * 자유 제출(관리자 과제 없이 내는 제출) 입력 검증. 링크·글은 각각 선택이고 하나 이상 있어야 한다.
 * 빈 칸은 null로 저장하며, 둘 다 비면 DB CHECK에 맡기지 않고 안내 문구를 돌려준다.
 */
export function validateFreeSubmissionPayload(
  { mediaUrl, text }: { mediaUrl: unknown; text: unknown },
): SubmissionPayloadResult {
  let normalizedUrl: string | null = null;
  if (typeof mediaUrl === "string" && mediaUrl.trim()) {
    const media = normalizeAssignmentMediaUrl(mediaUrl);
    if (!media.ok) return { ok: false, error: media.error };
    normalizedUrl = media.url;
  }
  const textResult = normalizePlainTextField(text, { maxLength: ASSIGNMENT_TEXT_MAX_LENGTH, label: "글" });
  if (!textResult.ok) return textResult;
  const textHtml = textResult.html || null;
  if (!normalizedUrl && !textHtml) return { ok: false, error: FREE_SUBMISSION_EMPTY_ERROR };
  return { ok: true, mediaUrl: normalizedUrl, textHtml };
}

export function parseSubmissionFormat(raw: unknown): AssignmentSubmissionFormatValue | null {
  return raw === "MIX" || raw === "TEXT" || raw === "BOTH" ? raw : null;
}

export type AssignmentTaskStatus = "open" | "overdue" | "submitted" | "reviewed";

export const ASSIGNMENT_TASK_STATUS_LABELS: Record<AssignmentTaskStatus, string> = {
  open: "미제출",
  overdue: "마감 지남",
  submitted: "피드백 대기",
  reviewed: "피드백 완료",
};

/** 과제 상태: 제출 여부·피드백 수·마감 시각으로 정한다. */
export function getAssignmentTaskStatus(
  task: { dueAt: Date | null },
  submission: { feedbackCount: number } | null,
  referenceTime: Date,
): AssignmentTaskStatus {
  if (submission) return submission.feedbackCount > 0 ? "reviewed" : "submitted";
  return task.dueAt && task.dueAt.getTime() < referenceTime.getTime() ? "overdue" : "open";
}

/** 마감 뒤에 제출했는지. 마감이 없으면 늦은 제출이 아니다. */
export function isLateSubmission(dueAt: Date | null, submittedAt: Date | null): boolean {
  return Boolean(dueAt && submittedAt && submittedAt.getTime() > dueAt.getTime());
}
