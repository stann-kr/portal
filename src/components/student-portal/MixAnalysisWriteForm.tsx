/**
 * @file src/components/student-portal/MixAnalysisWriteForm.tsx
 * @description 믹스셋 분석 쓰기(AnalysisWrite·MobileAnalysisWrite 보드).
 * 넓은 화면은 [링크·플레이어 | 평점·추천·한줄평·시점 메모], 좁은 화면은 플레이어를 위에 고정하고
 * "지금 위치 추가"와 "제출"을 아래 막대에 둔다. 쓰는 내용은 이 기기에 임시 저장되고(이탈 보호 포함),
 * 시점 메모는 제출할 때 시점 순으로 정렬된다(서버 검증과 같은 규칙).
 */
"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { Plus, Star, X } from "lucide-react";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { VideoPlayer, type PlaybackPositionReader } from "@/components/player/VideoPlayer";
import { mediaSourceLabel } from "@/components/player/media-source";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  submitAssignmentTask,
  updateMyTaskSubmission,
  type AssignmentTaskActionState,
  type AssignmentTaskItem,
} from "@/lib/actions/assignmentTasks";
import { normalizeAssignmentMediaUrl } from "@/lib/assignment-media-url";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import {
  MIX_ANALYSIS_MEMO_MAX_LENGTH,
  MIX_ANALYSIS_ONE_LINER_MAX_LENGTH,
  formatAnalysisClock,
  mediaUrlAt,
  mixAnalysisToDraft,
  parseStoredMixAnalysis,
  type MixAnalysisDraft,
} from "@/lib/mix-analysis";
import { cn } from "@/lib/utils";
import { AssignmentBrief } from "@/components/student-portal/AssignmentBrief";

type Entry = { key: string; at: string; memo: string };
type WriteDraft = { mediaUrl: string; analysis: MixAnalysisDraft };
type FormState = Omit<MixAnalysisDraft, "entries"> & { mediaUrl: string; entries: Entry[] };

/** 지금 위치 줄 추가 단축키(Alt/Option+M). 피드백의 "시점 찍어 두기"와 같은 키다. */
const ADD_NOW_SHORTCUT_CODE = "KeyM";

let entryKeySeed = 0;
function nextEntryKey(): string {
  entryKeySeed += 1;
  return `entry-${entryKeySeed}`;
}

function withKeys(entries: MixAnalysisDraft["entries"]): Entry[] {
  return entries.map((entry) => ({ key: nextEntryKey(), at: entry.at, memo: entry.memo }));
}

function toForm(value: WriteDraft): FormState {
  return { mediaUrl: value.mediaUrl, ...value.analysis, entries: withKeys(value.analysis.entries) };
}

function toDraft(form: FormState): WriteDraft {
  return {
    mediaUrl: form.mediaUrl,
    analysis: {
      rating: form.rating,
      recommended: form.recommended,
      oneLiner: form.oneLiner,
      entries: form.entries.map(({ at, memo }) => ({ at, memo })),
    },
  };
}

function readDraftEntries(value: unknown): MixAnalysisDraft["entries"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { at, memo } = entry as Record<string, unknown>;
    return [{ at: typeof at === "string" ? at : "", memo: typeof memo === "string" ? memo : "" }];
  });
}

