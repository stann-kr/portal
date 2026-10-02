/** 문서 초안의 저장 버전, 보존 정책과 공유 타입. */

export const FORM_DRAFT_STORAGE_VERSION = 1;

export const FORM_DRAFT_RECOVERY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const FORM_DRAFT_CLEAR_MARKER_VERSION = 1;

export const FORM_DRAFT_CLEAR_MARKER_TTL_MS = FORM_DRAFT_RECOVERY_TTL_MS;

export const FORM_DRAFT_RECOVERY_RECENT_MS = 60 * 60 * 1000;

export const FORM_DRAFT_MAX_DIVERGENT_RECOVERIES = 20;

export const DOCUMENT_DRAFT_KINDS = [
  "note",
  "qna-thread",
  "qna-reply",
  "community-post",
  "community-comment",
  "assignment-feedback",
] as const;

export type DocumentDraftKind = (typeof DOCUMENT_DRAFT_KINDS)[number];

export type DocumentDraftKeyIdentity = {
  kind: DocumentDraftKind;
  ownerId: string;
  contextId: string;
};

export type FormDraftStatus =
  | "idle"
  | "saving"
  | "saved"
  | "conflict"
  | "incompatible"
  | "error";

export type StoredFormDraft<T> = {
  data: T;
  savedAt: Date | null;
  retainedAt?: Date;
  legacy: boolean;
};

export type FormDraftRecovery<T> = {
  storageKey: string;
  data: T;
  savedAt: Date;
  retainedAt: Date;
  raw: string;
  signature: string;
};

export type FormDraftRecoveryPreview = {
  title: string | null;
  body: string | null;
};

export type FormDraftRecoverySummary = Pick<
  FormDraftRecovery<unknown>,
  "storageKey" | "savedAt"
> & {
  isCurrent: boolean;
  preview: FormDraftRecoveryPreview;
};

export type FormDraftRecoveryStorage = {
  readonly length: number;
  key: (index: number) => string | null;
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
};

export type FormDraftStorage = FormDraftRecoveryStorage & {
  setItem: (key: string, value: string) => void;
};

export type FormDraftClearMarker = {
  version: typeof FORM_DRAFT_CLEAR_MARKER_VERSION;
  signature: string;
  clearedAt: Date;
  raw: string;
};

export type FormDraftRecoveryRetentionOptions = {
  now?: number;
  maxDivergent?: number;
  recentMs?: number;
  protectedKeys?: Iterable<string>;
};

export type RemoveFormDraftSnapshotsOptions = {
  savedAtOrBefore?: number;
};

export type FormDraftRecoveryCompactionResult = {
  removedKeys: string[];
  invalidOrExpiredKeys: string[];
  duplicateKeys: string[];
  excessKeys: string[];
  resolvedMarkerKeys: string[];
};

export type SweepExpiredFormDraftArtifactsOptions = {
  now?: number;
  protectedSourceKeys?: Iterable<string>;
  protectedRecoveryKeys?: Iterable<string>;
  /** 지정하면 전체 storage를 열거하지 않고 이 key들만 best-effort 정리한다. */
  candidateKeys?: readonly string[];
  /** proactive 정리에서 동기 parse/hash할 raw 크기를 code unit 기준으로 제한한다. */
  maxArtifactRawCodeUnits?: number;
  /** false면 causal 전역 열거가 필요한 clear marker 물리 정리를 건너뛴다. */
  includeClearMarkers?: boolean;
};

export type SweepExpiredFormDraftArtifactsResult = {
  removedRecoveryKeys: string[];
  removedClearMarkerKeys: string[];
};

export type PersistFormDraftSnapshotOptions<T> = {
  sourceKey: string;
  recoveryKey: string;
  data: T;
  expectedRaw: string | null;
  savedAt?: number;
};

export type PersistFormDraftRawSnapshotOptions = {
  sourceKey: string;
  recoveryKey: string;
  raw: string;
  expectedRaw: string | null;
};

export type PersistFormDraftSnapshotResult = {
  status: "saved" | "conflict";
  raw: string;
  currentRaw: string | null;
  recoveryKey: string;
};
