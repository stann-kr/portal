/**
 * @file src/components/notes/NoteFullForm.tsx
 * @description 노트 작성 풀 페이지(NoteNew 보드)의 얇은 wrapper.
 * 서버 컴포넌트에서 createPrivateNote.bind(null, studentId)로 바인딩된 action을 받아 `NoteEditorForm`의 생성 모드에 넘긴다.
 * 첫 자동 저장이 노트를 만들면 같은 편집기가 제자리에서 수정 모드로 바뀌고, 이 wrapper는 위쪽 막대만 문서 배치로 바꾼다.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { NoteBreadcrumb, NoteDocumentStrip, NoteHistoryLink, resolveNoteParent } from "./NoteDocumentChrome";
import { updatePrivateNote, type CreateNoteState } from "@/lib/actions/privateNotes";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { DeleteNoteButton } from "./DeleteNoteButton";
import { NoteEditorForm } from "./NoteEditorForm";
import { formatNoteUpdated } from "./note-display";

interface NoteFullFormProps {
  /** createPrivateNote.bind(null, studentId) */
  action: (prev: CreateNoteState, formData: FormData) => Promise<CreateNoteState>;
  actorId: string;
  studentId: string;
  returnTo: string;
  /** 캘린더에서 선택한 날짜. 복구된 초안이 있으면 그 날짜가 우선한다. */
  defaultDate?: string;
  /** 캘린더 빠른 입력에서 넘어온 제목. 복구된 초안에 제목이 있으면 그 제목이 우선한다. */
  defaultTitle?: string;
  /** 작성 대상 학생 스페이스를 composer 상단에 명시한다. */
  spaceLabel?: string;
  /** 작성자(현재 계정) 이름. 주면 속성 줄에 보인다. */
  authorName?: string;
}

/** 생성 뒤 `history.replaceState`로 바뀐 문서 주소. 휴지통·작성 주소는 해당하지 않는다. */
const NOTE_DOCUMENT_PATH = /^\/dashboard\/notes\/(?!trash$)[^/]+$/u;

function isRestoredAtNoteDocumentPath(): boolean {
  return typeof window !== "undefined" && NOTE_DOCUMENT_PATH.test(window.location.pathname);
}

export function NoteFullForm({ action, actorId, studentId, returnTo, defaultDate, defaultTitle = "", spaceLabel, authorName }: NoteFullFormProps) {
  const router = useRouter();
  // 제자리 생성이 `history.replaceState`로 주소를 바꾸면 Next는 그 history 항목에 작성 화면 트리를 복사해 둔다.
  // 변경 이력 등으로 이동했다가 뒤로 오면 노트 주소에서 작성 화면이 복원되므로, 입력 전에 실제 문서 페이지로 바꾼다
  // (이때는 입력 중이 아니라 편집기 remount가 괜찮다). 그 사이에는 폼을 그리지 않아 두 번째 노트가 생기지 않는다.
  const [restoredAtDocumentPath] = useState(isRestoredAtNoteDocumentPath);
  useEffect(() => {
    if (!restoredAtDocumentPath) return;
    const { pathname, search, hash } = window.location;
    router.replace(`${pathname}${search}${hash}`);
  }, [restoredAtDocumentPath, router]);
  // 생성 전에는 "수정" 줄이 없고, 생성·저장 응답의 시각으로 채운다(revalidate 없이).
  const [updatedLabel, setUpdatedLabel] = useState<string | null>(null);
  const parent = resolveNoteParent(returnTo);
  const trashHref = `/dashboard/notes/trash?studentId=${encodeURIComponent(studentId)}&returnTo=${encodeURIComponent(returnTo)}`;

  if (restoredAtDocumentPath) {
    return <p className="px-5 py-4 text-ui text-muted-foreground" role="status">노트를 다시 여는 중입니다.</p>;
  }

  return (
    <NoteEditorForm
      actorId={actorId}
      create={{
        studentId,
        action,
        updateAction: (noteId, previous, formData) => updatePrivateNote(noteId, previous, formData),
        defaultTitle,
        defaultDate,
        returnTo,
      }}
      onSaved={(saved) => {
        if (saved.updatedAt) setUpdatedLabel(formatNoteUpdated(saved.updatedAt, Date.now()));
      }}
      document={{
        authorName,
        updatedLabel,
        renderBars: ({ status, title, noteId, version, busy }) => {
          if (noteId) {
            // 만든 뒤에는 문서 페이지(NoteDoc·MobileNoteDoc 보드)와 같은 위치 줄·변경 이력·더 보기.
            const historyHref = `/dashboard/notes/${noteId}/history?returnTo=${encodeURIComponent(returnTo)}`;
            return (
              <>
                <MobileTopBar
                  hideTitle
                  back={{ href: parent.href, label: parent.backLabel }}
                  actions={
                    <>
                      {status}
                      <NoteHistoryLink href={historyHref} compact />
                      <DeleteNoteButton noteId={noteId} version={version} presentation="menu" size="touch" />
                    </>
                  }
                />
                <NoteDocumentStrip start={<NoteBreadcrumb parent={parent} current={title} />}>
                  {status}
                  <NoteHistoryLink href={historyHref} />
                  <DeleteNoteButton noteId={noteId} version={version} presentation="menu" />
                </NoteDocumentStrip>
              </>
            );
          }
          return (
            <>
              {/* 좁은 화면 위쪽 막대의 뒤로도 노트를 연 화면(returnTo)으로 돌아간다. */}
              <MobileTopBar title="새 노트" back={{ href: returnTo, label: parent.backLabel }} />
              {/* 위쪽 줄(NoteNew 보드): 넓은 화면은 돌아가기·저장 상태·스페이스·휴지통, 좁은 화면은 셸 위쪽 막대가 뒤로를 맡아 상태·휴지통만 둔다. */}
              <div className="flex h-11 items-center justify-between gap-3 border-b border-muted px-5 md:sticky md:top-0 md:z-20 md:h-[52px] md:bg-background md:px-6">
                <Link
                  href={returnTo}
                  aria-disabled={busy}
                  tabIndex={busy ? -1 : undefined}
                  className={cn(
                    "-ml-1 hidden h-8 shrink-0 items-center gap-1.5 rounded-md pl-1 pr-2 text-ui text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex",
                    busy && "pointer-events-none opacity-50",
                  )}
                  onClick={(event) => {
                    if (busy) event.preventDefault();
                  }}
                >
                  <ChevronLeft className="size-4" strokeWidth={1.8} aria-hidden="true" />
                  돌아가기
                </Link>
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3 md:flex-none md:justify-end">
                  {status}
                  <div className="flex shrink-0 items-center gap-3">
                    {spaceLabel ? <p className="hidden text-xs text-muted-foreground md:block">{spaceLabel}</p> : null}
                    <Link
                      href={trashHref}
                      aria-label="휴지통"
                      className="-mr-2 inline-flex size-11 items-center justify-center gap-1.5 rounded-touch text-ui text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:mr-0 md:h-8 md:w-auto md:rounded-md md:px-2.5"
                    >
                      <Trash2 className="size-[18px] md:size-3.5" strokeWidth={1.6} aria-hidden="true" />
                      <span className="hidden md:inline">휴지통</span>
                    </Link>
                  </div>
                </div>
              </div>
            </>
          );
        },
      }}
    />
  );
}
