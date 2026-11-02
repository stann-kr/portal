/**
 * 서버 확인분(base) 기준 3-way 병합 (순수 함수, ProseMirror JSON).
 *
 * - base: 서버가 확인한 상태, mine: 이 기기, theirs: 현재 서버. mine의 변경을 theirs 위에 다시 적용한다.
 * - 최상위 블록을 정규 JSON으로 비교하고 base↔mine, base↔theirs를 LCS로 정렬해 변경 구간(hunk)을 만든다.
 * - 겹치지 않는 구간은 양쪽 모두 적용, 한쪽만 바꾼 구간은 그쪽, 같은 변경은 한 번.
 * - 양쪽이 같은 블록 하나를 다르게 바꾸면(구조·속성이 같은 글자 전용 블록) 글자 단위 3-way를 시도한다.
 * - 그래도 겹치면 theirs 블록 뒤에 mine 블록을 이어 넣어 이 기기 입력을 문서 안에 남긴다(conflicts += 1).
 * - mine의 변경이 이미 theirs에 들어 있으면 다시 넣지 않는다(같은 병합을 두 번 해도 no-op).
 */

/** LCS 표 상한(칸 수). Uint32 4바이트 × 2백만 = 8MB. 넘으면 선형 메모리 LCS(Hirschberg)로 바꾼다. */
const MAX_LCS_CELLS = 2_000_000;

export type PmMark = { type: string; attrs?: Record<string, unknown> };
export type PmNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: PmMark[];
};
export type PmDoc = { type: "doc"; content?: PmNode[] };
export type MergeFields = Record<string, string | number | null>;
export type MergeResult = { doc: PmDoc; fields: MergeFields; changed: boolean; conflicts: number };

type MergeInput = {
  base: PmDoc;
  mine: PmDoc;
  theirs: PmDoc;
  baseFields?: MergeFields;
  mineFields?: MergeFields;
  theirsFields?: MergeFields;
  /**
   * 양쪽이 같은 블록을 겹치게 바꿨을 때: both(기본)는 theirs 뒤에 mine을 이어 넣어 둘 다 남기고,
   * theirs는 theirs만 남긴다(내 입력 제거처럼 중복 블록을 만들면 안 되는 경우).
   */
  blockConflict?: "both" | "theirs";
  /** 같은 칸을 양쪽이 다르게 바꿨을 때 남길 쪽(기본 theirs). */
  fieldConflict?: "theirs" | "mine";
};

/* ---------- 정규 JSON ---------- */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 키 순서를 고정하고 undefined·빈 content/marks/attrs를 없는 것과 같게 본다. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item === undefined) continue;
    if ((key === "content" || key === "marks") && Array.isArray(item) && item.length === 0) continue;
    if (key === "attrs" && isPlainObject(item) && Object.keys(item).length === 0) continue;
    out[key] = normalize(item);
  }
  return out;
}

function canonical(value: unknown): string {
  return JSON.stringify(normalize(value)) ?? "undefined";
}

function blocksOf(doc: PmDoc | undefined): PmNode[] {
  return Array.isArray(doc?.content) ? doc.content : [];
}

