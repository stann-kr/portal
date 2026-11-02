"use client";

import { AutosaveStatus } from "./AutosaveStatus";
import { CollabPresence } from "./CollabPresence";
import { describeCollabStatus } from "@/lib/collab/client/collab-status";
import type { CollabFormDraft, CollabFormFields } from "@/lib/collab/client/useCollabFormDraft";

/** 버튼으로 등록하는 작성본의 보관 상태 줄(편집기 아래). 선택창 대신 지금 어디에 남아 있는지만 알린다. */
export function CollabDraftStatus<F extends CollabFormFields>({ draft }: { draft: CollabFormDraft<F> }) {
  const view = describeCollabStatus({
    connection: draft.collab.status,
    mode: draft.collab.mode,
    isSaver: false,
    autosave: "idle",
    autosaveError: null,
    blockedMessage: "",
    manual: true,
  });
  const solo = draft.collab.status === "solo";
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <AutosaveStatus status={view.kind} message={view.message} label={view.message} shortMessage={view.shortMessage} />
      <CollabPresence awareness={solo ? null : draft.collab.provider?.awareness} />
    </div>
  );
}
