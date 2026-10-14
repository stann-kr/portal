/**
 * @file src/components/student-portal/AssignmentDetailPanel.tsx
 * @description SlidePanel 내 과제 상세 뷰.
 * VideoPlayer + 타임라인 피드백 리스트 (읽기 전용).
 */
"use client";

import { useState, useEffect } from "react";
import type { InferSelectModel } from "drizzle-orm";
import { feedbacks } from "@/db/schema";
import { VideoPlayer, type MediaSeekRequest } from "@/components/player/VideoPlayer";
import { getFeedbacksByAssignment } from "@/lib/actions/feedbacks";
import { AssignmentDeleteAction } from "./AssignmentDeleteAction";

type RawFeedback = InferSelectModel<typeof feedbacks>;

type Feedback = {
  id: string;
  timeMarker: number;
  content: string;
};

interface AssignmentDetailPanelProps {
  assignmentId: string;
  mediaUrl: string;
  /** 피드백 전 제출을 삭제한 뒤 목록에서 제외한다. */
  onDeleted?: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function AssignmentDetailPanel({
  assignmentId,
  mediaUrl,
  onDeleted,
}: AssignmentDetailPanelProps) {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [seekRequest, setSeekRequest] = useState<MediaSeekRequest>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    getFeedbacksByAssignment(assignmentId).then((data) => {
      if (!active) return;
      setFeedbacks(
        (data as RawFeedback[]).map((f) => ({
          id: f.id,
          timeMarker: f.timeMarker ?? 0,
          content: f.content,
        })),
      );
    }).catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [assignmentId, loadAttempt]);

  return (
    <div className="space-y-6">
      {/* 비디오 플레이어 */}
      <VideoPlayer url={mediaUrl} seekRequest={seekRequest} />

      {/* 피드백 리스트 */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          강사 피드백
        </h4>

        {loading ? (
          <div className="space-y-2" role="status" aria-label="피드백을 불러오는 중">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>피드백을 불러오지 못했습니다.</p>
            <button type="button" onClick={() => setLoadAttempt((value) => value + 1)} className="min-h-9 rounded-md border border-border px-3 focus-visible:ring-2 focus-visible:ring-ring">다시 시도</button>
          </div>
        ) : feedbacks.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground py-4 text-center">
              아직 피드백이 없습니다.
            </p>
            {onDeleted ? (
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-xs text-muted-foreground">잘못 제출했다면 피드백이 달리기 전에 삭제할 수 있습니다.</p>
                <AssignmentDeleteAction assignmentId={assignmentId} onDeleted={onDeleted} />
              </div>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-2">
            {feedbacks.map((fb) => (
              <li
                key={fb.id}
                className="flex gap-3 p-3 rounded-lg border border-border bg-card"
              >
                <button
                  type="button"
                  aria-label={`${formatTime(fb.timeMarker)} 시점으로 이동`}
                  onClick={() => setSeekRequest({ seconds: fb.timeMarker })}
                  className="flex-shrink-0 font-mono text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded hover:bg-primary/20 transition-colors"
                  title={`${formatTime(fb.timeMarker)}으로 이동`}
                >
                  {formatTime(fb.timeMarker)}
                </button>
                <p className="min-w-0 break-words text-sm text-foreground leading-relaxed">{fb.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
