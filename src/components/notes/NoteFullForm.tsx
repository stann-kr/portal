/**
 * @file src/components/notes/NoteFullForm.tsx
 * @description 노트 작성 풀 페이지 클라이언트 폼.
 * 서버 컴포넌트에서 createPrivateNote.bind(null, studentId)로 바인딩된 action을 받아 사용.
 */
"use client";

import { useActionState, useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { CalendarDays, ChevronLeft, Trash2, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NOTE_DATE_INPUT_CLASS,
  NOTE_TITLE_FIELD_CLASS,
  NoteDocumentBody,
  NoteProperties,
  NoteProperty,
  resolveNoteParent,
} from "./NoteDocumentChrome";
import type { CreateNoteState } from "@/lib/actions/privateNotes";
import { AutosaveStatus } from "@/components/editor/AutosaveStatus";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import {
  isCreateNoteDraftEmpty,
  resolveRestoredCreateNoteDate,
} from "@/lib/note-draft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { useDocumentAutosave } from "@/lib/hooks/useDocumentAutosave";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import {
  CREATION_OPERATION_FIELD,
  createCreationOperationId,
  parseCreationOperationId,
} from "@/lib/creation-operation";
import { CreationConflictActions } from "@/components/editor/CreationConflictActions";
import { resolveNoteCreateDefaultDate } from "@/lib/note-create-route";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false }
);

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

type CreateNoteDraft = {
  operationId?: string;
  title: string;
  noteDate: string;
  contentHtml: string;
};

export function NoteFullForm(props: NoteFullFormProps) {
  return <NoteFullFormContent key={`${props.actorId}:${props.studentId}`} {...props} />;
}

