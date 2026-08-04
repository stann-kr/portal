/**
 * @file src/components/student-portal/AssignmentView.tsx
 * @description 과제 뷰 — 믹스셋 제출 폼 + 제출 리스트 + SlidePanel 상세.
 * RSC에서 프리패치한 initialAssignments를 props로 받아 클라이언트 상태 관리.
 */
"use client";

import { useState, useActionState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Youtube, Music, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InferSelectModel } from "drizzle-orm";
import { assignments } from "@/db/schema";
import {
  submitAssignment,
  getMyAssignments,
  type SubmitAssignmentState,
} from "@/lib/actions/assignments";
import { getMyFeedbacksMap } from "@/lib/actions/feedbacks";

type RawAssignment = InferSelectModel<typeof assignments>;
import { SlidePanel } from "./SlidePanel";
import { AssignmentDetailPanel } from "./AssignmentDetailPanel";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";

// ── 타입 ──────────────────────────────────────────

type Assignment = {
  id: string;
  mediaUrl: string;
  submittedAt: Date | null;
  feedbackCount: number;
};

interface AssignmentViewProps {
  initialAssignments: Assignment[];
}

// ── 헬퍼 ─────────────────────────────────────────

function mediaIcon(url: string) {
  if (url.includes("youtube") || url.includes("youtu.be"))
    return <Youtube className="w-4 h-4 text-primary" aria-hidden="true" />;
  return <Music className="w-4 h-4 text-primary" aria-hidden="true" />;
}

function mediaPlatform(url: string) {
  return url.includes("youtube") || url.includes("youtu.be")
    ? "YouTube 믹스셋"
    : "SoundCloud 믹스셋";
}

function formatDate(date: Date | null): string {
  if (!date) return "제출일 미정";
  return new Date(date).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── 제출 폼 ──────────────────────────────────────

function SubmitForm({ onSuccess }: { onSuccess: () => void }) {
  const [state, action, isPending] = useActionState<SubmitAssignmentState, FormData>(
    submitAssignment,
    {},
  );

  useEffect(() => {
    if (state.success) onSuccess();
  }, [state.success, onSuccess]);

  return (
    <form
      action={action}
      className="space-y-3 p-4 rounded-xl border border-dashed border-border bg-muted/20"
    >
      <label htmlFor="assignment-media-url" className="text-sm font-semibold">
        새 믹스셋 URL
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="assignment-media-url"
          name="mediaUrl"
          type="url"
          placeholder="YouTube 또는 SoundCloud URL"
          required
          disabled={isPending}
          className="flex-1"
        />
        <Button type="submit" disabled={isPending} className="gap-1.5">
          <Upload className="w-4 h-4" />
          {isPending ? "제출 중..." : "제출"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">YouTube와 SoundCloud 링크를 지원합니다.</p>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {state.success && <p role="status" className="text-sm text-success">믹스셋을 제출했습니다.</p>}
    </form>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────

export function AssignmentView({ initialAssignments }: AssignmentViewProps) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<Assignment[]>(initialAssignments);

  // 상세 패널 상태
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string>("");
  const [panelOpen, setPanelOpen] = useState(false);

  const refresh = useCallback(async () => {
    const data = await getMyAssignments();
    const fbMap = await getMyFeedbacksMap();
    setAssignments(
      (data as RawAssignment[]).map((a) => ({
        id: a.id,
        mediaUrl: a.mediaUrl,
        submittedAt: a.submittedAt,
        feedbackCount: fbMap[a.id] ?? 0,
      })),
    );
    router.refresh();
  }, [router]);

  return (
    <div className="space-y-6">
      {/* 제출 폼 */}
      <SubmitForm onSuccess={refresh} />

      {/* 제출 목록 */}
      {assignments.length === 0 ? (
        <EmptyState
          title="제출한 믹스셋이 없습니다"
          description="위 입력란에 YouTube 또는 SoundCloud 링크를 붙여넣어 첫 믹스셋을 제출하세요."
          icon={<Upload className="size-4" aria-hidden="true" />}
        />
      ) : (
        <ul className="space-y-2">
          {assignments.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => {
                  setSelectedId(a.id);
                  setSelectedUrl(a.mediaUrl);
                  setPanelOpen(true);
                }}
                className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-accent transition-colors"
              >
                {mediaIcon(a.mediaUrl)}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {mediaPlatform(a.mediaUrl)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(a.submittedAt)}
                  </p>
                </div>

                <StatusBadge
                  status={a.feedbackCount > 0 ? "feedbackReady" : "feedbackWaiting"}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 상세 SlidePanel */}
      <SlidePanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title="과제 상세"
        size="lg"
      >
        {selectedId && (
          <AssignmentDetailPanel
            assignmentId={selectedId}
            mediaUrl={selectedUrl}
          />
        )}
      </SlidePanel>
    </div>
  );
}
