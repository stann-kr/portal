import { discardDocumentServerDraft } from "@/lib/actions/documentDrafts";
import { createDocumentServerDraftDiscardHandler } from "@/lib/document-server-draft-discard-api";

export const POST = createDocumentServerDraftDiscardHandler({ discard: discardDocumentServerDraft });