function sameSequence(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/** needle이 haystack 안에 연속으로 들어 있는지(빈 needle은 false). */
function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let ok = true;
    for (let k = 0; k < needle.length; k += 1) {
      if (haystack[start + k] !== needle[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/* ---------- LCS 정렬 ---------- */

/** a[aStart..aEnd)와 b[bStart..bEnd)의 LCS 길이 행(끝 열). 두 줄만 쓴다. reverse면 뒤에서부터 센다. */
function lcsRow(a: string[], aStart: number, aEnd: number, b: string[], bStart: number, bEnd: number, reverse: boolean): Uint32Array {
  const width = bEnd - bStart;
  let previous = new Uint32Array(width + 1);
  let current = new Uint32Array(width + 1);
  for (let step = 0; step < aEnd - aStart; step += 1) {
    const key = reverse ? a[aEnd - 1 - step] : a[aStart + step];
    for (let k = 1; k <= width; k += 1) {
      const other = reverse ? b[bEnd - k] : b[bStart + k - 1];
      current[k] = key === other ? previous[k - 1] + 1 : Math.max(previous[k], current[k - 1]);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }
  return previous;
}

/** Hirschberg: 선형 메모리로 정확한 LCS 짝(base 번호, side 번호)을 순서대로 모은다. */
function hirschberg(
  a: string[],
  b: string[],
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  out: Array<[number, number]>,
): void {
  if (aEnd <= aStart || bEnd <= bStart) return;
  if (aEnd - aStart === 1) {
    for (let j = bStart; j < bEnd; j += 1) {
      if (a[aStart] === b[j]) {
        out.push([aStart, j]);
        return;
      }
    }
    return;
  }
  const mid = aStart + Math.floor((aEnd - aStart) / 2);
  const left = lcsRow(a, aStart, mid, b, bStart, bEnd, false);
  const right = lcsRow(a, mid, aEnd, b, bStart, bEnd, true);
  const width = bEnd - bStart;
  let best = 0;
  let split = 0;
  for (let k = 0; k <= width; k += 1) {
    const total = left[k] + right[width - k];
    if (total > best) {
      best = total;
      split = k;
    }
  }
  hirschberg(a, b, aStart, mid, bStart, bStart + split, out);
  hirschberg(a, b, mid, aEnd, bStart + split, bEnd, out);
}

/** base 각 위치가 side의 어느 위치와 짝인지(-1 = 짝 없음). 반복되는 같은 블록도 LCS로 정렬한다. */
function lcsMap(baseKeys: string[], sideKeys: string[]): number[] {
  const n = baseKeys.length;
  const m = sideKeys.length;
  const map = new Array<number>(n).fill(-1);

  let prefix = 0;
  while (prefix < n && prefix < m && baseKeys[prefix] === sideKeys[prefix]) {
    map[prefix] = prefix;
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < n - prefix &&
    suffix < m - prefix &&
    baseKeys[n - 1 - suffix] === sideKeys[m - 1 - suffix]
  ) {
    map[n - 1 - suffix] = m - 1 - suffix;
    suffix += 1;
  }

  const rows = n - prefix - suffix;
  const cols = m - prefix - suffix;
  if (rows > 0 && cols > 0 && rows * cols > MAX_LCS_CELLS) {
    // 아주 긴 문서끼리 크게 다르면 LCS 표가 Workers 메모리를 넘는다. 같은 최장 정렬을 선형 메모리(Hirschberg)로 구한다
    // (정확한 LCS라 같은 병합을 다시 해도 결과가 같다).
    const pairs: Array<[number, number]> = [];
    hirschberg(baseKeys, sideKeys, prefix, prefix + rows, prefix, prefix + cols, pairs);
    for (const [i, j] of pairs) map[i] = j;
    return map;
  }
  if (rows > 0 && cols > 0) {
    const width = cols + 1;
    const table = new Uint32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = cols - 1; j >= 0; j -= 1) {
        table[i * width + j] =
          baseKeys[prefix + i] === sideKeys[prefix + j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (baseKeys[prefix + i] === sideKeys[prefix + j]) {
        map[prefix + i] = prefix + j;
        i += 1;
        j += 1;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        i += 1;
      } else {
        j += 1;
      }
    }
  }
  return map;
}

/* ---------- 변경 구간 ---------- */

type Side = "mine" | "theirs";
/** base [bs, be)를 side [ss, se)로 바꾼 구간. bs === be면 삽입. */
type Hunk = { side: Side; bs: number; be: number; ss: number; se: number };

function hunksOf(side: Side, map: number[], sideLength: number): Hunk[] {
  const hunks: Hunk[] = [];
  let prevBase = -1;
  let prevSide = -1;
  const flush = (nextBase: number, nextSide: number) => {
    const bs = prevBase + 1;
    const ss = prevSide + 1;
    if (bs < nextBase || ss < nextSide) hunks.push({ side, bs, be: nextBase, ss, se: nextSide });
  };
  for (let b = 0; b < map.length; b += 1) {
    if (map[b] < 0) continue;
    flush(b, map[b]);
    prevBase = b;
    prevSide = map[b];
  }
  flush(map.length, sideLength);
  return hunks;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  if (aStart === aEnd && bStart === bEnd) return aStart === bStart;
  return aStart < bEnd && bStart < aEnd;
}

type Group = { bs: number; be: number; hunks: Hunk[] };

function groupHunks(all: Hunk[]): Group[] {
  const sorted = [...all].sort((a, b) => a.bs - b.bs || (a.be - a.bs) - (b.be - b.bs));
  const groups: Group[] = [];
  for (const hunk of sorted) {
    const last = groups[groups.length - 1];
    if (last && overlaps(last.bs, last.be, hunk.bs, hunk.be)) {
      last.hunks.push(hunk);
      last.be = Math.max(last.be, hunk.be);
    } else {
      groups.push({ bs: hunk.bs, be: hunk.be, hunks: [hunk] });
    }
  }
  return groups;
}

/** group 범위에서 한쪽의 블록 목록(그쪽 구간 + 사이의 짝지은 블록). */
function segmentOf(side: Side, group: Group, nodes: PmNode[], map: number[]): PmNode[] {
  const out: PmNode[] = [];
  let b = group.bs;
  for (const hunk of group.hunks.filter((h) => h.side === side)) {
    while (b < hunk.bs) out.push(nodes[map[b++]]);
    out.push(...nodes.slice(hunk.ss, hunk.se));
    b = hunk.be;
  }
  while (b < group.be) out.push(nodes[map[b++]]);
  return out;
}

/* ---------- 글자 단위 3-way ---------- */

type TextEdit = { start: number; end: number; insert: string };

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** base → next 를 공통 앞·뒤를 잘라 한 구간 교체로 본다(서로게이트 쌍은 쪼개지 않음). */
function textEdit(base: string, next: string): TextEdit {
  let prefix = 0;
  const max = Math.min(base.length, next.length);
  while (prefix < max && base.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  if (prefix > 0 && prefix < max && isHighSurrogate(base.charCodeAt(prefix - 1))) prefix -= 1;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    base.charCodeAt(base.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && suffix < max - prefix && isLowSurrogate(base.charCodeAt(base.length - suffix))) {
    suffix -= 1;
  }
  return { start: prefix, end: base.length - suffix, insert: next.slice(prefix, next.length - suffix) };
}

function editsOverlap(a: TextEdit, b: TextEdit): boolean {
  return overlaps(a.start, a.end, b.start, b.end) && !(a.start === a.end && b.start === b.end);
}

/** mine의 변경이 theirs에 이미 그대로 있는지: mine → theirs 편집이 mine이 넣은 구간을 건드리지 않음. */
function mineAlreadyInTheirs(base: string, mine: string, theirs: string): boolean {
  if (mine === theirs) return true;
  const own = textEdit(base, mine);
  const regionStart = own.start;
  const regionEnd = own.start + own.insert.length;
  const rest = textEdit(mine, theirs);
  if (regionStart === regionEnd) {
    // 지우기만 한 경우: 지운 자리에 다른 글이 들어오면 이미 반영된 것으로 보지 않는다.
    if (rest.end < regionStart || rest.start > regionStart) return true;
    return rest.insert === "" && (rest.end === regionStart || rest.start === regionStart);
  }
  return rest.end <= regionStart || rest.start >= regionEnd;
}

function mergeText(base: string, mine: string, theirs: string): string | null {
  if (mineAlreadyInTheirs(base, mine, theirs)) return theirs;
  const own = textEdit(base, mine);
  const other = textEdit(base, theirs);
  if (editsOverlap(own, other)) return null;
  // 같은 자리 삽입끼리는 theirs 다음 mine. 그 밖에는 시작 순서, 같으면 삽입 먼저.
  const ownFirst =
    own.start < other.start ||
    (own.start === other.start && own.start === own.end && other.start !== other.end);
  const [first, second] = ownFirst ? [own, other] : [other, own];
  return (
    base.slice(0, first.start) +
    first.insert +
    base.slice(first.end, second.start) +
    second.insert +
    base.slice(second.end)
  );
}

type TextBlock = { text: string; marks: PmMark[] | undefined; markKeys: Set<string> };

function readTextBlock(node: PmNode): TextBlock | null {
  const children = Array.isArray(node.content) ? node.content : [];
  let text = "";
  const markKeys = new Set<string>();
  let marks: PmMark[] | undefined;
  for (const child of children) {
    if (child.type !== "text" || typeof child.text !== "string") return null;
    if (child.content && child.content.length > 0) return null;
    text += child.text;
    const key = canonical(child.marks ?? []);
    markKeys.add(key);
    if (child.marks && child.marks.length > 0) marks = child.marks;
  }
  return { text, marks, markKeys };
}

function charMergeBlock(base: PmNode, mine: PmNode, theirs: PmNode): PmNode | null {
  if (base.type !== mine.type || base.type !== theirs.type) return null;
  const attrs = canonical(base.attrs ?? {});
  if (canonical(mine.attrs ?? {}) !== attrs || canonical(theirs.attrs ?? {}) !== attrs) return null;
  if (base.text !== undefined || mine.text !== undefined || theirs.text !== undefined) return null;
  if ((base.marks?.length ?? 0) + (mine.marks?.length ?? 0) + (theirs.marks?.length ?? 0) > 0) {
    if (canonical(base.marks ?? []) !== canonical(mine.marks ?? [])) return null;
    if (canonical(base.marks ?? []) !== canonical(theirs.marks ?? [])) return null;
  }
  const blocks = [readTextBlock(base), readTextBlock(mine), readTextBlock(theirs)];
  if (blocks.some((block) => block === null)) return null;
  const [b, m, t] = blocks as TextBlock[];
  // 글자 서식이 있으면 세 쪽 모두 블록 전체가 같은 서식일 때만 글자 병합.
  const allMarks = new Set([...b.markKeys, ...m.markKeys, ...t.markKeys]);
  if (allMarks.size > 1) return null;
  const merged = mergeText(b.text, m.text, t.text);
  if (merged === null) return null;
  if (merged === t.text) return theirs;
  const marks = b.marks ?? m.marks ?? t.marks;
  const rebuilt: PmNode = { ...theirs };
  if (merged) {
    const textNode: PmNode = { type: "text", text: merged };
    if (marks && marks.length > 0) textNode.marks = marks;
    rebuilt.content = [textNode];
  } else {
    delete rebuilt.content;
  }
  return rebuilt;
}

/* ---------- 블록 병합 ---------- */

function mergeBlocks(
  base: PmNode[],
  mine: PmNode[],
  theirs: PmNode[],
  onConflict: "both" | "theirs" = "both",
): { blocks: PmNode[]; conflicts: number } {
  const baseKeys = base.map(canonical);
  const mineKeys = mine.map(canonical);
  const theirsKeys = theirs.map(canonical);
  const mineMap = lcsMap(baseKeys, mineKeys);
  const theirsMap = lcsMap(baseKeys, theirsKeys);
  const groups = groupHunks([
    ...hunksOf("mine", mineMap, mine.length),
    ...hunksOf("theirs", theirsMap, theirs.length),
  ]);

  let conflicts = 0;
  const out: PmNode[] = [];
  let b = 0;
  for (const group of groups) {
    while (b < group.bs) out.push(theirs[theirsMap[b++]]);
    b = group.be;
    const hasMine = group.hunks.some((h) => h.side === "mine");
    const hasTheirs = group.hunks.some((h) => h.side === "theirs");
    const theirsSeg = segmentOf("theirs", group, theirs, theirsMap);
    if (!hasMine) {
      out.push(...theirsSeg);
      continue;
    }
    const mineSeg = segmentOf("mine", group, mine, mineMap);
    if (!hasTheirs) {
      out.push(...mineSeg);
      continue;
    }
    const mineSegKeys = mineSeg.map(canonical);
    const theirsSegKeys = theirsSeg.map(canonical);
    if (sameSequence(mineSegKeys, theirsSegKeys)) {
      out.push(...theirsSeg);
      continue;
    }
    if (group.bs === group.be) {
      // 같은 자리에 서로 다른 블록을 넣음: 충돌이 아니라 theirs 다음 mine.
      out.push(...theirsSeg);
      if (!containsRun(theirsSegKeys, mineSegKeys)) out.push(...mineSeg);
      continue;
    }
    if (group.be - group.bs === 1 && mineSeg.length === 1 && theirsSeg.length === 1) {
      const merged = charMergeBlock(base[group.bs], mineSeg[0], theirsSeg[0]);
      if (merged) {
        out.push(merged);
        continue;
      }
    }
    if (containsRun(theirsSegKeys, mineSegKeys)) {
      out.push(...theirsSeg);
      continue;
    }
    conflicts += 1;
    out.push(...theirsSeg);
    // mine 쪽에서 실제로 바뀐 블록만 이어 넣는다(theirs가 지운, mine이 손대지 않은 블록을 되살리지 않는다).
    if (onConflict === "both") {
      const baseSegKeys = new Set(baseKeys.slice(group.bs, group.be));
      out.push(...mineSeg.filter((block, index) => !baseSegKeys.has(mineSegKeys[index]) && !theirsSegKeys.includes(mineSegKeys[index])));
    }
  }
  while (b < base.length) out.push(theirs[theirsMap[b++]]);
  return { blocks: out, conflicts };
}

/* ---------- 칸 병합 ---------- */

function fieldKeys(...sets: (MergeFields | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const set of sets) if (set) for (const key of Object.keys(set)) keys.add(key);
  return [...keys];
}

function mergeFields(
  base: MergeFields | undefined,
  mine: MergeFields | undefined,
  theirs: MergeFields | undefined,
  onConflict: "theirs" | "mine" = "theirs",
): { fields: MergeFields; conflicts: number; changed: boolean } {
  const fields: MergeFields = { ...(theirs ?? {}) };
  let conflicts = 0;
  let changed = false;
  for (const key of fieldKeys(base, mine, theirs)) {
    const b = base?.[key];
    const m = mine?.[key];
    const t = theirs?.[key];
    if (m === b) continue;
    if (t === b) {
      if (m === undefined) delete fields[key];
      else fields[key] = m;
      changed = true;
    } else if (m !== t) {
      conflicts += 1;
      if (onConflict === "mine") {
        if (m === undefined) delete fields[key];
        else fields[key] = m;
        changed = true;
      }
    }
  }
  return { fields, conflicts, changed };
}

/* ---------- 공개 API ---------- */

export function mergeCollabDocuments(input: MergeInput): MergeResult {
  const theirsBlocks = blocksOf(input.theirs);
  const { blocks, conflicts: blockConflicts } = mergeBlocks(
    blocksOf(input.base),
    blocksOf(input.mine),
    theirsBlocks,
    input.blockConflict,
  );
  const fieldResult = mergeFields(input.baseFields, input.mineFields, input.theirsFields, input.fieldConflict);
  const docChanged = !sameSequence(blocks.map(canonical), theirsBlocks.map(canonical));
  const doc: PmDoc = docChanged
    ? { ...input.theirs, type: "doc", content: blocks }
    : structuredClone(input.theirs);
  return {
    doc,
    fields: fieldResult.fields,
    changed: docChanged || fieldResult.changed,
    conflicts: blockConflicts + fieldResult.conflicts,
  };
}

export function hasLocalChanges(
  base: PmDoc,
  mine: PmDoc,
  baseFields?: MergeFields,
  mineFields?: MergeFields,
): boolean {
  if (!sameSequence(blocksOf(base).map(canonical), blocksOf(mine).map(canonical))) return true;
  return fieldKeys(baseFields, mineFields).some((key) => baseFields?.[key] !== mineFields?.[key]);
}
