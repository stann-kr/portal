"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  VideoPlayer,
  type MediaSeekRequest,
  type PlaybackPositionReader,
} from "@/components/player/VideoPlayer";
import { TimelineFeedback, type FeedbackItem } from "@/components/feedback/TimelineFeedback";
import { AssignmentDeleteAction } from "@/components/student-portal/AssignmentDeleteAction";

interface AssignmentDetailClientProps {
  assignmentId: string;
  actorId: string;
  mediaUrl: string;
  feedbackList: FeedbackItem[];
  isAdmin: boolean;
  /** 피드백 전 본인 제출을 삭제할 수 있을 때 삭제 뒤 돌아갈 경로. */
  deleteReturnTo?: string;
}

export function AssignmentDetailClient({
  assignmentId,
  actorId,
  mediaUrl,
  feedbackList,
  isAdmin,
  deleteReturnTo,
}: AssignmentDetailClientProps) {
  const router = useRouter();
  const [seekRequest, setSeekRequest] = useState<MediaSeekRequest>();
  const positionReaderRef = useRef<PlaybackPositionReader | null>(null);
  const handlePositionReaderChange = useCallback((reader: PlaybackPositionReader | null) => {
    positionReaderRef.current = reader;
  }, []);
  const readPlaybackPosition = useCallback(
    async () => (positionReaderRef.current ? positionReaderRef.current() : null),
    [],
  );

  const handleSeek = (seconds: number) => {
    setSeekRequest({ seconds });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
      <div className="lg:sticky lg:top-6">
        <VideoPlayer url={mediaUrl} seekRequest={seekRequest} onPositionReaderChange={handlePositionReaderChange} />
      </div>
      <div className="space-y-4">
        <TimelineFeedback
          assignmentId={assignmentId}
          actorId={actorId}
          feedbackList={feedbackList}
          isAdmin={isAdmin}
          onSeek={handleSeek}
          readPlaybackPosition={isAdmin ? readPlaybackPosition : undefined}
        />
        {deleteReturnTo && feedbackList.length === 0 ? (
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-xs text-muted-foreground">잘못 제출했다면 피드백이 달리기 전에 삭제할 수 있습니다.</p>
            <AssignmentDeleteAction
              assignmentId={assignmentId}
              onDeleted={() => {
                router.replace(deleteReturnTo);
                router.refresh();
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
