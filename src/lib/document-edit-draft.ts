import {
  createDocumentSnapshotFingerprint,
  isDocumentSnapshotFingerprint,
  type DocumentSnapshotFingerprintInput,
  type DocumentSnapshotKind,
} from "@/lib/document-snapshot-fingerprint";

/**
 * compact draft를 구버전 편집 폼이 열었을 때 안전하게 stale 상태로 잠그는 값이다.
 * 저장된 note/post는 제목과 rich text 본문이 필수이므로 실제 서버 snapshot과 같을 수 없다.
 */
export const DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE = Object.freeze({
  title: "",
  noteDate: "",
  contentHtml: "",
} as const);

export type DocumentEditDraftBaseFields = {
  baseFingerprint?: unknown;
  base?: unknown;
};

export type CompactDocumentEditDraftMetadata = {
  baseFingerprint: string;
  base: typeof DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE;
};

export type ResolvedDocumentEditDraftBase = {
  currentFingerprint: string;
  draftBaseFingerprint: string;
  hasStaleDraftBase: boolean;
};

type LegacyDocumentEditSnapshot = {
  title: string;
  contentHtml: string;
  noteDate: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readLegacyDocumentEditSnapshot(
  value: unknown,
  kind: DocumentSnapshotKind,
): LegacyDocumentEditSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.title !== "string" ||
    typeof value.contentHtml !== "string"
  ) {
    return null;
  }

  if (kind === "private-note") {
    if (typeof value.noteDate !== "string") return null;
    return {
      title: value.title,
      noteDate: value.noteDate,
      contentHtml: value.contentHtml,
    };
  }

  return {
    title: value.title,
    noteDate: null,
    contentHtml: value.contentHtml,
  };
}

function createLegacyDocumentEditDraftFingerprint(
  snapshot: LegacyDocumentEditSnapshot,
  currentSnapshot: DocumentSnapshotFingerprintInput,
): string {
  try {
    return createDocumentSnapshotFingerprint({
      kind: currentSnapshot.kind,
      id: currentSnapshot.id,
      title: snapshot.title,
      contentHtml: snapshot.contentHtml,
      noteDate: snapshot.noteDate,
    });
  } catch {
    // 과거 비canonical noteDate도 복원을 중단하지 않고 안전한 stale 기준으로 축약한다.
    return createDocumentEditDraftStaleSentinelFingerprint(currentSnapshot);
  }
}

function createDocumentEditDraftStaleSentinelFingerprint(
  currentSnapshot: DocumentSnapshotFingerprintInput,
): string {
  return createDocumentSnapshotFingerprint({
    kind: currentSnapshot.kind,
    id: currentSnapshot.id,
    title: DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.title,
    contentHtml: DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.contentHtml,
    noteDate:
      currentSnapshot.kind === "private-note"
        ? DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.noteDate
        : null,
  });
}

/** 저장 payload에 원문 base를 복제하지 않는 고정 크기 metadata를 추가한다. */
export function createDocumentEditDraftMetadata(
  baseFingerprint: string,
): CompactDocumentEditDraftMetadata {
  if (!isDocumentSnapshotFingerprint(baseFingerprint)) {
    throw new TypeError("Invalid document edit draft base fingerprint");
  }

  return {
    baseFingerprint,
    base: DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE,
  };
}

/**
 * compact fingerprint를 우선하고, 이전 버전의 full base snapshot은 같은
 * resource-domain fingerprint로 변환해 복원한다.
 */
export function resolveDocumentEditDraftBase(
  draft: DocumentEditDraftBaseFields,
  currentSnapshot: DocumentSnapshotFingerprintInput,
  draftMatchesCurrentServer: boolean,
): ResolvedDocumentEditDraftBase {
  const currentFingerprint = createDocumentSnapshotFingerprint(currentSnapshot);
  const compactFingerprint = isDocumentSnapshotFingerprint(draft.baseFingerprint)
    ? draft.baseFingerprint
    : null;
  const legacySnapshot = compactFingerprint
    ? null
    : readLegacyDocumentEditSnapshot(draft.base, currentSnapshot.kind);
  const observedFingerprint =
    compactFingerprint ??
    (legacySnapshot
      ? createLegacyDocumentEditDraftFingerprint(
          legacySnapshot,
          currentSnapshot,
        )
      : null);

  if (
    draftMatchesCurrentServer ||
    observedFingerprint === currentFingerprint
  ) {
    return {
      currentFingerprint,
      draftBaseFingerprint: currentFingerprint,
      hasStaleDraftBase: false,
    };
  }

  return {
    currentFingerprint,
    draftBaseFingerprint:
      observedFingerprint ??
      createDocumentEditDraftStaleSentinelFingerprint(currentSnapshot),
    hasStaleDraftBase: true,
  };
}
