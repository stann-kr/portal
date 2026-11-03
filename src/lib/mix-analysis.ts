/**
 * 믹스셋 분석 양식(평점·추천·한줄평·시점 메모)의 검증·저장 표현(순수 함수).
 *
 * - 화면은 `analysis` 칸에 JSON({ rating, recommended, oneLiner, entries: [{ at: "12:30", memo }] })을 보낸다.
 * - 저장은 시점을 초로 바꾼 JSON(`MixAnalysis`)이며 assignments.analysis_json에 둔다.
 * - 시점 메모는 시점 순으로 정렬한다. 시점 없는 줄은 바로 앞 시점 줄에 붙어 함께 움직이고, 맨 앞의 시점 없는 줄은 맨 앞에 남는다.
 */
import { parseLessonRecording } from "@/components/lesson/lesson-timestamps";

export const MIX_ANALYSIS_VERSION = 1;
export const MIX_ANALYSIS_ONE_LINER_MAX_LENGTH = 200;
export const MIX_ANALYSIS_MEMO_MAX_LENGTH = 2_000;
const MIX_ANALYSIS_MEMO_MAX_LENGTH_LABEL = "2,000";
export const MIX_ANALYSIS_MAX_ENTRIES = 300;
/** DB CHECK(100,000자)보다 조금 작게 잡아 저장 직전 실패를 화면 안내로 돌린다. */
const MIX_ANALYSIS_JSON_MAX_LENGTH = 90_000;
/** 시점 상한(23:59:59). 피드백·댓글 시점과 같은 범위다. */
export const MIX_ANALYSIS_MAX_SECONDS = 86_399;

export type MixAnalysisEntry = {
  /** 재생 시점(초). 없으면 시점 없는 메모. */
  at: number | null;
  memo: string;
};

export type MixAnalysis = {
  v: typeof MIX_ANALYSIS_VERSION;
  /** 1~5. 고르지 않으면 null. */
  rating: number | null;
  recommended: boolean;
  oneLiner: string;
  entries: MixAnalysisEntry[];
};

/** 작성 화면의 입력 상태(시점은 글자 그대로). 초안 저장과 전송에 같은 모양을 쓴다. */
export type MixAnalysisDraft = {
  rating: number | null;
  recommended: boolean;
  oneLiner: string;
  entries: { at: string; memo: string }[];
};

export const EMPTY_MIX_ANALYSIS_DRAFT: MixAnalysisDraft = { rating: null, recommended: false, oneLiner: "", entries: [] };

const CLOCK = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/u;

/** `m:ss`·`mm:ss`·`h:mm:ss`를 초로 읽는다. 형식이 아니거나 범위를 넘으면 null. */
export function parseAnalysisClock(value: string): number | null {
  const match = CLOCK.exec(value.trim());
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  if (match[1] && minutes > 59) return null;
  const seconds = hours * 3600 + minutes * 60 + Number(match[3]);
  return seconds <= MIX_ANALYSIS_MAX_SECONDS ? seconds : null;
}

/** 캔버스 표기: 한 시간 전은 `m:ss`, 넘으면 `h:mm:ss`. */
export function formatAnalysisClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/gu, "\n").trim() : "";
}

