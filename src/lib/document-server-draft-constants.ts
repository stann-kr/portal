export const DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const DOCUMENT_SERVER_DRAFT_MAX_PAYLOAD_BYTES = 900 * 1024;
export const DOCUMENT_SERVER_DRAFT_REQUEST_HASH_VERSION = 1;
export const DOCUMENT_SERVER_DRAFT_PAYLOAD_VERSION = 1;

export const DOCUMENT_SERVER_DRAFT_OPERATION_TYPES = [
  "UPSERT",
  "DISCARD",
] as const;

export const DOCUMENT_SERVER_DRAFT_RESULT_STATES = [
  "PRESENT",
  "DISCARDED",
] as const;

export type DocumentServerDraftOperationType =
  (typeof DOCUMENT_SERVER_DRAFT_OPERATION_TYPES)[number];
export type DocumentServerDraftResultState =
  (typeof DOCUMENT_SERVER_DRAFT_RESULT_STATES)[number];
