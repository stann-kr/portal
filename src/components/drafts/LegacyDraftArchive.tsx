"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Copy, Trash2 } from "lucide-react";
import { DRAFT_KIND_LABELS, formatSavedAt } from "@/components/auth/LocalDraftManager";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { discardDocumentServerDraft } from "@/lib/actions/documentDrafts";
import type { LegacyServerDraft } from "@/lib/actions/legacyDrafts";
import { createCreationOperationId } from "@/lib/creation-operation";
import {
  legacyDraftCopyText,
  readLegacyDraftContent,
  type LegacyDraftContent,
} from "@/lib/legacy-draft-content";
import {
  discardLocalDocumentDraft,
  readLocalDocumentDrafts,
} from "@/lib/local-draft-continuity-client";
import type { DocumentDraftKind } from "@/lib/form-draft";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { COLLAB_RECOVERY_PREFIX } from "@/lib/collab/client/useCollabDocument";

type ArchiveItem = {
  /** 기기·계정 목록 사이에서 겹치지 않는 key. */
  id: string;
  /** recovered: 실시간 문서가 다시 시작될 때 서버에 보내지 못한 입력을 남긴 복구본. */
  scope: "local" | "server" | "recovered";
  sourceKey: string;
  kind: DocumentDraftKind;
  savedAt: Date | null;
  content: LegacyDraftContent;
  /** 계정 서버 초안을 지울 때 쓰는 draftVersion. */
  draftVersion: number | null;
};

const ITEM_BUTTON_CLASS = "h-11 rounded-touch px-3 text-ui md:h-8 md:rounded-md md:px-3";

function toServerItem(draft: LegacyServerDraft): ArchiveItem {
  const savedAt = new Date(draft.updatedAt);
  return {
    id: `server:${draft.sourceKey}`,
    scope: "server",
    sourceKey: draft.sourceKey,
    kind: draft.kind,
    savedAt: Number.isFinite(savedAt.getTime()) ? savedAt : null,
    content: { title: draft.title, contentHtml: draft.contentHtml },
    draftVersion: draft.draftVersion,
  };
}

function recoveredKind(roomKey: string): DocumentDraftKind {
  if (roomKey.startsWith("guide:")) return "guide-page";
  if (roomKey.startsWith("post:") || roomKey.startsWith("draft:post:")) return "community-post";
  if (roomKey.startsWith("draft:qna-thread:")) return "qna-thread";
  if (roomKey.startsWith("draft:qna-reply:")) return "qna-reply";
  return "note";
}

/** 실시간 문서 복구본(useCollabDocument가 남김)을 읽는다. 깨진 항목은 건너뛴다. */
function readRecoveredItems(actorId: string): ArchiveItem[] {
  const items: ArchiveItem[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index);
      if (!storageKey?.startsWith(COLLAB_RECOVERY_PREFIX)) continue;
      try {
        const copy = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as
          | { key?: unknown; userId?: unknown; savedAt?: unknown; fields?: Record<string, unknown>; html?: unknown }
          | null;
        // 같은 브라우저의 다른 계정 복구본은 보이지 않는다.
        if (!copy || typeof copy.key !== "string" || copy.userId !== actorId) continue;
        const savedAt = typeof copy.savedAt === "string" ? new Date(copy.savedAt) : null;
        items.push({
          id: `recovered:${storageKey}`,
          scope: "recovered",
          sourceKey: storageKey,
          kind: recoveredKind(copy.key),
          savedAt: savedAt && Number.isFinite(savedAt.getTime()) ? savedAt : null,
          content: {
            title: typeof copy.fields?.title === "string" ? copy.fields.title : "",
            contentHtml: sanitizeHtml(typeof copy.html === "string" ? copy.html : ""),
          },
          draftVersion: null,
        });
      } catch {
        // 깨진 복구본은 보이지 않는다.
      }
    }
  } catch {
    return items;
  }
  return items;
}

/** 클립보드에는 평문과 정화한 HTML을 함께 넣고, 지원하지 않으면 평문만 쓴다. */
async function copyToClipboard(content: LegacyDraftContent): Promise<void> {
  const text = legacyDraftCopyText(content);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    const title = content.title.trim();
    const escapedTitle = title.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
    const html = `${title ? `<h1>${escapedTitle}</h1>` : ""}${sanitizeHtml(content.contentHtml)}`;
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(text);
}

/**
 * 실시간 공동 편집으로 바뀌기 전의 기기 초안·계정 서버 초안을 읽기 전용으로 보인다.
 * 복사와 삭제만 하며 어떤 저장소에도 새로 쓰지 않는다. 기기 초안은 이 계정(`actorId`)의 것만 읽는다.
 */
