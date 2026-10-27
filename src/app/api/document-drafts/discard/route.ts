import { discardDocumentServerDraft } from "@/lib/actions/documentDrafts";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { createDocumentServerDraftDiscardHandler } from "@/lib/document-server-draft-discard-api";

export const POST = createDocumentServerDraftDiscardHandler({
  discard: discardDocumentServerDraft,
  isAuthenticated: async () => (await getActiveAuthSession()) !== null,
});
