/**
 * @file src/components/student-portal/FreeSubmissionForm.tsx
 * @description 자유 제출(관리자 과제 없이 내는 제출) 생성·수정 공용 폼.
 * 링크(선택)와 글(선택) 두 칸이며 하나 이상이 필요하다. 쓰는 중인 값은 이 기기에 초안으로 남긴다.
 * 생성은 과제 화면, 수정은 피드백 전 본인 제출의 상세 화면에서 쓴다.
 */
"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import {
  submitAssignment,
  updateMyFreeSubmission,
  type SubmitAssignmentState,
} from "@/lib/actions/assignments";
import {
  ASSIGNMENT_TEXT_MAX_LENGTH,
  ASSIGNMENT_TEXT_MAX_LENGTH_LABEL,
  FREE_SUBMISSION_EMPTY_ERROR,
  htmlToPlainText,
} from "@/lib/assignment-submission";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { cn } from "@/lib/utils";

type FreeSubmissionDraft = { mediaUrl: string; text: string };

const TEXTAREA_CLASS =
  "min-h-32 w-full resize-y rounded-touch border border-input bg-background px-3 py-2 text-base leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:rounded-md md:text-body";

interface FreeSubmissionFormProps {
  /** 지금 학생(작성자) ID. 초안을 계정별로 격리한다. */
  actorId: string;
  /** 고칠 제출. 없으면 새 제출을 만든다. */
  submission?: { id: string; mediaUrl: string | null; textHtml: string | null } | null;
  /** 입력 id 접두어(라벨·도움말 연결용). */
  idPrefix: string;
  /** 새 제출 폼의 링크 칸(빈 상태에서 이 칸으로 이동한다). */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onDone: () => Promise<void> | void;
  /** 수정 폼의 닫기. */
  onCancel?: () => void;
  className?: string;
}

export function FreeSubmissionForm({
  actorId,
  submission = null,
  idPrefix,
  inputRef,
  onDone,
  onCancel,
  className,
}: FreeSubmissionFormProps) {
  const editing = submission !== null;
  const initial: FreeSubmissionDraft = {
    mediaUrl: submission?.mediaUrl ?? "",
    text: htmlToPlainText(submission?.textHtml),
  };
  const [mediaUrl, setMediaUrl] = useState(initial.mediaUrl);
  const [text, setText] = useState(initial.text);
  const [showResult, setShowResult] = useState(false);
  const [emptyError, setEmptyError] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const draft = useFormDraft<FreeSubmissionDraft>(
    createDocumentDraftKey("assignment-feedback", actorId, `free-submission:${submission?.id ?? "new"}`),
    (saved) => {
      setMediaUrl(typeof saved.mediaUrl === "string" ? saved.mediaUrl : initial.mediaUrl);
      setText(typeof saved.text === "string" ? saved.text : initial.text);
      setShowResult(false);
    },
    { onReset: () => { setMediaUrl(initial.mediaUrl); setText(initial.text); setShowResult(false); } },
  );
  const [state, action, isPending] = useActionState<SubmitAssignmentState, FormData>(async (previous, data) => {
    let result: SubmitAssignmentState;
    try {
      result = editing
        ? await updateMyFreeSubmission(submission.id, previous, data)
        : await submitAssignment(previous, data);
    } catch {
      return { error: "제출 결과를 확인하지 못했습니다. 목록을 새로고침해 확인한 뒤 다시 시도해 주세요." };
    }
    if (result.success) {
      const submittedData = { mediaUrl: String(data.get("mediaUrl") ?? ""), text: String(data.get("text") ?? "") };
      draft.clear({ reason: "submitted", submittedData, submittedAliases: [submittedData] });
      if (!editing) {
        setMediaUrl("");
        setText("");
        setSubmitted(true);
      }
      await onDone();
    }
    return result;
  }, {});
  useBusyNavigationGuard(isPending);

  const saveDraft = (next: FreeSubmissionDraft) => {
    setShowResult(false);
    setEmptyError(false);
    setSubmitted(false);
    if (next.mediaUrl !== initial.mediaUrl || next.text !== initial.text) draft.save(next);
    else draft.clear();
  };
  const mediaId = `${idPrefix}-media-url`;
  const textId = `${idPrefix}-text`;
  const headingId = `${idPrefix}-heading`;
  const disabled = !draft.loaded || isPending;
  const error = emptyError ? FREE_SUBMISSION_EMPTY_ERROR : showResult ? state.error : undefined;

  return (
    <form
      action={action}
      aria-labelledby={headingId}
      className={cn("flex flex-col gap-3", className)}
      onBlur={draft.flush}
      onSubmit={(event) => {
        if (!draft.loaded || !draft.canSubmit || isPending) {
          event.preventDefault();
          return;
        }
        if (!mediaUrl.trim() && !text.trim()) {
          event.preventDefault();
          setEmptyError(true);
          return;
        }
        draft.flush();
        setShowResult(true);
      }}
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-ui font-semibold text-secondary-foreground">
          {editing ? "제출 수정" : "새 제출"}
        </h2>
        <p className="text-xs leading-[18px] text-muted-foreground md:leading-4">
          링크나 글 중 하나 이상을 넣어 주세요.{editing ? "" : " 받은 과제와 별도로 자유롭게 제출합니다."}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={mediaId} className="text-xs text-muted-foreground">링크 (선택)</label>
        <Input
          ref={inputRef}
          id={mediaId}
          name="mediaUrl"
          type="url"
          placeholder="YouTube 또는 SoundCloud 링크 붙여넣기"
          value={mediaUrl}
          onChange={(event) => {
            setMediaUrl(event.target.value);
            saveDraft({ mediaUrl: event.target.value, text });
          }}
          disabled={disabled}
          aria-describedby={`${mediaId}-help`}
          className="h-12 px-3.5 md:h-10 md:px-3"
        />
        <p id={`${mediaId}-help`} className="text-xs leading-[18px] text-muted-foreground md:leading-4">
          YouTube 영상·Shorts·라이브와 SoundCloud 트랙·세트 링크를 지원합니다.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={textId} className="text-xs text-muted-foreground">글 (선택)</label>
        <textarea
          id={textId}
          name="text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            saveDraft({ mediaUrl, text: event.target.value });
          }}
          rows={5}
          maxLength={ASSIGNMENT_TEXT_MAX_LENGTH}
          placeholder="연습한 내용, 느낀 점, 질문을 적어 주세요."
          disabled={disabled}
          aria-describedby={`${textId}-help`}
          className={TEXTAREA_CLASS}
        />
        <p id={`${textId}-help`} className="text-xs text-muted-foreground">
          빈 줄로 문단을 나눕니다. {ASSIGNMENT_TEXT_MAX_LENGTH_LABEL}자까지 쓸 수 있습니다.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="touch"
          disabled={disabled || !draft.canSubmit}
          pending={isPending}
          className="max-md:flex-1 md:h-10 md:rounded-md md:px-[18px] md:text-body"
        >
          {isPending ? (editing ? "저장 중..." : "제출 중...") : editing ? "수정 저장" : "제출"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" size="touch" onClick={onCancel} disabled={isPending} className="md:h-10 md:rounded-md md:px-[18px] md:text-body">
            닫기
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : null}
      {submitted && !editing ? <p role="status" className="text-ui text-success">제출했습니다.</p> : null}
      <DraftStatus {...draft} onRestoreRecovery={draft.restoreRecovery} onDiscardRecovery={draft.discardRecovery} disabled={isPending} />
    </form>
  );
}
