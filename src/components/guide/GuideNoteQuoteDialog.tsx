"use client";

/**
 * @file src/components/guide/GuideNoteQuoteDialog.tsx
 * @description 가이드에서 고른 글을 담을 노트를 고르는 패널(캔버스 GuideNoteQuote ②, 좁은 화면은 아래 시트 ⑤).
 * 설명은 여기서 쓰지 않는다. "넣고 노트 열기"를 누르면 노트로 이동하고, 노트 편집기가 맨 끝에 인용을 한 번 넣는다
 * (새 노트는 "가이드: <페이지>" 제목으로 인용이 든 채 만들어진다). 노트 편집기가 기기 보관·이탈 보호를 맡는다.
 * 관리자는 학생 또는 그룹을 먼저 고르고, 그 학생(그룹은 멤버 일부)에게 닫힌 페이지면 경고와 "함께 열기" 체크가 뜬다.
 */
import { useCallback, useEffect, useId, useState } from "react";
import { pushInApp } from "@/components/app-shell/NavigationProgress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getGuideQuoteDestinations,
  openGuidePageForQuote,
  type GuideQuoteDestinations,
  type GuideQuoteSpace,
} from "@/lib/actions/guideNoteQuote";
import { guidePagePath } from "@/lib/guide-content";
import { buildGuideNoteQuoteHtml, describeGuideQuote, guideQuoteNoteTitle } from "@/lib/guide-note-quote";
import { guideQuoteNoteHref, stashGuideQuote } from "@/lib/guide-note-quote-handoff";
import type { CollectedGuideQuote } from "@/lib/guide-note-quote-selection";
import { cn } from "@/lib/utils";

/** 처음 보이는 노트 수. 나머지는 "노트 더 보기". */
const VISIBLE_NOTES = 5;
const NEW_NOTE = "new";

export type GuideNoteQuoteDraft = { pageId: string; pageTitle: string; quote: CollectedGuideQuote };

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; value: GuideQuoteDestinations };

function spaceValue(space: GuideQuoteSpace): string {
  return `${space.kind}:${space.id}`;
}

function parseSpaceValue(value: string): GuideQuoteSpace | null {
  const [kind, ...rest] = value.split(":");
  const id = rest.join(":");
  return (kind === "student" || kind === "group") && id ? { kind, id } : null;
}

export function GuideNoteQuoteDialog({
  draft,
  isAdmin,
  onClose,
}: {
  draft: GuideNoteQuoteDraft | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {draft ? <GuideNoteQuoteDialogBody key={`${draft.pageId}:${draft.quote.blockId}`} draft={draft} isAdmin={isAdmin} onClose={onClose} /> : null}
    </Dialog>
  );
}

