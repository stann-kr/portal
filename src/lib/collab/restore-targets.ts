import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { posts, privateNotes } from "@/db/schema";
import { classifyMixsetMedia } from "@/lib/community-mixset-media";

/**
 * 복원 뒤 live 문서에 적용할 목표(본문 HTML + room 칸). 복원 action과 토큰 route의 repair가 같은 값을 쓴다.
 * 복원 commit 뒤에는 옛 lifecycle 저장이 거부되고 room이 따라오기 전에는 새 lifecycle 저장이 없으므로 head가 복원 결과다.
 * 권한 확인은 부르는 쪽이 먼저 끝낸다.
 */
export type CollabRestoreTarget = { html: string; fields: Record<string, string> };

export function noteRoomFields(note: { title: string; noteDate: Date | null }): Record<string, string> {
  return { title: note.title, noteDate: note.noteDate ? new Date(note.noteDate).toISOString().slice(0, 10) : "" };
}

export type PostHeadRow = { title: string; contentHtml: string; mediaUrl: string | null; mediaObjectId: string | null };

export function postRoomFields(post: PostHeadRow, withLink: boolean): Record<string, string> {
  const media = withLink ? classifyMixsetMedia(post) : null;
  return { title: post.title, ...(withLink ? { mixsetLinkUrl: media?.kind === "link" ? media.url : "" } : {}) };
}

export async function readNoteRestoreTarget(noteId: string): Promise<CollabRestoreTarget | null> {
  const [head] = await createDb()
    .select({ title: privateNotes.title, contentHtml: privateNotes.contentHtml, noteDate: privateNotes.noteDate, deletedAt: privateNotes.deletedAt })
    .from(privateNotes)
    .where(eq(privateNotes.id, noteId))
    .limit(1);
  if (!head || head.deletedAt) return null;
  return { html: head.contentHtml, fields: noteRoomFields(head) };
}

export async function readPostRestoreTarget(postId: string): Promise<CollabRestoreTarget | null> {
  const [head] = await createDb()
    .select({ title: posts.title, contentHtml: posts.contentHtml, mediaUrl: posts.mediaUrl, mediaObjectId: posts.mediaObjectId, deletedAt: posts.deletedAt })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!head || head.deletedAt) return null;
  // 링크 칸은 링크형 믹스셋 게시물만 쓴다. 칸이 없는 작업본에 새 칸을 만들지 않도록 링크가 있을 때만 싣는다.
  return { html: head.contentHtml, fields: postRoomFields(head, classifyMixsetMedia(head)?.kind === "link") };
}
