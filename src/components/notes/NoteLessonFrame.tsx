"use client";

import { useRef, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { InstructorLessonPanel, type InstructorLessonPanelProps } from "@/components/lesson/InstructorLessonPanel";
import { RecordingDock } from "@/components/lesson/RecordingDock";
import { Button } from "@/components/ui/button";

/** 관리자 화면에서만 서버가 넘기는 수업 도구 값. 노트 id는 화면(새 노트·문서)이 정한다. */
export type NoteInstructorTools = Omit<InstructorLessonPanelProps, "noteId" | "actorId" | "open" | "onClose">;

/** 위쪽 막대에 둘 "수업 도구" 버튼. 넓은 화면은 패널이 늘 옆에 있어 좁은 화면에만 보인다. */
export type NoteLessonToolsButton = (size: "touch" | "sm") => ReactNode;

/**
 * 노트 편집 화면(새 노트·문서) 옆에 관리자 수업 도구(타이머·비밀 메모)를 두고,
 * 누구에게나 본문의 녹음 링크로 [시점] 재생 칸을 보인다.
 */
export function NoteLessonFrame({
  noteId,
  actorId,
  instructor,
  children,
}: {
  /** null이면 아직 만들지 않은 새 노트다. */
  noteId: string | null;
  actorId: string;
  instructor?: NoteInstructorTools;
  children: (toolsButton: NoteLessonToolsButton) => ReactNode;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const toolsButton: NoteLessonToolsButton = (size) => instructor ? (
    <Button
      type="button"
      variant="ghost"
      size={size}
      className="xl:hidden"
      aria-expanded={toolsOpen}
      onClick={() => setToolsOpen((open) => !open)}
    >
      <Lock className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
      {/* 좁은 위쪽 막대는 아이콘만 둔다. */}
      <span className={size === "touch" ? "sr-only" : undefined}>수업 도구</span>
    </Button>
  ) : null;
  return (
    <>
      <div className="xl:flex xl:items-start">
        <div ref={contentRef} className="min-w-0 xl:flex-1">
          {children(toolsButton)}
        </div>
        {instructor ? (
          <InstructorLessonPanel
            {...instructor}
            noteId={noteId}
            actorId={actorId}
            open={toolsOpen}
            onClose={() => setToolsOpen(false)}
          />
        ) : null}
      </div>
      {/* 본문의 녹음 링크와 [시점]으로 수업 녹음을 다시 듣는다. 재생 칸은 찾는 범위(contentRef) 밖에 둔다. */}
      <RecordingDock rootRef={contentRef} />
    </>
  );
}
