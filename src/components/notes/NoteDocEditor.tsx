"use client";

import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import type { UpdateNoteState } from "@/lib/actions/privateNotes";
import { DeleteNoteButton } from "./DeleteNoteButton";
import { NoteBreadcrumb, NoteDocumentStrip, NoteHistoryLink, type NoteParent } from "./NoteDocumentChrome";
import { NoteEditorForm } from "./NoteEditorForm";

/**
 * 노트 문서 편집 화면(NoteDoc·MobileNoteDoc 보드). 넓은 화면은 위치·저장 상태·변경 이력·더 보기 줄을,
 * 좁은 화면은 셸 위쪽 막대를 뒤로·저장 상태·변경 이력·더 보기로 덮어쓴다.
 * 셸 위쪽 막대를 쓰는 조립은 이 화면에만 두고, `NoteEditorForm`은 캘린더 패널에서도 그대로 쓰도록 셸에 의존하지 않는다.
 */
export function NoteDocEditor({
  note,
  actorId,
  action,
  focusBodyEnd,
  parent,
  historyHref,
  authorName,
  updatedLabel,
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
}) {
  return (
    <NoteEditorForm
      note={note}
      actorId={actorId}
      action={action}
      focusBodyEnd={focusBodyEnd}
      document={{
        authorName,
        updatedLabel,
        renderBars: ({ status, title }) => (
          <>
            <MobileTopBar
              hideTitle
              back={{ href: parent.href, label: parent.backLabel }}
              actions={
                <>
                  {status}
                  <NoteHistoryLink href={historyHref} compact />
                  <DeleteNoteButton noteId={note.id} version={note.version} presentation="menu" size="touch" />
                </>
              }
            />
            <NoteDocumentStrip start={<NoteBreadcrumb parent={parent} current={title} />}>
              {status}
              <NoteHistoryLink href={historyHref} />
              <DeleteNoteButton noteId={note.id} version={note.version} presentation="menu" />
            </NoteDocumentStrip>
          </>
        ),
      }}
    />
  );
}
