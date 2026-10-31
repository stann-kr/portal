/**
 * 공동 편집 room key. 같은 문서를 연 모든 기기·사용자가 같은 key의 room에 모인다.
 *
 * - `note:<noteId>` 노트(본문·제목)
 * - `guide:<pageId>` 가이드 페이지
 * - `post:<postId>` 게시물 수정 작업본(저장해야 게시물에 반영)
 * - `draft:<kind>:<ownerId>:<scope>` 아직 서버 문서가 없는 새 글 작성본(작성자만)
 */
export type CollabDraftKind = "post" | "qna-thread" | "qna-reply";

export type CollabDocKey =
  | { kind: "note"; id: string }
  | { kind: "guide"; id: string }
  | { kind: "post"; id: string }
  | { kind: "draft"; draftKind: CollabDraftKind; ownerId: string; scope: string };

const SEGMENT = /^[A-Za-z0-9_-]{1,100}$/;
const DRAFT_KINDS: readonly CollabDraftKind[] = ["post", "qna-thread", "qna-reply"];

export function isCollabKeySegment(value: string): boolean {
  return SEGMENT.test(value);
}

export function formatCollabDocKey(key: CollabDocKey): string {
  if (key.kind === "draft") {
    for (const segment of [key.ownerId, key.scope]) {
      if (!isCollabKeySegment(segment)) throw new Error("INVALID_COLLAB_KEY");
    }
    return `draft:${key.draftKind}:${key.ownerId}:${key.scope}`;
  }
  if (!isCollabKeySegment(key.id)) throw new Error("INVALID_COLLAB_KEY");
  return `${key.kind}:${key.id}`;
}

export function parseCollabDocKey(value: unknown): CollabDocKey | null {
  if (typeof value !== "string" || value.length > 300) return null;
  const parts = value.split(":");
  if (parts[0] === "draft") {
    if (parts.length !== 4) return null;
    const [, draftKind, ownerId, scope] = parts;
    if (!DRAFT_KINDS.includes(draftKind as CollabDraftKind)) return null;
    if (!isCollabKeySegment(ownerId) || !isCollabKeySegment(scope)) return null;
    return { kind: "draft", draftKind: draftKind as CollabDraftKind, ownerId, scope };
  }
  if (parts.length !== 2) return null;
  const [kind, id] = parts;
  if (kind !== "note" && kind !== "guide" && kind !== "post") return null;
  if (!isCollabKeySegment(id)) return null;
  return { kind, id };
}