/** 시점 순 정렬. 시점 없는 줄은 앞 시점 줄과 한 묶음으로 움직인다(같은 시점은 쓴 순서 유지). */
export function sortAnalysisEntries<T extends { at: number | null }>(entries: readonly T[]): T[] {
  const groups: { key: number; items: T[] }[] = [];
  for (const entry of entries) {
    if (entry.at === null && groups.length > 0) groups[groups.length - 1]!.items.push(entry);
    else groups.push({ key: entry.at ?? -1, items: [entry] });
  }
  return groups
    .map((group, index) => ({ ...group, index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .flatMap((group) => group.items);
}

export type MixAnalysisResult = { ok: true; analysis: MixAnalysis; json: string } | { ok: false; error: string };

/** 화면이 보낸 `analysis` 값을 저장할 분석으로 검증한다. 메모가 빈 줄은 버린다. */
export function validateMixAnalysisInput(raw: unknown): MixAnalysisResult {
  let input: unknown;
  try {
    input = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    input = null;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "분석 내용을 읽지 못했습니다. 새로고침한 뒤 다시 제출해 주세요." };
  }
  const value = input as Record<string, unknown>;

  const rating = value.rating === null || value.rating === undefined ? null : value.rating;
  if (rating !== null && !(typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    return { ok: false, error: "평점은 1점에서 5점 사이로 골라 주세요." };
  }
  const oneLiner = normalizeText(value.oneLiner).replace(/\s*\n\s*/gu, " ");
  if (oneLiner.length > MIX_ANALYSIS_ONE_LINER_MAX_LENGTH) {
    return { ok: false, error: `한줄평은 ${MIX_ANALYSIS_ONE_LINER_MAX_LENGTH}자까지 쓸 수 있습니다. 지금 ${oneLiner.length}자입니다.` };
  }

  const rawEntries = Array.isArray(value.entries) ? value.entries : [];
  const entries: MixAnalysisEntry[] = [];
  for (const [index, rawEntry] of rawEntries.entries()) {
    const entry = rawEntry && typeof rawEntry === "object" ? rawEntry as Record<string, unknown> : {};
    const memo = normalizeText(entry.memo);
    const atText = normalizeText(entry.at);
    if (!memo) continue;
    if (memo.length > MIX_ANALYSIS_MEMO_MAX_LENGTH) {
      return { ok: false, error: `${index + 1}번째 메모는 ${MIX_ANALYSIS_MEMO_MAX_LENGTH_LABEL}자까지 쓸 수 있습니다.` };
    }
    const at = atText ? parseAnalysisClock(atText) : null;
    if (atText && at === null) {
      return { ok: false, error: `${index + 1}번째 줄의 시점 "${atText}"을 읽지 못했습니다. 12:30이나 1:02:30처럼 적거나 비워 주세요.` };
    }
    entries.push({ at, memo });
  }
  if (entries.length > MIX_ANALYSIS_MAX_ENTRIES) {
    return { ok: false, error: `시점 메모는 ${MIX_ANALYSIS_MAX_ENTRIES}줄까지 쓸 수 있습니다.` };
  }
  if (rating === null && !oneLiner && entries.length === 0) {
    return { ok: false, error: "평점·한줄평·시점 메모 중 하나 이상을 적어 주세요." };
  }

  const analysis: MixAnalysis = {
    v: MIX_ANALYSIS_VERSION,
    rating,
    recommended: value.recommended === true,
    oneLiner,
    entries: sortAnalysisEntries(entries),
  };
  const json = JSON.stringify(analysis);
  if (json.length > MIX_ANALYSIS_JSON_MAX_LENGTH) {
    return { ok: false, error: "분석이 너무 깁니다. 메모를 줄인 뒤 다시 제출해 주세요." };
  }
  return { ok: true, analysis, json };
}

/** 저장된 JSON을 읽는다. 모양이 어긋난 값은 null(화면은 분석 없이 보인다). */
export function parseStoredMixAnalysis(json: string | null | undefined): MixAnalysis | null {
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.entries)) return null;
  const rating = typeof record.rating === "number" && record.rating >= 1 && record.rating <= 5 ? Math.round(record.rating) : null;
  return {
    v: MIX_ANALYSIS_VERSION,
    rating,
    recommended: record.recommended === true,
    oneLiner: typeof record.oneLiner === "string" ? record.oneLiner : "",
    entries: record.entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const { at, memo } = entry as Record<string, unknown>;
      if (typeof memo !== "string") return [];
      return [{ at: typeof at === "number" && Number.isInteger(at) && at >= 0 ? at : null, memo }];
    }),
  };
}

/** 저장된 분석을 작성 화면 입력으로 되돌린다(제출 수정). */
export function mixAnalysisToDraft(analysis: MixAnalysis | null): MixAnalysisDraft {
  if (!analysis) return EMPTY_MIX_ANALYSIS_DRAFT;
  return {
    rating: analysis.rating,
    recommended: analysis.recommended,
    oneLiner: analysis.oneLiner,
    entries: analysis.entries.map((entry) => ({ at: entry.at === null ? "" : formatAnalysisClock(entry.at), memo: entry.memo })),
  };
}

/** 임베드가 막힌 영상의 시점을 원본 사이트에서 열 주소. YouTube·SoundCloud가 아니면 원래 주소. */
export function mediaUrlAt(url: string, seconds: number): string {
  const recording = parseLessonRecording(url);
  const at = Math.max(0, Math.floor(seconds));
  if (!recording) return url;
  if (recording.url.startsWith("https://www.youtube.com/")) return `${recording.url}&t=${recording.offsetSeconds + at}s`;
  return `${recording.url}#t=${formatAnalysisClock(recording.offsetSeconds + at)}`;
}

/**
 * 피드백을 시점 메모 줄에 나눠 단다. 시점이 같은 첫 줄에 붙이고, 맞는 줄이 없거나 시점 없는 피드백은 전체 피드백으로 남긴다.
 * @returns byEntry[i]는 i번째 줄 아래 피드백, rest는 전체 피드백 목록에 둘 것.
 */
export function splitFeedbackByEntry<T extends { timeMarker: number | null }>(
  entries: readonly MixAnalysisEntry[],
  feedbackList: readonly T[],
): { byEntry: T[][]; rest: T[] } {
  const firstIndexAt = new Map<number, number>();
  entries.forEach((entry, index) => {
    if (entry.at !== null && !firstIndexAt.has(entry.at)) firstIndexAt.set(entry.at, index);
  });
  const byEntry: T[][] = entries.map(() => []);
  const rest: T[] = [];
  for (const feedback of feedbackList) {
    const index = feedback.timeMarker === null ? undefined : firstIndexAt.get(feedback.timeMarker);
    if (index === undefined) rest.push(feedback);
    else byEntry[index]!.push(feedback);
  }
  return { byEntry, rest };
}
