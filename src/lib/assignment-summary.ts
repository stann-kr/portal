/** 학생 과제 보기의 제출 목록 행(자유 제출과 과제 제출을 함께 담는다). */
export type StudentAssignmentSummary = {
  id: string;
  /** 관리자 과제에 대한 제출이면 과제 id, 자유 제출이면 null */
  taskId: string | null;
  taskTitle: string | null;
  /** 글만 제출하면 null */
  mediaUrl: string | null;
  hasText: boolean;
  submittedAt: Date | null;
  /** Stann이 피드백 없이 확인함으로 표시한 시각. 없으면 null */
  reviewedAt: Date | null;
  feedbackCount: number;
};

export function toStudentAssignmentSummaries(
  rows: readonly {
    id: string;
    taskId: string | null;
    taskTitle: string | null;
    mediaUrl: string | null;
    textHtml: string | null;
    submittedAt: Date | null;
    reviewedAt: Date | null;
  }[],
  feedbackCounts: Record<string, number>,
): StudentAssignmentSummary[] {
  return rows.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    mediaUrl: row.mediaUrl,
    hasText: Boolean(row.textHtml),
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    feedbackCount: feedbackCounts[row.id] ?? 0,
  }));
}
