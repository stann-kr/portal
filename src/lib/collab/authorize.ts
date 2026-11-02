import { deriveCreationResourceId, parseCreationOperationId } from "@/lib/creation-operation";
import { formatCollabDocKey, isCollabKeySegment, parseCollabDocKey, type CollabDocKey } from "./doc-key";
import type { CollabMode } from "./protocol";

/**
 * 공동 편집 토큰 발급 전 권한 판단. 기존 문서 action과 같은 규칙만 쓴다.
 * - 노트: 읽기 학생 본인·관리자, 쓰기 작성자·관리자. 휴지통 노트는 거부(볼 권한이 있으면 TRASHED로 구분).
 * - 새 노트: 결정적 생성 id가 아직 없고 그 학생 공간에 쓸 수 있으면 쓰기.
 * - 가이드: 관리자만. 게시물: 작성자·관리자, 휴지통 제외.
 * - 새 글 작성본(draft): 본인만. Q&A 답글은 thread 접근 권한도 확인한다.
 * - 알림(notify): 읽기만. Q&A는 thread 접근 권한, 학생 노트는 관리자와 그 학생.
 *
 * 노트·게시물은 같은 조회에서 읽은 lifecycle 표지(복원 revision)를 함께 돌려준다. room이 이 값으로 세대를 맞춘다.
 */
export type CollabActor = { id: string; isAdmin: boolean };

export type CollabDocumentLoaders = {
  findNote(id: string): Promise<{ studentId: string; authorId: string; deletedAt: Date | null; lifecycle: number } | null>;
  findPost(id: string): Promise<{ authorId: string; deletedAt: Date | null; lifecycle: number } | null>;
  findGuidePage(id: string): Promise<{ id: string } | null>;
  findQnaThread(id: string): Promise<{ studentId: string; deletedAt: Date | null } | null>;
  /** 활성 학생 profile인지(관리자가 학생 공간에 새 노트를 만들 때). */
  isActiveStudent(id: string): Promise<boolean>;
};

export type CollabNoteCreateRequest = { operationId: string; studentId: string };

export type CollabAuthorization =
  | { ok: true; key: string; mode: CollabMode; lifecycle?: number }
  | { ok: false; reason: "BAD_REQUEST" | "NOT_FOUND_OR_FORBIDDEN" | "TRASHED" };

const DENIED = { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" } as const;
/** 휴지통에 있다(볼 권한이 있는 사람에게만 알린다). 되살리면 같은 문서로 다시 붙는다. */
const TRASHED = "trashed" as const;

export function deriveNewNoteCollabKey(actorId: string, request: CollabNoteCreateRequest): string | null {
  const operationId = parseCreationOperationId(request.operationId);
  if (!operationId || !isCollabKeySegment(request.studentId)) return null;
  const id = deriveCreationResourceId(operationId, JSON.stringify(["private-note", actorId, request.studentId]));
  return formatCollabDocKey({ kind: "note", id });
}

async function authorizeKey(
  actor: CollabActor,
  key: CollabDocKey,
  loaders: CollabDocumentLoaders,
): Promise<{ mode: CollabMode; lifecycle?: number } | typeof TRASHED | null> {
  switch (key.kind) {
    case "note": {
      const note = await loaders.findNote(key.id);
      if (!note) return null;
      if (!actor.isAdmin && actor.id !== note.studentId) return null;
      if (note.deletedAt) return TRASHED;
      return { mode: actor.isAdmin || actor.id === note.authorId ? "write" : "read", lifecycle: note.lifecycle };
    }
    case "guide": {
      if (!actor.isAdmin) return null;
      return (await loaders.findGuidePage(key.id)) ? { mode: "write" } : null;
    }
    case "post": {
      const post = await loaders.findPost(key.id);
      if (!post) return null;
      if (!actor.isAdmin && actor.id !== post.authorId) return null;
      if (post.deletedAt) return TRASHED;
      return { mode: "write", lifecycle: post.lifecycle };
    }
    case "draft": {
      if (key.ownerId !== actor.id) return null;
      if (key.draftKind === "qna-reply") {
        const thread = await loaders.findQnaThread(key.scope);
        if (!thread || thread.deletedAt) return null;
        if (!actor.isAdmin && actor.id !== thread.studentId) return null;
      }
      return { mode: "write" };
    }
    case "notify": {
      if (key.topic === "qna") {
        const thread = await loaders.findQnaThread(key.id);
        if (!thread || thread.deletedAt) return null;
        return actor.isAdmin || actor.id === thread.studentId ? { mode: "read" } : null;
      }
      if (actor.isAdmin) return (await loaders.isActiveStudent(key.id)) ? { mode: "read" } : null;
      return actor.id === key.id ? { mode: "read" } : null;
    }
  }
}

export async function authorizeCollabRequest(
  actor: CollabActor,
  input: { key?: unknown; createNote?: unknown },
  loaders: CollabDocumentLoaders,
): Promise<CollabAuthorization> {
  if (input.createNote !== undefined && input.createNote !== null) {
    const request = input.createNote as Partial<CollabNoteCreateRequest>;
    if (typeof request !== "object" || typeof request.operationId !== "string" || typeof request.studentId !== "string") {
      return { ok: false, reason: "BAD_REQUEST" };
    }
    const key = deriveNewNoteCollabKey(actor.id, { operationId: request.operationId, studentId: request.studentId });
    if (!key) return { ok: false, reason: "BAD_REQUEST" };
    const parsed = parseCollabDocKey(key);
    if (!parsed || parsed.kind !== "note") return { ok: false, reason: "BAD_REQUEST" };
    const existing = await loaders.findNote(parsed.id);
    if (existing) {
      // 이미 만들어진 노트면 일반 노트 규칙을 따른다(다른 기기에서 먼저 생성된 경우).
      return toAuthorization(key, await authorizeKey(actor, parsed, loaders));
    }
    if (!actor.isAdmin && actor.id !== request.studentId) return DENIED;
    if (!(await loaders.isActiveStudent(request.studentId))) return DENIED;
    return { ok: true, key, mode: "write", lifecycle: 0 };
  }
  const parsed = parseCollabDocKey(input.key);
  if (!parsed) return { ok: false, reason: "BAD_REQUEST" };
  return toAuthorization(formatCollabDocKey(parsed), await authorizeKey(actor, parsed, loaders));
}

function toAuthorization(key: string, granted: Awaited<ReturnType<typeof authorizeKey>>): CollabAuthorization {
  if (granted === TRASHED) return { ok: false, reason: "TRASHED" };
  return granted ? { ok: true, key, ...granted } : DENIED;
}
