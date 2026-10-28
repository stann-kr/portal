import { normalizeDocumentSnapshotNoteDate } from "@/lib/document-snapshot-fingerprint";
import { toKstDateInputValue } from "@/lib/date-input";
import { safeReturnPath } from "@/lib/safe-return-path";
import { PRIVATE_NOTE_MAX_TITLE_LENGTH } from "@/lib/private-note-continuity";

/** URL date는 실제 존재하는 YYYY-MM-DD만 받아들이고, 나머지는 KST 오늘로 닫는다. */
export function resolveNoteCreateDefaultDate(value: unknown, now = new Date()): string {
  if (typeof value !== "string") return toKstDateInputValue(now);
  try {
    return normalizeDocumentSnapshotNoteDate(value) ?? toKstDateInputValue(now);
  } catch {
    return toKstDateInputValue(now);
  }
}

/** URL title은 앞뒤 공백을 지우고 노트 제목 한도까지만 받는다. */
export function resolveNoteCreateDefaultTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, PRIVATE_NOTE_MAX_TITLE_LENGTH);
}

/** 캘린더의 선택 날짜·빠른 입력 제목과 현재 작업 문맥을 full-page composer URL로 전달한다. */
export function buildNoteCreateHref(input: {
  pathname: string;
  defaultDate?: string;
  defaultTitle?: string;
  returnTo: string;
  returnFallback: string;
}): string {
  const params = new URLSearchParams();
  const title = resolveNoteCreateDefaultTitle(input.defaultTitle);
  if (title) params.set("title", title);
  if (input.defaultDate) {
    try {
      params.set("date", normalizeDocumentSnapshotNoteDate(input.defaultDate) ?? "");
    } catch {
      // UI에서 전달한 손상된 날짜는 URL에 보존하지 않는다.
    }
  }
  params.set("returnTo", safeReturnPath(input.returnTo, input.returnFallback));
  return `${input.pathname}?${params.toString()}`;
}
