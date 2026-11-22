/**
 * 과제 글 계정 임시 저장(0035 `assignment_drafts`)의 key 모양·크기 한도·응답 타입.
 * 서버 action(`actions/assignmentDrafts.ts`)과 화면 hook(`hooks/useAccountDraftSync.ts`)이 함께 쓴다.
 */

/** 계정 사본 한 벌의 최대 크기(UTF-8 byte). 과제 글 상한(수천 자)과 분석 메모를 넉넉히 덮는다. */
export const ASSIGNMENT_DRAFT_MAX_PAYLOAD_BYTES = 200_000;

const ID_PATTERN = "[A-Za-z0-9_-]{1,100}";
const TASK_KEY = new RegExp(`^(task-submission|analysis):(${ID_PATTERN})$`, "u");
const FREE_KEY = new RegExp(`^free-submission:(new|${ID_PATTERN})$`, "u");

export type AssignmentDraftTarget =
  | { kind: "task"; taskId: string }
  | { kind: "free"; submissionId: string | null };

/** 화면 세 곳의 초안 key만 받는다(받은 과제 제출·믹스셋 분석·자유 제출). 그 밖의 모양은 null. */
export function parseAssignmentDraftKey(draftKey: unknown): AssignmentDraftTarget | null {
  if (typeof draftKey !== "string") return null;
  const task = TASK_KEY.exec(draftKey);
  if (task) return { kind: "task", taskId: task[2]! };
  const free = FREE_KEY.exec(draftKey);
  if (free) return { kind: "free", submissionId: free[1] === "new" ? null : free[1]! };
  return null;
}

/** 새 자유 제출 초안 key. 제출하면 이 key의 계정 사본을 지운다. */
export const NEW_FREE_SUBMISSION_DRAFT_KEY = "free-submission:new";

export function freeSubmissionDraftKey(submissionId: string | null): string {
  return `free-submission:${submissionId ?? "new"}`;
}

/** 계정 사본. payloadJson은 화면이 쓰던 값 그대로(JSON object)다. */
export type AccountDraftCopy = { payloadJson: string; version: number; updatedAt: Date };

export type GetAccountDraftResult = { ok: true; draft: AccountDraftCopy | null } | { ok: false };

export type SaveAccountDraftResult =
  | { status: "saved"; version: number; updatedAt: Date }
  /** 다른 기기가 먼저 바꿨다(또는 지웠다). 지금 계정 사본을 돌려준다. */
  | { status: "conflict"; draft: AccountDraftCopy | null }
  /** 학생이 아니거나 남의 과제·없는 과제, 잘못된 key·내용. */
  | { status: "denied" };

export type DiscardAccountDraftResult = { status: "discarded" } | { status: "conflict"; draft: AccountDraftCopy | null } | { status: "denied" };

/** JSON object이고 한도 안인지. */
export function isValidAccountDraftPayload(payloadJson: unknown): payloadJson is string {
  if (typeof payloadJson !== "string") return false;
  if (new TextEncoder().encode(payloadJson).byteLength > ASSIGNMENT_DRAFT_MAX_PAYLOAD_BYTES) return false;
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