function GuideNoteQuoteDialogBody({ draft, isAdmin, onClose }: { draft: GuideNoteQuoteDraft; isAdmin: boolean; onClose: () => void }) {
  const fieldId = useId();
  const [requestedSpace, setRequestedSpace] = useState<GuideQuoteSpace | null>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [choice, setChoice] = useState<string>(NEW_NOTE);
  const [showAll, setShowAll] = useState(false);
  const [openPage, setOpenPage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    getGuideQuoteDestinations(draft.pageId, requestedSpace)
      .then((result) => {
        if (cancelled) return;
        setLoad(result.ok ? { kind: "ready", value: result.value } : { kind: "error", message: result.error });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: "error", message: "노트 목록을 불러오지 못했습니다." });
      });
    return () => {
      cancelled = true;
    };
  }, [draft.pageId, requestedSpace]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 고른 학생·그룹의 노트 목록을 서버에서 읽는 동기화(불러오는 중 표시 포함).
  useEffect(() => reload(), [reload]);

  const destinations = load.kind === "ready" ? load.value : null;
  const closedNames = destinations?.closedStudents.map((student) => student.name).join(", ") ?? "";
  const notes = destinations?.notes ?? [];
  const visibleNotes = showAll ? notes : notes.slice(0, VISIBLE_NOTES);
  const newTitle = guideQuoteNoteTitle(draft.pageTitle);
  const previewText = draft.quote.blocks.map((block) => block.text).join(" ");
  const chosenNote = notes.find((note) => note.id === choice) ?? null;
  const canSubmit =
    destinations !== null &&
    !busy &&
    (choice === NEW_NOTE ? destinations.newNoteStudentId !== null : chosenNote !== null && !(chosenNote.group && destinations.groupBlocked));

  const submit = async () => {
    if (!destinations || !canSubmit) return;
    setError(null);
    const html = buildGuideNoteQuoteHtml({
      pageId: draft.pageId,
      pageTitle: draft.pageTitle,
      blockId: draft.quote.blockId,
      blocks: draft.quote.blocks,
      skippedImages: draft.quote.skippedImages,
    });
    if (!html) {
      setError("담을 글이 없습니다. 본문을 다시 골라 주세요.");
      return;
    }
    setBusy(true);
    try {
      if (isAdmin && openPage && destinations.closedStudents.length > 0) {
        const opened = await openGuidePageForQuote(draft.pageId, destinations.space);
        if (!opened.ok) {
          setError(opened.error);
          return;
        }
      }
      const token = stashGuideQuote(html);
      if (!token) {
        setError("이 브라우저에서 인용을 노트로 넘기지 못했습니다. 사생활 보호 모드를 끄고 다시 시도해 주세요.");
        return;
      }
      const returnTo = guidePagePath(draft.pageId);
      const href =
        choice === NEW_NOTE
          ? guideQuoteNoteHref({
              token,
              returnTo,
              target: {
                kind: "new",
                studentId: destinations.newNoteStudentId!,
                asAdmin: isAdmin,
                group: destinations.space.kind === "group",
                title: newTitle,
              },
            })
          : guideQuoteNoteHref({ token, returnTo, target: { kind: "note", noteId: choice } });
      window.getSelection()?.removeAllRanges();
      onClose();
      pushInApp(href);
    } catch {
      setError("노트로 넘기지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const rowClass =
    "flex min-h-12 items-center gap-2.5 border-b border-muted text-base md:min-h-11 md:text-ui";
  const radioClass = "size-4 shrink-0 accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-3.5";

  return (
    <DialogContent dismissible={!busy} className="flex flex-col gap-[18px] md:max-w-[448px]">
      <DialogHeader className="mb-0">
        <DialogTitle>노트에 담기</DialogTitle>
        <DialogDescription className="sr-only">고른 가이드 글을 담을 노트를 고릅니다. 설명은 노트에서 인용 아래에 이어 씁니다.</DialogDescription>
      </DialogHeader>

      <blockquote className="flex flex-col gap-1.5 border-l-2 border-foreground py-0.5 pl-3.5 text-ui text-secondary-foreground">
        <span className="line-clamp-3">{previewText}</span>
        <span className="text-xs text-muted-foreground">{describeGuideQuote({ pageTitle: draft.pageTitle, blocks: draft.quote.blocks, skippedImages: draft.quote.skippedImages })}</span>
      </blockquote>

      {isAdmin ? (
        <label htmlFor={`${fieldId}-space`} className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          학생
          <select
            id={`${fieldId}-space`}
            value={destinations ? spaceValue(destinations.space) : requestedSpace ? spaceValue(requestedSpace) : ""}
            disabled={!destinations?.spaces || busy}
            onChange={(event) => {
              const next = parseSpaceValue(event.target.value);
              if (!next) return;
              setRequestedSpace(next);
              setChoice(NEW_NOTE);
              setShowAll(false);
              setOpenPage(true);
            }}
            className="h-11 rounded-touch border border-input bg-background px-2.5 text-base text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-60 md:h-9 md:rounded-md md:text-ui"
          >
            {destinations?.spaces ? (
              <>
                {destinations.spaces.students.map((student) => (
                  <option key={student.id} value={`student:${student.id}`}>{student.name}</option>
                ))}
                {destinations.spaces.groups.map((group) => (
                  <option key={group.id} value={`group:${group.id}`}>그룹 · {group.name}</option>
                ))}
              </>
            ) : (
              <option value="">불러오는 중…</option>
            )}
          </select>
        </label>
      ) : null}

      <fieldset className="flex flex-col" disabled={busy}>
        <legend className="pb-1 text-xs text-muted-foreground">{isAdmin ? "담을 노트" : "담을 노트 · 내 노트와 그룹 노트"}</legend>
        {load.kind === "loading" ? (
          <div className="flex flex-col" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex min-h-11 items-center border-b border-muted">
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : load.kind === "error" ? (
          <div className="flex flex-col items-start gap-2 py-2">
            <p role="alert" className="text-ui text-destructive">{load.message}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => reload()}>다시 시도</Button>
          </div>
        ) : (
          <>
            {load.value.newNoteStudentId ? (
              <label className={rowClass}>
                <input type="radio" name={`${fieldId}-note`} value={NEW_NOTE} checked={choice === NEW_NOTE} onChange={() => setChoice(NEW_NOTE)} className={radioClass} />
                <span className="min-w-0 flex-1 truncate">새 노트 · &ldquo;{newTitle}&rdquo;</span>
              </label>
            ) : null}
            {visibleNotes.map((note) => {
              const blocked = note.group && load.value.groupBlocked;
              return (
                <label key={note.id} className={cn(rowClass, blocked && "cursor-not-allowed opacity-50")}>
                  <input
                    type="radio"
                    name={`${fieldId}-note`}
                    value={note.id}
                    checked={choice === note.id}
                    disabled={blocked}
                    onChange={() => setChoice(note.id)}
                    className={radioClass}
                  />
                  <span className="min-w-0 flex-1 truncate">{note.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {note.group && !isAdmin ? `그룹 · ${note.dateLabel}` : note.dateLabel}
                  </span>
                </label>
              );
            })}
            {notes.length > VISIBLE_NOTES && !showAll ? (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="mt-1.5 h-11 self-start rounded-touch px-2 text-ui text-secondary-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:rounded-md"
              >
                노트 더 보기
              </button>
            ) : null}
            {!isAdmin && load.value.groupBlocked && notes.some((note) => note.group) ? (
              <p className="pt-2 text-xs text-muted-foreground">그룹 멤버 중 이 페이지가 열리지 않은 사람이 있어 그룹 노트에는 담을 수 없습니다.</p>
            ) : null}
          </>
        )}
      </fieldset>

      {isAdmin && destinations && destinations.closedStudents.length > 0 ? (
        <div role="status" className="flex flex-col gap-2 rounded-lg bg-warning-muted p-3 text-ui text-warning">
          <span>이 페이지는 {closedNames}에게 아직 열리지 않았습니다. 인용 글은 노트에서 그대로 보입니다.</span>
          <label className="flex min-h-11 items-center gap-2 text-foreground md:min-h-8">
            <input
              type="checkbox"
              checked={openPage}
              disabled={busy}
              onChange={(event) => setOpenPage(event.target.checked)}
              className="size-4 shrink-0 accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-3.5"
            />
            넣으면서 이 페이지를 {closedNames}에게 열기
          </label>
        </div>
      ) : null}

      {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : null}

      <div className="flex gap-2 max-md:flex-col-reverse md:justify-end">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="max-md:hidden">
          취소
        </Button>
        <Button type="button" onClick={() => void submit()} disabled={!canSubmit} className="max-md:h-12 max-md:text-md">
          {busy ? "넣는 중…" : "넣고 노트 열기"}
        </Button>
      </div>
    </DialogContent>
  );
}
