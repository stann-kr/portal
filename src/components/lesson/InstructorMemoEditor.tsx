"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { History } from "lucide-react";
import { AutosaveStatus, type AutosaveStatusKind } from "@/components/editor/AutosaveStatus";
import { RichTextContent } from "@/components/editor/RichTextContent";
import type { EditorImageUploader } from "@/components/editor/useEditorImageUpload";
import { Button } from "@/components/ui/button";
import {
  getInstructorMemoRevisions,
  saveInstructorMemoAction,
  type InstructorMemoRevisionItem,
  type InstructorMemoScope,
  type InstructorMemoSnapshot,
} from "@/lib/actions/instructorMemos";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDocumentAutosave } from "@/lib/hooks/useDocumentAutosave";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { formatKst } from "@/lib/kst-format";
import { isRichTextEmpty } from "@/lib/rich-text";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

/** 메모는 학생 자료와 섞이지 않게 이미지를 받지 않는다(이미지 정리 규칙이 노트 기준이다). */
const MEMO_IMAGE_UPLOADER: EditorImageUploader = {
  upload: async () => {
    throw new Error("수업 메모에는 이미지를 넣을 수 없습니다.");
  },
  abandon: () => {},
};

const SAVED_TIME: Intl.DateTimeFormatOptions = { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit" };
const REVISION_TIME: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

type MemoDraft = { html: string; baseVersion: number };

function sameContent(left: string, right: string): boolean {
  return left === right || (isRichTextEmpty(left) && isRichTextEmpty(right));
}

function scopeContextId(scope: InstructorMemoScope): string {
  return scope.kind === "student" ? `student:${scope.studentId}` : `note:${scope.noteId}`;
}

/**
 * 관리자만 보는 수업 메모 편집기. 입력이 멈추면 저장하고, 저장 전 내용은 이 기기에 남긴다.
 * 다른 기기에서 먼저 저장했으면 덮어쓰지 않고 어느 쪽을 남길지 고르게 한다.
 */
export function InstructorMemoEditor({
  scope,
  initial,
  actorId,
  label,
  placeholder,
}: {
  scope: InstructorMemoScope;
  initial: InstructorMemoSnapshot;
  actorId: string;
  /** 편집 영역의 접근 이름 */
  label: string;
  placeholder: string;
}) {
  const [server, setServer] = useState(initial);
  const [html, setHtml] = useState(initial.contentHtml);
  const [contentVersion, setContentVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<InstructorMemoSnapshot | null>(null);
  const [staleDraft, setStaleDraft] = useState<MemoDraft | null>(null);
  const [revisions, setRevisions] = useState<InstructorMemoRevisionItem[] | null>(null);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [preview, setPreview] = useState<InstructorMemoRevisionItem | null>(null);
  const htmlRef = useRef(html);
  const serverRef = useRef(server);
  useEffect(() => {
    htmlRef.current = html;
    serverRef.current = server;
  }, [html, server]);

  const replaceContent = useCallback((next: string) => {
    setHtml(next);
    htmlRef.current = next;
    setContentVersion((version) => version + 1);
  }, []);

  const draft = useFormDraft<MemoDraft>(
    createDocumentDraftKey("instructor-memo", actorId, scopeContextId(scope)),
    (saved) => {
      if (typeof saved.html !== "string" || typeof saved.baseVersion !== "number") return;
      const current = serverRef.current;
      if (sameContent(saved.html, current.contentHtml)) return;
      // 이 기기에서 저장하지 못한 입력이 서버의 같은 판 위에 있으면 이어서 쓴다.
      if (saved.baseVersion === current.version) replaceContent(saved.html);
      else setStaleDraft(saved);
    },
  );

  const dirty = !sameContent(html, server.contentHtml);

  const save = useCallback(async () => {
    if (saving) return;
    const sent = htmlRef.current;
    const base = serverRef.current;
    if (sameContent(sent, base.contentHtml)) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveInstructorMemoAction(scope, { contentHtml: sent, baseVersion: base.version });
      if (result.ok) {
        setServer(result.memo);
        serverRef.current = result.memo;
        if (sameContent(htmlRef.current, sent)) draft.clear({ reason: "submitted" });
        setRevisions(null);
      } else if (result.conflict) {
        setConflict(result.conflict);
      } else {
        setError(result.error);
      }
    } catch {
      setError("메모를 저장하지 못했습니다. 입력은 이 기기에 남아 있습니다.");
    } finally {
      setSaving(false);
    }
  }, [draft, saving, scope]);

  useDocumentAutosave({
    enabled: draft.loaded && !saving && !conflict && !staleDraft && !error,
    dirty,
    changeKey: html,
    onSave: () => void save(),
  });
  useBusyNavigationGuard(saving);

  const handleChange = (next: string) => {
    setHtml(next);
    htmlRef.current = next;
    setError(null);
    if (sameContent(next, serverRef.current.contentHtml)) draft.clear({ reason: "empty" });
    else draft.save({ html: next, baseVersion: serverRef.current.version });
  };

  const keepMine = () => {
    if (!conflict) return;
    // 다른 기기 내용은 이력에 남아 있으므로, 내 입력을 그 위에 저장한다.
    setServer(conflict);
    serverRef.current = conflict;
    setConflict(null);
  };
  const takeTheirs = () => {
    if (!conflict) return;
    setServer(conflict);
    serverRef.current = conflict;
    replaceContent(conflict.contentHtml);
    draft.clear({ reason: "discard" });
    setConflict(null);
  };

  const openRevisions = async () => {
    const next = !revisionsOpen;
    setRevisionsOpen(next);
    setPreview(null);
    if (next && revisions === null) {
      try {
        setRevisions(await getInstructorMemoRevisions(scope));
      } catch {
        setRevisions([]);
      }
    }
  };

  const status: AutosaveStatusKind = error || conflict ? "error" : saving ? "saving" : dirty ? "pending" : "saved";
  const statusLabel = !dirty && !saving && server.updatedAt
    ? `저장됨 · ${formatKst(server.updatedAt, SAVED_TIME)}`
    : undefined;

  return (
    <div className="flex flex-col gap-2">
      {staleDraft ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-muted p-3 text-ui">
          <p>이 기기에 저장하지 못한 메모가 있습니다. 그 사이 다른 기기에서 메모가 바뀌었습니다.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => { replaceContent(staleDraft.html); setStaleDraft(null); }}>
              이 기기 메모로 바꾸기
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { draft.clear({ reason: "discard" }); setStaleDraft(null); }}>
              버리기
            </Button>
          </div>
        </div>
      ) : null}
      {conflict ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-muted p-3 text-ui">
          <p>다른 기기에서 먼저 저장한 메모가 있습니다. 어느 쪽을 남길까요? 남기지 않은 쪽도 이력에서 다시 볼 수 있습니다.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={keepMine}>지금 화면 내용 남기기</Button>
            <Button type="button" size="sm" variant="ghost" onClick={takeTheirs}>다른 기기 내용 불러오기</Button>
          </div>
        </div>
      ) : null}
      <div data-lesson-target="memo">
        <FullEditor
          initialContent={html}
          contentVersion={contentVersion}
          onChange={handleChange}
          placeholder={placeholder}
          minHeight="200px"
          ariaLabel={label}
          variant="boxed"
          toolbar="none"
          imageUploader={MEMO_IMAGE_UPLOADER}
          disabled={!draft.loaded || Boolean(staleDraft)}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AutosaveStatus
          status={status}
          label={statusLabel}
          message={conflict ? "다른 기기 저장과 겹침" : error ?? undefined}
          onRetry={error ? () => { setError(null); void save(); } : undefined}
        />
        <Button type="button" size="sm" variant="ghost" onClick={openRevisions} aria-expanded={revisionsOpen}>
          <History className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          이력
        </Button>
      </div>
      {revisionsOpen ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          {revisions === null ? (
            <p className="text-ui text-muted-foreground">이력을 불러오는 중…</p>
          ) : revisions.length === 0 ? (
            <p className="text-ui text-muted-foreground">아직 남은 이력이 없습니다.</p>
          ) : (
            <ul className="flex max-h-48 flex-col overflow-y-auto">
              {revisions.map((revision) => (
                <li key={revision.id}>
                  <button
                    type="button"
                    onClick={() => setPreview(revision)}
                    aria-pressed={preview?.id === revision.id}
                    className="flex min-h-9 w-full items-center rounded-sm px-2 text-left text-ui hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
                  >
                    {formatKst(revision.savedAt, REVISION_TIME)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {preview ? (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              <RichTextContent html={preview.contentHtml} className="max-h-60 overflow-y-auto text-sm leading-6" />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    replaceContent(preview.contentHtml);
                    draft.save({ html: preview.contentHtml, baseVersion: serverRef.current.version });
                    setPreview(null);
                    setRevisionsOpen(false);
                  }}
                >
                  이 내용으로 되돌리기
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
