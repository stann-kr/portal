import { isRichTextEmpty } from "@/lib/rich-text";

type CreatePostDraftFields = {
  boardType: string;
  category: string;
  isPinned: boolean;
  title: string;
  contentHtml: string;
  mediaUrl: string;
  mediaObjectId?: string;
};

type CreatePostDraftDefaults = Pick<
  CreatePostDraftFields,
  "boardType" | "category"
>;

/** 기본 게시판 선택만 있는 새 글과 사용자가 metadata를 바꾼 초안을 구분한다. */
export function isCreatePostDraftEmpty(
  draft: CreatePostDraftFields,
  defaults: CreatePostDraftDefaults,
): boolean {
  return (
    !draft.title &&
    isRichTextEmpty(draft.contentHtml) &&
    !draft.mediaUrl &&
    !draft.mediaObjectId &&
    draft.boardType === defaults.boardType &&
    draft.category === defaults.category &&
    !draft.isPinned
  );
}
