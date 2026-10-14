import { isRichTextEmpty } from "@/lib/rich-text";

type CreateNoteDraftFields = {
  title: string;
  noteDate: string;
  contentHtml: string;
};

/** 저장된 문자열은 빈 날짜까지 그대로 복원하고, legacy 누락값만 기본 날짜로 채운다. */
export function resolveRestoredCreateNoteDate(
  storedNoteDate: unknown,
  defaultNoteDate: string,
): string {
  return typeof storedNoteDate === "string" ? storedNoteDate : defaultNoteDate;
}

/** 기본 날짜만 채워진 새 노트와 사용자가 날짜를 바꾼 초안을 구분한다. */
export function isCreateNoteDraftEmpty(
  draft: CreateNoteDraftFields,
  defaultNoteDate: string,
): boolean {
  return (
    !draft.title &&
    isRichTextEmpty(draft.contentHtml) &&
    draft.noteDate === defaultNoteDate
  );
}
