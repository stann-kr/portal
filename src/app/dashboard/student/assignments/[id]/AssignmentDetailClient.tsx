"use client";

import { useState } from "react";
import { VideoPlayer, type MediaSeekRequest } from "@/components/player/VideoPlayer";
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

  const handleSeek = (seconds: number) => {
    setSeekRequest({ seconds });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
      <div className="lg:sticky lg:top-6">
        <VideoPlayer url={mediaUrl} seekRequest={seekRequest} />
      </div>
      <TimelineFeedback
        assignmentId={assignmentId}
        actorId={actorId}
        feedbackList={feedbackList}
        isAdmin={isAdmin}
        onSeek={handleSeek}
      />
    </div>
  );
}