export function MixAnalysisWriteForm({
  task,
  actorId,
  dueLabel,
  backHref,
}: {
  task: AssignmentTaskItem;
  actorId: string;
  dueLabel: string;
  /** 과제 목록. 닫기와 제출 뒤 상세 화면의 돌아가기가 여기로 간다. */
  backHref: string;
}) {
  const router = useProgressRouter();
  const submission = task.submission;
  const editing = submission !== null;
  const [initial] = useState<WriteDraft>(() => ({
    mediaUrl: submission?.mediaUrl ?? "",
    analysis: mixAnalysisToDraft(parseStoredMixAnalysis(submission?.analysisJson)),
  }));
  const [form, setFormState] = useState<FormState>(() => toForm(initial));
  // 재생 위치를 읽는 동안(await) 쓴 글자를 잃지 않도록 변경은 항상 마지막 값에서 이어 만든다.
  const formRef = useRef(form);
  const setForm = (next: FormState) => {
    formRef.current = next;
    setFormState(next);
  };
  const { mediaUrl, rating, recommended, oneLiner, entries } = form;
  const [showResult, setShowResult] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingLink, setEditingLink] = useState(false);
  // 재생이 막힌 링크. 링크를 바꾸면 그 링크로 다시 판단한다.
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const focusKeyRef = useRef<string | null>(null);

  const applyDraft = (value: WriteDraft) => {
    setForm(toForm(value));
    setShowResult(false);
  };
  const draft = useFormDraft<WriteDraft>(
    createDocumentDraftKey("assignment-feedback", actorId, `analysis:${task.id}`),
    (saved) => {
      const analysis = saved.analysis && typeof saved.analysis === "object" ? saved.analysis : initial.analysis;
      applyDraft({
        mediaUrl: typeof saved.mediaUrl === "string" ? saved.mediaUrl : initial.mediaUrl,
        analysis: {
          rating: typeof analysis.rating === "number" && analysis.rating >= 1 && analysis.rating <= 5 ? analysis.rating : null,
          recommended: analysis.recommended === true,
          oneLiner: typeof analysis.oneLiner === "string" ? analysis.oneLiner : "",
          entries: readDraftEntries(analysis.entries),
        },
      });
    },
    { onReset: () => applyDraft(initial) },
  );

  const update = (patch: Partial<FormState> | ((previous: FormState) => Partial<FormState>)) => {
    const previous = formRef.current;
    const next = { ...previous, ...(typeof patch === "function" ? patch(previous) : patch) };
    setForm(next);
    setShowResult(false);
    const nextDraft = toDraft(next);
    if (JSON.stringify(nextDraft) === JSON.stringify(initial)) draft.clear();
    else draft.save(nextDraft);
  };
  const updateEntry = (key: string, patch: Partial<Entry>) => update((previous) => ({
    entries: previous.entries.map((item) => (item.key === key ? { ...item, ...patch } : item)),
  }));

  const [state, action, isPending] = useActionState<AssignmentTaskActionState, FormData>(async (previous, data) => {
    let result: AssignmentTaskActionState;
    try {
      result = editing
        ? await updateMyTaskSubmission(submission.id, previous, data)
        : await submitAssignmentTask(task.id, previous, data);
    } catch {
      return { error: "제출 결과를 확인하지 못했습니다. 과제 목록을 새로고침해 확인한 뒤 다시 시도해 주세요." };
    }
    if (result.success && result.id) {
      const submitted = toDraft(formRef.current);
      draft.clear({ reason: "submitted", submittedData: submitted, submittedAliases: [submitted] });
      router.replace(`/dashboard/student/assignments/${encodeURIComponent(result.id)}?returnTo=${encodeURIComponent(backHref)}`);
      router.refresh();
    }
    return result;
  }, {});
  useBusyNavigationGuard(isPending);

  // 링크가 재생 가능한 형식일 때만 플레이어를 띄운다(입력 중 글자마다 다시 만들지 않도록 정규화한 주소로 판단).
  const media = normalizeAssignmentMediaUrl(mediaUrl);
  const playableUrl = media.ok ? media.url : null;
  const playbackBlocked = playableUrl !== null && blockedUrl === playableUrl;
  const positionReaderRef = useRef<PlaybackPositionReader | null>(null);
  const handlePositionReaderChange = useCallback((reader: PlaybackPositionReader | null) => {
    positionReaderRef.current = reader;
  }, []);
  const handlePlaybackError = useCallback(() => setBlockedUrl(playableUrl), [playableUrl]);

  // 새 줄을 만든 뒤 그 줄 메모 칸으로 옮겨 바로 쓰게 한다.
  useEffect(() => {
    const key = focusKeyRef.current;
    if (!key) return;
    focusKeyRef.current = null;
    document.getElementById(`analysis-memo-${key}`)?.focus();
  }, [entries]);

  const addEntry = (at: string) => {
    const entry = { key: nextEntryKey(), at, memo: "" };
    focusKeyRef.current = entry.key;
    update((previous) => ({ entries: [...previous.entries, entry] }));
  };
  const addNow = async () => {
    setNotice(null);
    const reader = positionReaderRef.current;
    const seconds = reader ? await reader().catch(() => null) : null;
    if (seconds === null) {
      setNotice("재생 위치를 읽지 못했습니다. 플레이어를 재생한 뒤 다시 누르거나, 시점을 직접 적어 주세요.");
      return;
    }
    addEntry(formatAnalysisClock(seconds));
  };
  const addNowRef = useRef(addNow);
  useEffect(() => {
    addNowRef.current = addNow;
  });
  const canAddNow = Boolean(playableUrl) && !playbackBlocked;
  useEffect(() => {
    if (!canAddNow) return;
    const handle = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.isComposing) return;
      if (event.code !== ADD_NOW_SHORTCUT_CODE) return;
      event.preventDefault();
      void addNowRef.current();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [canAddNow]);

  const disabled = !draft.loaded || isPending;
  const showLinkInput = !playableUrl || editingLink;
  const analysisValue = JSON.stringify(toDraft(form).analysis);
  const addNowLabel = "지금 위치로 한 줄 추가";

  const linkField = (
    <div className={cn("flex flex-col gap-1.5 max-md:px-5 max-md:pt-4", !showLinkInput && "max-md:hidden")}>
      <label htmlFor="analysis-media-url" className="text-ui font-semibold text-secondary-foreground">믹스셋 링크</label>
      <Input
        id="analysis-media-url"
        name="mediaUrl"
        type="url"
        placeholder="YouTube 또는 SoundCloud 링크"
        value={mediaUrl}
        onChange={(event) => update({ mediaUrl: event.target.value })}
        required
        disabled={disabled}
      />
    </div>
  );

  return (
    <form
      action={action}
      aria-label={`${task.title} ${editing ? "분석 수정" : "분석 쓰기"}`}
      className="flex flex-col md:flex-row md:flex-wrap md:items-start md:gap-10"
      onBlur={draft.flush}
      onSubmit={(event) => {
        if (!draft.loaded || !draft.canSubmit || isPending) {
          event.preventDefault();
          return;
        }
        draft.flush();
        setShowResult(true);
      }}
    >
      <input type="hidden" name="analysis" value={analysisValue} />

      {/* 좁은 화면 머리(넓은 화면은 페이지가 위치·제목을 그린다). 플레이어는 order로 이 위에 놓인다. */}
      <div className="flex flex-col gap-0.5 px-5 pt-4 md:hidden">
        <h1 className="text-xl font-semibold tracking-title">{task.title}</h1>
        <p className="text-ui text-muted-foreground">
          {dueLabel}
          {playableUrl && !editingLink ? (
            <>
              {" · 링크를 바꾸려면 "}
              <button type="button" onClick={() => setEditingLink(true)} className="inline-flex h-11 items-center text-secondary-foreground underline underline-offset-[3px]">
                링크 고치기
              </button>
            </>
          ) : null}
        </p>
        {task.descriptionHtml ? <AssignmentBrief html={task.descriptionHtml} open className="mt-3" /> : null}
      </div>

      {/* 왼쪽(좁은 화면은 위): 링크·플레이어·지금 위치 추가. 좁은 화면은 묶음이 사라져(contents) 플레이어가 맨 위로 간다. */}
      <div className="flex min-w-0 flex-col gap-3 max-md:contents md:sticky md:top-6 md:flex-[3_1_520px]">
        {linkField}
        {playableUrl ? (
          <div className="max-md:sticky max-md:top-[3.25rem] max-md:z-20 max-md:-order-1 max-md:bg-background">
            <VideoPlayer
              url={playableUrl}
              onPositionReaderChange={handlePositionReaderChange}
              onPlaybackError={handlePlaybackError}
              errorNotice={(
                <p role="status" className="px-5 text-ui leading-5 text-secondary-foreground md:px-0">
                  올린 사람이 다른 사이트에서 재생하지 못하게 막아 둔 영상입니다.{" "}
                  <a href={mediaUrlAt(playableUrl, 0)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-[3px] hover:text-foreground">
                    {mediaSourceLabel(playableUrl)}에서 열기
                  </a>
                  {" "}· 시점은 직접 적어 주세요.
                </p>
              )}
            />
          </div>
        ) : null}
        <div className="hidden flex-wrap items-center gap-2.5 md:flex">
          <Button type="button" variant="outline" onClick={addNow} disabled={disabled || !canAddNow} aria-keyshortcuts="Alt+M">
            <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            {addNowLabel}
          </Button>
          <span className="text-xs text-muted-foreground">⌥M · 들으면서 누르면 그 시점이 적힌 줄이 생깁니다</span>
        </div>
        {notice ? <p role="status" className="text-xs text-muted-foreground max-md:px-5">{notice}</p> : null}
      </div>

      {/* 오른쪽(좁은 화면은 아래): 머리(좁은 화면)·평가·시점 메모·제출 */}
      <div className="flex min-w-0 flex-col gap-[18px] px-5 pt-4 md:flex-[2_1_340px] md:gap-6 md:px-0 md:pt-0">
        <div className="flex flex-col gap-[18px] md:gap-6">
          <div className="flex items-center justify-between gap-3 md:flex-col md:items-stretch md:gap-6">
            <fieldset className="flex flex-col gap-2" disabled={disabled}>
              <legend className="sr-only mb-2 text-ui font-semibold text-secondary-foreground md:not-sr-only">종합 평점</legend>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((value) => {
                  const filled = rating !== null && value <= rating;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-label={`평점 ${value}점`}
                      aria-pressed={rating === value}
                      onClick={() => update({ rating: rating === value ? null : value })}
                      className={cn(
                        "flex size-11 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:size-9",
                        filled ? "text-foreground" : "text-faint hover:text-secondary-foreground",
                      )}
                    >
                      <Star className="size-[22px]" fill={filled ? "currentColor" : "none"} strokeWidth={1.6} aria-hidden="true" />
                    </button>
                  );
                })}
                <span className="ml-2 hidden font-mono text-ui text-secondary-foreground md:inline">
                  {rating === null ? "– / 5" : `${rating} / 5`}
                </span>
              </div>
            </fieldset>
            <label className="flex min-h-11 items-center gap-2 text-body md:min-h-0 md:gap-2.5">
              <input
                type="checkbox"
                checked={recommended}
                onChange={(event) => update({ recommended: event.target.checked })}
                disabled={disabled}
                className="size-5 accent-primary md:size-[18px]"
              />
              추천 믹스
              <span className="hidden text-xs text-muted-foreground md:inline">다른 학생에게도 권하고 싶은 셋</span>
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="analysis-one-liner" className="text-ui font-semibold text-secondary-foreground">한줄평</label>
            <Input
              id="analysis-one-liner"
              type="text"
              value={oneLiner}
              maxLength={MIX_ANALYSIS_ONE_LINER_MAX_LENGTH}
              onChange={(event) => update({ oneLiner: event.target.value })}
              placeholder="이 셋을 한 문장으로"
              disabled={disabled}
            />
          </div>

          <section aria-labelledby="analysis-entries-write-heading" className="flex flex-col">
            <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
              <h2 id="analysis-entries-write-heading" className="text-ui font-semibold text-secondary-foreground">
                시점 메모 <span className="font-mono font-normal text-muted-foreground">{entries.length}</span>
              </h2>
              <span className="hidden text-xs text-muted-foreground md:inline">시점 순으로 정렬됩니다</span>
            </div>
            <ol>
              {entries.map((entry, index) => {
                const label = entry.at.trim() || "시점 없는";
                return (
                  <li key={entry.key} className="grid grid-cols-[68px_minmax(0,1fr)_44px] items-start gap-1.5 border-b border-muted py-2 md:grid-cols-[76px_minmax(0,1fr)_32px] md:gap-2 md:py-2.5">
                    <Input
                      aria-label={`${index + 1}번째 줄 시점`}
                      type="text"
                      inputMode="numeric"
                      placeholder="MM:SS"
                      value={entry.at}
                      onChange={(event) => updateEntry(entry.key, { at: event.target.value })}
                      disabled={disabled}
                      className="bg-accent px-2 font-mono font-medium text-highlight placeholder:text-highlight/40 md:h-8"
                    />
                    <textarea
                      id={`analysis-memo-${entry.key}`}
                      aria-label={`${label} 메모`}
                      rows={2}
                      value={entry.memo}
                      maxLength={MIX_ANALYSIS_MEMO_MAX_LENGTH}
                      onChange={(event) => updateEntry(entry.key, { memo: event.target.value })}
                      placeholder="이 구간에서 들린 것, 느낀 것"
                      disabled={disabled}
                      className="min-h-11 w-full resize-none rounded-touch [field-sizing:content] border border-input bg-background px-3 py-2.5 text-base leading-[22px] text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:min-h-8 md:resize-none md:rounded-md md:px-2.5 md:py-1.5 md:text-body md:leading-5"
                    />
                    <button
                      type="button"
                      aria-label={`${label} 줄 지우기`}
                      onClick={() => update((previous) => ({ entries: previous.entries.filter((item) => item.key !== entry.key) }))}
                      disabled={disabled}
                      className="flex size-11 items-center justify-center rounded-touch text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:size-8 md:rounded-md"
                    >
                      <X className="size-4 md:size-3.5" strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>
            <button
              type="button"
              onClick={() => addEntry("")}
              disabled={disabled}
              className="mt-2 inline-flex h-11 items-center self-start text-ui text-secondary-foreground underline underline-offset-[3px] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:h-8"
            >
              시점 없이 한 줄 추가
            </button>
          </section>

          {showResult && state.error ? <p role="alert" className="text-ui text-destructive">{state.error}</p> : null}
          <DraftStatus {...draft} onRestoreRecovery={draft.restoreRecovery} onDiscardRecovery={draft.discardRecovery} disabled={isPending} />

          {/* 넓은 화면 제출 줄 */}
          <div className="hidden items-center justify-between gap-3 border-t border-border pt-4 md:flex">
            <span className="text-xs text-muted-foreground">작성 중인 내용은 이 기기에 임시 저장됩니다.</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="lg" onClick={() => router.push(backHref)} disabled={isPending}>
                닫기
              </Button>
              <Button type="submit" size="lg" disabled={disabled || !draft.canSubmit} pending={isPending}>
                {isPending ? (editing ? "저장 중..." : "제출 중...") : editing ? "수정 저장" : "제출"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 좁은 화면 아래 막대: 지금 위치 추가 · 제출 */}
      <div className="sticky bottom-0 z-10 mt-4 grid grid-cols-[minmax(0,1fr)_96px] gap-2 border-t border-border bg-background px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2.5 md:hidden">
        <Button type="button" variant="outline" className="h-12 text-[15px]" onClick={addNow} disabled={disabled || !canAddNow}>
          <Plus className="size-4" strokeWidth={1.8} aria-hidden="true" />
          지금 위치 추가
        </Button>
        <Button type="submit" className="h-12 text-[15px]" disabled={disabled || !draft.canSubmit} pending={isPending}>
          {isPending ? "저장 중..." : editing ? "저장" : "제출"}
        </Button>
      </div>
    </form>
  );
}
