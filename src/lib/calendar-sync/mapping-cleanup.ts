/**
 * 매핑 해제 때 함께 지울 포탈 일정(2026-11-17 사용자 결정). 해제하는 캘린더와 link로 이어진 일정만 지우고
 * 레슨·원격 캘린더 일정은 건드리지 않는다.
 *
 * - 학생 캘린더: 그 학생의 calendar_events 중 이 매핑에 link가 있는 일정. 그룹 일정 사본(group_event_id)은
 *   그룹 캘린더 몫이라 남긴다(지우면 멤버로 있는 동안 다시 생기지 않는다).
 * - 그룹 캘린더: 이 매핑에 link가 있는 그룹 일정 원본과 멤버 사본.
 * - 다른 매핑에도 link가 있는 일정은 남긴다. 지우면 남은 캘린더의 원격 사본까지 지워지거나 다음 pull이 다시
 *   가져오므로, 마지막 캘린더를 해제할 때 지운다.
 *
 * 대상은 실행 시점의 link로 고른다(먼저 읽은 id 목록을 쓰면 그 사이 알림 동기화가 만든 link를 놓친다).
 * 매핑 삭제와 같은 batch에 넣어 일정 삭제와 link cascade가 함께 commit되게 한다.
 */
import type { DbContext } from "@/db/client";
import type { DocumentAtomicStatement } from "@/lib/document-lifecycle-atomic";

export type UnmapTarget = { mappingId: string; studentId: string | null; groupId: string | null };

const LINKED_HERE = "SELECT local_id FROM calendar_sync_links WHERE mapping_id = ? AND local_kind = 'EVENT'";
const LINKED_ELSEWHERE = "SELECT local_id FROM calendar_sync_links WHERE mapping_id <> ? AND local_kind = 'EVENT'";

function studentEventFilter(target: UnmapTarget & { studentId: string }) {
  return {
    where: `user_id = ? AND group_event_id IS NULL AND id IN (${LINKED_HERE}) AND id NOT IN (${LINKED_ELSEWHERE})`,
    params: [target.studentId, target.mappingId, target.mappingId],
  };
}

function groupEventFilter(target: UnmapTarget & { groupId: string }) {
  return {
    where: `group_id = ? AND id IN (${LINKED_HERE}) AND id NOT IN (${LINKED_ELSEWHERE})`,
    params: [target.groupId, target.mappingId, target.mappingId],
  };
}

/** 일정 삭제(그룹이면 멤버 사본 → 원본) 뒤 매핑을 지우는 문장. link는 매핑 cascade로 지워진다. */
export function unmapStatements(target: UnmapTarget): DocumentAtomicStatement[] {
  const statements: DocumentAtomicStatement[] = [];
  if (target.groupId) {
    const filter = groupEventFilter({ ...target, groupId: target.groupId });
    statements.push(
      { query: `DELETE FROM calendar_events WHERE group_event_id IN (SELECT id FROM calendar_group_events WHERE ${filter.where})`, params: filter.params },
      { query: `DELETE FROM calendar_group_events WHERE ${filter.where}`, params: filter.params },
    );
  } else if (target.studentId) {
    const filter = studentEventFilter({ ...target, studentId: target.studentId });
    statements.push({ query: `DELETE FROM calendar_events WHERE ${filter.where}`, params: filter.params });
  }
  statements.push({ query: "DELETE FROM calendar_mappings WHERE id = ?", params: [target.mappingId] });
  return statements;
}

/** 해제 안내에 쓸 지울 일정 수(학생 일정 또는 그룹 일정 원본). 지우기 직전 값이라 그 사이 변화는 반영하지 않는다. */
export async function countUnmapEvents(ctx: DbContext, target: UnmapTarget): Promise<number> {
  let query: string;
  let params: unknown[];
  if (target.groupId) {
    const filter = groupEventFilter({ ...target, groupId: target.groupId });
    query = `SELECT COUNT(*) AS count FROM calendar_group_events WHERE ${filter.where}`;
    params = filter.params;
  } else if (target.studentId) {
    const filter = studentEventFilter({ ...target, studentId: target.studentId });
    query = `SELECT COUNT(*) AS count FROM calendar_events WHERE ${filter.where}`;
    params = filter.params;
  } else {
    return 0;
  }
  if (ctx.kind === "d1") {
    const row = await ctx.db.$client.prepare(query).bind(...params).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }
  const row = ctx.db.$client.prepare(query).get(...params) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}
