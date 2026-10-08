"use client";

import { useCallback, useRef, useState } from "react";
import {
  VideoPlayer,
  type MediaSeekRequest,
  type PlaybackPositionReader,
} from "@/components/player/VideoPlayer";
import { TimelineFeedback, type FeedbackItem } from "@/components/feedback/TimelineFeedback";

interface AssignmentDetailClientProps {
  assignmentId: string;
  actorId: string;
  mediaUrl: string;
  feedbackList: FeedbackItem[];
  isAdmin: boolean;
}

export function AssignmentDetailClient({
  assignmentId,
  actorId,
  mediaUrl,
  feedbackList,
  isAdmin,
}: AssignmentDetailClientProps) {
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
      <TimelineFeedback
        assignmentId={assignmentId}
        actorId={actorId}
        feedbackList={feedbackList}
        isAdmin={isAdmin}
        onSeek={handleSeek}
        readPlaybackPosition={isAdmin ? readPlaybackPosition : undefined}
      />
    </div>
  );
}
