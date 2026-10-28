import { isRichTextEmpty } from "@/lib/rich-text";

type CreatePostDraftFields = {
  boardType: string;
  category: string;
  isPinned: boolean;
  title: string;
  contentHtml: string;
  mediaUrl: string;
  mediaObjectId?: string;
  /** 믹스셋 링크 칸 값. 이전 초안에는 없다. 오디오·링크 선택(mode)만 바뀐 상태는 빈 초안으로 본다. */
  mixsetLinkUrl?: string;
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
    !draft.mixsetLinkUrl?.trim() &&
    draft.boardType === defaults.boardType &&
    draft.category === defaults.category &&
    !draft.isPinned
  );
}