export function LegacyDraftArchive({
  actorId,
  serverDrafts,
}: {
  actorId: string;
  serverDrafts: LegacyServerDraft[];
}) {
  const [localItems, setLocalItems] = useState<ArchiveItem[]>([]);
  const [serverItems, setServerItems] = useState<ArchiveItem[]>(() => serverDrafts.map(toServerItem));
  // 브라우저 저장소는 mount 뒤에만 읽을 수 있어 그 전에는 빈 상태 문구를 보이지 않는다.
  const [localLoaded, setLocalLoaded] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const confirm = useConfirmAction<string>();
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // 저장소 읽기는 mount 직후 한 번 예약해 effect 본문에서 동기 setState를 하지 않는다.
    const load = () => {
      const result = readLocalDocumentDrafts(actorId);
      setLocalItems([...readRecoveredItems(actorId), ...result.drafts.map((draft) => ({
        id: `local:${draft.sourceKey}`,
        scope: "local",
        sourceKey: draft.sourceKey,
        kind: draft.kind,
        savedAt: draft.savedAt,
        content: readLegacyDraftContent(draft.data),
        draftVersion: null,
      }) satisfies ArchiveItem)]);
      setLocalError(
        result.storageUnavailable || result.enumerationFailed
          ? "브라우저 저장소에 접근할 수 없어 이 기기의 초안을 불러오지 못했습니다."
          : result.failedKeys.length > 0
            ? "일부 초안을 읽지 못했습니다. 저장소 권한을 확인해 주세요."
            : null,
      );
      setLocalLoaded(true);
    };
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [actorId]);

  const copy = async (item: ArchiveItem) => {
    setActionError(null);
    try {
      await copyToClipboard(item.content);
      setCopiedId(item.id);
    } catch {
      setCopiedId(null);
      setActionError("클립보드에 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.");
    }
  };

  const discard = async (item: ArchiveItem) => {
    setActionError(null);
    if (item.scope === "recovered") {
      try {
        window.localStorage.removeItem(item.sourceKey);
      } catch {
        setActionError("선택한 복구본을 삭제하지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      setLocalItems((items) => items.filter((entry) => entry.id !== item.id));
      statusRef.current?.focus();
      return;
    }
    if (item.scope === "local") {
      const result = discardLocalDocumentDraft(actorId, item.sourceKey);
      if (result.storageUnavailable || result.enumerationFailed || result.failedKeys.length > 0) {
        setActionError("선택한 초안을 완전히 삭제하지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      setLocalItems((items) => items.filter((entry) => entry.id !== item.id));
      statusRef.current?.focus();
      return;
    }
    setPendingId(item.id);
    try {
      const result = await discardDocumentServerDraft({
        sourceKey: item.sourceKey,
        operationId: createCreationOperationId(),
        expectedDraftVersion: item.draftVersion ?? 0,
      });
      if (!result.ok) {
        setActionError(
          result.reason === "VERSION_CONFLICT"
            ? "초안이 다른 곳에서 바뀌었습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요."
            : "초안을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
        );
        return;
      }
      setServerItems((items) => items.filter((entry) => entry.id !== item.id));
      statusRef.current?.focus();
    } catch {
      setActionError("초안을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setPendingId(null);
    }
  };

  const renderItem = (item: ArchiveItem) => {
    const kindLabel = DRAFT_KIND_LABELS[item.kind];
    const title = item.content.title.trim() || "제목 없음";
    const confirming = confirm.value === item.id;
    const hasBody = /\S/u.test(item.content.contentHtml);
    return (
      <li key={item.id} className="flex flex-col gap-3 border-b border-muted py-4">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="break-words text-body font-medium text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">
              {kindLabel} · {formatSavedAt(item.savedAt)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={ITEM_BUTTON_CLASS}
              onClick={() => void copy(item)}
              aria-label={`${kindLabel} 초안 "${title}" 내용 복사`}
            >
              <Copy className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
              {copiedId === item.id ? "복사됨" : "내용 복사"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className={ITEM_BUTTON_CLASS}
              onClick={(event) => confirm.request(event.currentTarget, item.id)}
              aria-label={`${kindLabel} 초안 "${title}" 삭제`}
              disabled={pendingId === item.id}
            >
              <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
              삭제
            </Button>
          </div>
        </div>
        {confirming ? (
          <ConfirmPanel
            confirm={confirm}
            message="이 초안을 삭제할까요? 삭제하면 되돌릴 수 없으니 필요한 내용은 먼저 복사해 두세요."
            confirmLabel="삭제 확인"
            pendingLabel="삭제하는 중"
            pending={pendingId === item.id}
            onConfirm={() => void discard(item)}
          />
        ) : null}
        <div className="max-h-96 overflow-y-auto rounded-md border border-muted px-4 py-3">
          {hasBody ? (
            <RichTextContent html={item.content.contentHtml} />
          ) : (
            <p className="text-ui text-muted-foreground">본문이 비어 있습니다.</p>
          )}
        </div>
      </li>
    );
  };

  const renderSection = (heading: string, items: ArchiveItem[], loaded: boolean, emptyText: string) => (
    <section className="flex flex-col gap-3" aria-label={heading}>
      <h2 className="text-title font-semibold text-foreground">{heading}</h2>
      {!loaded ? (
        <p className="text-ui text-muted-foreground">초안을 불러오는 중입니다.</p>
      ) : items.length === 0 ? (
        <p className="border-t border-border pt-4 text-ui text-secondary-foreground">{emptyText}</p>
      ) : (
        <ul className="flex flex-col border-t border-border" aria-label={heading}>
          {items.map(renderItem)}
        </ul>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-8">
      <p className="text-body text-secondary-foreground">
        문서 편집이 실시간 공동 편집으로 바뀌어 예전 초안은 더 이상 편집 화면에 자동으로 뜨지 않습니다. 필요한 내용은 복사해 문서에 붙여 넣으세요.
      </p>

      {/* 복사 결과와 삭제 뒤 초점이 머무는 자리. */}
      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="sr-only focus:outline-none">
        {copiedId ? "내용을 클립보드에 복사했습니다." : ""}
      </p>

      {localError || actionError ? (
        <div role="alert" className="flex gap-2 rounded-md bg-destructive-muted px-3 py-2.5 text-ui text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
          <span>{actionError ?? localError}</span>
        </div>
      ) : null}

      {renderSection("이 기기에 남은 초안", localItems, localLoaded, "이 기기에 남아 있는 이전 초안이 없습니다.")}
      {renderSection("계정에 남은 초안", serverItems, true, "계정에 남아 있는 이전 초안이 없습니다.")}
    </div>
  );
}
