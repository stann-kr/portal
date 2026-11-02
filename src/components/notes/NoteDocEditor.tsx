"use client";

import { useRef, useState } from "react";
import { Lock } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { InstructorLessonPanel, type InstructorLessonPanelProps } from "@/components/lesson/InstructorLessonPanel";
import { RecordingDock } from "@/components/lesson/RecordingDock";
import { Button } from "@/components/ui/button";
import type { UpdateNoteState } from "@/lib/actions/privateNotes";
import { DeleteNoteButton } from "./DeleteNoteButton";
import { NoteBreadcrumb, NoteDocumentStrip, NoteHistoryLink, type NoteParent } from "./NoteDocumentChrome";
import { NoteEditorForm } from "./NoteEditorForm";
import { formatNoteUpdated } from "./note-display";

/**
 * 노트 문서 편집 화면(NoteDoc·MobileNoteDoc 보드). 넓은 화면은 위치·저장 상태·변경 이력·더 보기 줄을,
 * 좁은 화면은 셸 위쪽 막대를 뒤로·저장 상태·변경 이력·더 보기로 덮어쓴다.
 * 셸 위쪽 막대를 쓰는 조립은 이 화면에만 두고, `NoteEditorForm`은 캘린더 패널에서도 그대로 쓰도록 셸에 의존하지 않는다.
 * 관리자에게는 수업 도구(타이머·비밀 메모)를 옆에 두고, 누구에게나 본문의 녹음 링크로 [시점] 재생 칸을 보인다.
 */
export function NoteDocEditor({
  note,
  actorId,
  action,
  focusBodyEnd,
  parent,
  historyHref,
  authorName,
  updatedLabel: initialUpdatedLabel,
  instructor,
}: {
  note: { id: string; title: string; contentHtml: string; noteDate: Date | null; version: number };
  actorId: string;
  action: (previous: UpdateNoteState, formData: FormData) => Promise<UpdateNoteState>;
  focusBodyEnd?: boolean;
  /** 돌아갈 화면(위치 줄의 상위 항목·좁은 화면 뒤로). */
  parent: NoteParent;
  historyHref: string;
  authorName: string;
  updatedLabel: string;
  /** 관리자 화면에서만 서버가 넘긴다. 학생에게는 수업 도구와 메모를 그리지 않는다. */
  instructor?: Omit<InstructorLessonPanelProps, "noteId" | "actorId" | "open" | "onClose">;
}) {
  // 자동 저장은 route를 다시 렌더하지 않으므로 "수정" 줄은 저장 응답의 시각으로 여기서 맞춘다.
  const [updatedLabel, setUpdatedLabel] = useState(initialUpdatedLabel);
  const [toolsOpen, setToolsOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // 넓은 화면은 패널이 늘 옆에 있으므로 여는 버튼은 좁은 화면에만 둔다.
  const toolsButton = (size: "touch" | "sm") => instructor ? (
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
          <NoteEditorForm
            note={note}
            actorId={actorId}
            action={action}
            focusBodyEnd={focusBodyEnd}
            onSaved={(saved) => {
              if (saved.updatedAt) setUpdatedLabel(formatNoteUpdated(saved.updatedAt, Date.now()));
            }}
            document={{
              authorName,
              updatedLabel,
              renderBars: ({ status, title, version }) => (
                <>
                  <MobileTopBar
                    hideTitle
                    back={{ href: parent.href, label: parent.backLabel }}
                    actions={
                      <>
                        {status}
                        {toolsButton("touch")}
                        <NoteHistoryLink href={historyHref} compact />
                        <DeleteNoteButton noteId={note.id} version={version ?? note.version} presentation="menu" size="touch" />
                      </>
                    }
                  />
                  <NoteDocumentStrip start={<NoteBreadcrumb parent={parent} current={title} />}>
                    {status}
                    {toolsButton("sm")}
                    <NoteHistoryLink href={historyHref} />
                    <DeleteNoteButton noteId={note.id} version={version ?? note.version} presentation="menu" />
                  </NoteDocumentStrip>
                </>
              ),
            }}
          />
        </div>
        {instructor ? (
          <InstructorLessonPanel
            {...instructor}
            noteId={note.id}
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