function NoteFullFormContent({ action, actorId, studentId, returnTo, defaultDate, defaultTitle = "", spaceLabel, authorName }: NoteFullFormProps) {
  const initialDefaultDate = resolveNoteCreateDefaultDate(defaultDate, new Date());
  const [title, setTitle] = useState(defaultTitle);
  const [noteDate, setNoteDate] = useState(initialDefaultDate);
  const {
    contentHtml,
    contentVersion,
    setContentHtml,
    handleEditorChange,
    handleEditorDirty,
    readLatestContentHtml,
    commitLatestContentHtml,
  } = useDeferredEditorContent("");
  const [operationId, setOperationId] = useState("");
  const defaultNoteDateRef = useRef(initialDefaultDate);
  // 주소에서 받은 기본 제목이 지금 화면의 출발점인지. 복원한 초안의 제목은 기본값으로 보지 않는다.
  const defaultTitleRef = useRef("");
  const [state, formAction, isPending] = useActionState<CreateNoteState, FormData>(
    async (previous, data) => {
      try {
        return await action(previous, data);
      } catch {
        return { error: "저장 결과를 확인하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요." };
      }
    },
    {}
  );
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const contentHtmlInputRef = useRef<HTMLInputElement>(null);
  const submittedDraftRef = useRef<CreateNoteDraft | null>(null);
  const handledNoteIdRef = useRef<string | null>(null);
  const router = useProgressRouter();
  useBusyNavigationGuard(isPending);
  // 본문 이미지가 올라가는 동안 새 노트를 만들면 문서 페이지로 넘어가며 남은 이미지가 빠진다.
  const [isEditorUploading, setIsEditorUploading] = useState(false);

  const {
    loaded,
    canSubmit,
    save,
    clear,
    flush,
    status,
    savedAt,
    restored,
    recoveries,
    restoreRecovery,
    discardRecovery,
    serverSync,
  } = useSyncedFormDraft<CreateNoteDraft>(
    createDocumentDraftKey("note", actorId, `new:${studentId}`),
    (draft) => {
      setOperationId(
        parseCreationOperationId(draft.operationId) ?? createCreationOperationId(),
      );
      defaultTitleRef.current = "";
      setTitle(draft.title ?? "");
      setNoteDate(
        resolveRestoredCreateNoteDate(
          draft.noteDate,
          defaultNoteDateRef.current,
        ),
      );
      setContentHtml(draft.contentHtml ?? "");
    },
    {
      onReset: () => {
        defaultNoteDateRef.current = initialDefaultDate;
        setOperationId(createCreationOperationId());
        // 저장된 초안이 없을 때도 이 경로로 시작하므로 주소의 제목·날짜를 기본값으로 둔다.
        defaultTitleRef.current = defaultTitle;
        setTitle(defaultTitle);
        setNoteDate(initialDefaultDate);
        setContentHtml("");
      },
    },
  );

  const handleSaveShortcut = useDocumentSaveShortcut({
    disabled: !loaded || !canSubmit || isPending || !operationId,
    onSave: () => formRef.current?.requestSubmit(),
  });

  useEffect(() => {
    if (!loaded) return;
    const latestContentHtml = readLatestContentHtml();
    if (
      isCreateNoteDraftEmpty(
        { title, noteDate, contentHtml: latestContentHtml },
        defaultNoteDateRef.current,
        defaultTitleRef.current,
      )
    ) {
      clear();
      return;
    }
    if (!operationId) return;
    save({
      operationId,
      title,
      noteDate,
      get contentHtml() {
        return readLatestContentHtml();
      },
    });
  }, [
    clear,
    contentHtml,
    loaded,
    noteDate,
    operationId,
    readLatestContentHtml,
    save,
    title,
  ]);

  useEffect(() => {
    if (!state.note?.id || handledNoteIdRef.current === state.note.id) return;
    handledNoteIdRef.current = state.note.id;
    clear({
      reason: "submitted",
      submittedData: submittedDraftRef.current ?? {
        operationId,
        title,
        noteDate,
        contentHtml,
      },
    });
    submittedDraftRef.current = null;
    // 만든 노트 페이지에서 본문 끝에 커서를 두고 이어서 쓰게 한다.
    router.replace(`/dashboard/notes/${state.note.id}?returnTo=${encodeURIComponent(returnTo)}&focus=end`);
  }, [clear, contentHtml, noteDate, operationId, returnTo, router, state.note?.id, title]);

  const hasOperationConflict = Boolean(
    state.operationConflict &&
    state.conflictedOperationId === operationId &&
    state.existingId,
  );


  const titleRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [title]);
  const changeKey = `${title}\u0000${noteDate}\u0000${contentHtml}`;
  const submittedKeyRef = useRef("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(() => {
    if (state.error) setFailedKey(submittedKeyRef.current);
  }, [state]);
  const missingRequired = !title.trim() || isRichTextEmpty(contentHtml);
  useDocumentAutosave({
    enabled:
      loaded && canSubmit && !isPending && Boolean(operationId) && !missingRequired &&
      !hasOperationConflict && failedKey !== changeKey && !state.note?.id && !isEditorUploading,
    dirty: true,
    changeKey,
    onSave: () => formRef.current?.requestSubmit(),
  });
  const autosaveStatus = isPending || state.note?.id
    ? "saving"
    : state.error && failedKey === changeKey
      ? "error"
      : missingRequired ? "blocked" : "pending";

  // 실패 안내가 나타나면 긴 노트에서도 바로 보이게 초점을 옮긴다. 사용자가 폼 밖으로 옮긴 초점은 두고 간다.
  useEffect(() => {
    if (autosaveStatus !== "error") return;
    const activeElement = document.activeElement;
    if (activeElement === document.body || formRef.current?.contains(activeElement)) {
      errorRef.current?.focus();
    }
  }, [autosaveStatus, state]);

  const trashHref = `/dashboard/notes/trash?studentId=${encodeURIComponent(studentId)}&returnTo=${encodeURIComponent(returnTo)}`;
  const autosaveMessage = autosaveStatus === "error" ? state.error : "제목과 내용을 입력하면 자동으로 저장됩니다.";

  const parent = resolveNoteParent(returnTo);

  return (
    <div>
      {/* 좁은 화면 위쪽 막대의 뒤로도 노트를 연 화면(returnTo)으로 돌아간다. */}
      <MobileTopBar title="새 노트" back={{ href: returnTo, label: parent.backLabel }} />
      {/* 위쪽 줄(NoteNew 보드): 넓은 화면은 돌아가기·저장 상태·스페이스·휴지통, 좁은 화면은 셸 위쪽 막대가 뒤로를 맡아 상태·휴지통만 둔다. */}
      <div className="flex h-11 items-center justify-between gap-3 border-b border-muted px-5 md:sticky md:top-0 md:z-20 md:h-[52px] md:bg-background md:px-6">
        <Link
          href={returnTo}
          aria-disabled={isPending}
          tabIndex={isPending ? -1 : undefined}
          className={cn(
            "-ml-1 hidden h-8 shrink-0 items-center gap-1.5 rounded-md pl-1 pr-2 text-ui text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex",
            isPending && "pointer-events-none opacity-50",
          )}
          onClick={(event) => {
            if (isPending) event.preventDefault();
          }}
        >
          <ChevronLeft className="size-4" strokeWidth={1.8} aria-hidden="true" />
          돌아가기
        </Link>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 md:flex-none md:justify-end">
          <AutosaveStatus
            variant="bar"
            status={autosaveStatus}
            message={autosaveMessage}
            shortMessage="저장 대기"
          />
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

      <form
        ref={formRef}
        action={formAction}
        aria-busy={!loaded || isPending}
        onKeyDownCapture={handleSaveShortcut}
        onSubmit={(event) => {
          if (!loaded || !canSubmit || isPending || !operationId || isEditorUploading) {
            event.preventDefault();
            return;
          }
          const latestContentHtml = commitLatestContentHtml();
          if (!title.trim() || isRichTextEmpty(latestContentHtml)) {
            event.preventDefault();
            return;
          }
          submittedKeyRef.current = `${title}\u0000${noteDate}\u0000${latestContentHtml}`;
          if (contentHtmlInputRef.current) {
            contentHtmlInputRef.current.value = latestContentHtml;
          }
          const submittedDraft = {
            operationId,
            title,
            noteDate,
            contentHtml: latestContentHtml,
          };
          save({
            operationId,
            title,
            noteDate,
            get contentHtml() {
              return readLatestContentHtml();
            },
          });
          flush();
          submittedDraftRef.current = submittedDraft;
        }}
      >
        <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
        <input ref={contentHtmlInputRef} type="hidden" name="contentHtml" value={contentHtml} />

        <NoteDocumentBody>
          <h1 className="sr-only">새 노트</h1>
          <textarea
            ref={titleRef}
            id="note-title"
            name="title"
            aria-label="제목"
            rows={1}
            placeholder="제목 없음"
            required
            maxLength={200}
            disabled={!loaded || isPending}
            value={title}
            onChange={(event) => setTitle(event.target.value.replace(/\n/gu, " "))}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              formRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
            }}
            className={NOTE_TITLE_FIELD_CLASS}
          />
          <NoteProperties>
            <NoteProperty icon={CalendarDays} label="날짜" htmlFor="note-date" tall>
              <input
                id="note-date"
                name="noteDate"
                type="date"
                value={noteDate}
                onChange={(event) => setNoteDate(event.target.value)}
                disabled={!loaded || isPending}
                className={NOTE_DATE_INPUT_CLASS}
              />
            </NoteProperty>
            {authorName ? <NoteProperty icon={UserRound} label="작성자" tall>{authorName}</NoteProperty> : null}
          </NoteProperties>

          {autosaveStatus === "error" ? (
            <AutosaveStatus
              alertRef={errorRef}
              status="error"
              message={autosaveMessage}
              onRetry={() => formRef.current?.requestSubmit()}
            />
          ) : null}

          {hasOperationConflict && state.existingId ? (
            <CreationConflictActions
              existingHref={`/dashboard/notes/${state.existingId}?returnTo=${encodeURIComponent(returnTo)}`}
              existingLabel="기존 노트 열기"
              separateLabel="별도 노트로 저장"
              onSeparate={() => setOperationId(createCreationOperationId())}
              disabled={isPending}
            />
          ) : null}

          {loaded ? (
            <FullEditor
              initialContent={contentHtml}
              contentVersion={contentVersion}
              onUploadingChange={setIsEditorUploading}
              onChange={handleEditorChange}
              onDirty={(reader) => {
                handleEditorDirty(reader);
                if (!operationId) return;
                save({
                  operationId,
                  title,
                  noteDate,
                  get contentHtml() {
                    return reader();
                  },
                });
              }}
              placeholder="수업 내용, 연습 기록, 메모 등을 자유롭게 작성하세요..."
              disabled={isPending}
              ariaLabel="노트 내용"
              variant="page"
              minHeight="320px"
              footer={
                <DraftStatus
                  status={status}
                  canSubmit={canSubmit}
                  savedAt={savedAt}
                  restored={restored}
                  recoveries={recoveries}
                  onRestoreRecovery={restoreRecovery}
                  onDiscardRecovery={discardRecovery}
                  serverSync={serverSync}
                  disabled={isPending}
                />
              }
              saveShortcutLabel={canSubmit ? "바로 저장" : undefined}
            />
          ) : null}
        </NoteDocumentBody>
      </form>
    </div>
  );
}
