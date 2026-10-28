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

/**
 * 기본 날짜(와 캘린더 빠른 입력으로 넘어온 기본 제목)만 채워진 새 노트와 사용자가 바꾼 초안을 구분한다.
 * 기본값뿐인 화면은 초안으로 남기지 않아, 다음 빠른 입력 제목을 옛 제목이 가로채지 않게 한다.
 */
export function isCreateNoteDraftEmpty(
  draft: CreateNoteDraftFields,
  defaultNoteDate: string,
  defaultTitle = "",
): boolean {
  return (
    (!draft.title || draft.title === defaultTitle) &&
    isRichTextEmpty(draft.contentHtml) &&
    draft.noteDate === defaultNoteDate
  );
}
