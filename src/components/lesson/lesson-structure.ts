/**
 * @file src/components/lesson/lesson-structure.ts
 * @description 수업 노트 본문의 세트 구조(트랙 제목·곡 피드백·전환 칸)를 읽고, 수업 도구가 그 구조에 맞춰 줄을 넣는다.
 * 편집기 schema는 그대로 두고 기존 블록만 쓴다: 트랙 = 제목(H3) `트랙 09 · 곡명 [31:20]`, 곡 피드백 = 목록,
 * 전환 = `⇄ 전환 09 → 10`으로 시작하는 인용 블록. 옛 형식 `▸ 트랙 N` 문단도 트랙으로 읽는다.
 * 트랙 번호는 본문에서 세므로 다시 열거나 다른 기기에서 공동 편집해도 맞는다.
 */
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** 제목 또는 옛 형식 문단의 `트랙 N`(뒤에 `·` 곡명, 시점이 올 수 있다). */
/** 번호 뒤는 공백·구분자·시점·끝만 온다(`트랙 3번 추천` 같은 제목은 트랙이 아니다). */
const TRACK_PATTERN = /^\s*(▸\s*)?트랙\s*(\d{1,3})(?=\s|$|[·:\-–—[])\s*(?:[·:\-–—]\s*)?(.*)$/u;
const TIMESTAMP_TEXT = /\[(?:\d{1,2}:)?\d{1,3}:[0-5]\d\]/gu;
export const TRANSITION_MARK = "⇄";

export type LessonTransition = { from: number; to: number; hasNotes: boolean };

export type LessonTrack = {
  number: number;
  /** 곡명. 적지 않았으면 빈 문자열. */
  title: string;
  /** 트랙 제목 블록 시작 위치 */
  from: number;
  /** 트랙 제목 블록 끝 위치 */
  headerEnd: number;
  /** 다음 트랙 제목 전(또는 문서 끝)까지 */
  to: number;
  /** 구간에서 마지막으로 내용이 있는 블록의 끝. 뒤쪽 빈 줄은 뺀다. */
  contentEnd: number;
  transition: LessonTransition | null;
  /** 곡 피드백 개수(목록 항목·문단 단위, 전환 칸 제외) */
  songCount: number;
};

export type LessonStructure = {
  tracks: LessonTrack[];
  /** 문서에서 마지막으로 내용이 있는 블록의 끝 */
  contentEnd: number;
};

export const EMPTY_LESSON_STRUCTURE: LessonStructure = { tracks: [], contentEnd: 0 };

export function padTrack(number: number): string {
  return String(number).padStart(2, "0");
}

/** 블록이 트랙 제목이면 번호와 곡명을 돌려준다. 제목은 `트랙 N`, 문단은 옛 형식 `▸ 트랙 N`만 읽는다. */
export function readTrackHeading(node: ProseMirrorNode): { number: number; title: string } | null {
  const isHeading = node.type.name === "heading";
  if (!isHeading && node.type.name !== "paragraph") return null;
  const match = TRACK_PATTERN.exec(node.textContent);
  if (!match || (!isHeading && !match[1])) return null;
  // 시점 뒤에 곡명을 덧붙인 `트랙 11 [00:03] · intro`도 곡명만 읽는다.
  const title = match[3].replace(TIMESTAMP_TEXT, " ").replace(/\s+/gu, " ").trim().replace(/^[·:\-–—]\s*/u, "");
  return { number: Number(match[2]), title };
}

export function isTransitionBlock(node: ProseMirrorNode): boolean {
  return node.type.name === "blockquote" && node.textContent.trimStart().startsWith(TRANSITION_MARK);
}

function hasText(node: ProseMirrorNode): boolean {
  return node.textContent.trim().length > 0 || (!node.isTextblock && node.type.name !== "bulletList" && node.type.name !== "orderedList" && node.type.name !== "blockquote");
}

function feedbackCount(node: ProseMirrorNode): number {
  if (node.type.name === "bulletList" || node.type.name === "orderedList" || node.type.name === "taskList") {
    let count = 0;
    node.forEach((item) => {
      if (item.textContent.trim()) count += 1;
    });
    return count;
  }
  return hasText(node) ? 1 : 0;
}

type TopBlock = { node: ProseMirrorNode; from: number; to: number };

/** 문서 맨 위 블록에서 트랙 구간을 읽는다. 같은 문서는 같은 결과를 돌려준다(화면 snapshot 비교용). */
const structureCache = new WeakMap<ProseMirrorNode, LessonStructure>();

export function readLessonStructure(doc: ProseMirrorNode): LessonStructure {
  const cached = structureCache.get(doc);
  if (cached) return cached;
  const blocks: TopBlock[] = [];
  doc.forEach((node, offset) => blocks.push({ node, from: offset, to: offset + node.nodeSize }));

  let contentEnd = 0;
  for (const block of blocks) if (hasText(block.node)) contentEnd = block.to;

  const tracks: LessonTrack[] = [];
  blocks.forEach((block, index) => {
    const heading = readTrackHeading(block.node);
    if (!heading) return;
    let end = index + 1;
    while (end < blocks.length && !readTrackHeading(blocks[end].node)) end += 1;
    const body = blocks.slice(index + 1, end);
    let sectionContentEnd = block.to;
    let transition: LessonTransition | null = null;
    let songCount = 0;
    for (const item of body) {
      if (hasText(item.node)) sectionContentEnd = item.to;
      if (isTransitionBlock(item.node)) {
        if (!transition) {
          let notes = false;
          item.node.forEach((child, _offset, childIndex) => {
            if (childIndex > 0 && child.textContent.trim()) notes = true;
          });
          transition = { from: item.from, to: item.to, hasNotes: notes };
        }
      } else {
        songCount += feedbackCount(item.node);
      }
    }
    tracks.push({
      ...heading,
      from: block.from,
      headerEnd: block.to,
      to: end < blocks.length ? blocks[end].from : doc.content.size,
      contentEnd: sectionContentEnd,
      transition,
      songCount,
    });
  });

  const structure = { tracks, contentEnd };
  structureCache.set(doc, structure);
  return structure;
}

function text(value: string, bold = false): JSONContent {
  return bold ? { type: "text", text: value, marks: [{ type: "bold" }] } : { type: "text", text: value };
}

function withStamp(value: string, timestamp: string | null): string {
  return timestamp ? `${value} ${timestamp}` : value;
}

function transitionLabel(from: number, to: number, timestamp: string | null): string {
  return withStamp(`${TRANSITION_MARK} 전환 ${padTrack(from)} → ${padTrack(to)}`, timestamp);
}

function transitionBlock(from: number, to: number, timestamp: string | null): JSONContent {
  return {
    type: "blockquote",
    content: [{ type: "paragraph", content: [text(transitionLabel(from, to, timestamp))] }, { type: "paragraph" }],
  };
}

/** 문서 위치 `position`에 있는 블록 안 맨 끝 글자 위치로 커서를 옮긴다. */
function focusEndOf(editor: Editor, blockEnd: number): void {
  const position = Math.max(1, Math.min(blockEnd - 1, editor.state.doc.content.size));
  editor.chain().focus().setTextSelection(position).scrollIntoView().run();
}

function lastTrack(editor: Editor): LessonTrack | null {
  return readLessonStructure(editor.state.doc).tracks.at(-1) ?? null;
}

export function nextTrackNumber(structure: LessonStructure): number {
  return structure.tracks.reduce((max, track) => Math.max(max, track.number), 0) + 1;
}

/** 전환 칸의 마지막 줄(비었으면 그 줄, 아니면 새 줄)에 커서를 둔다. */
function focusTransitionNotes(editor: Editor, transition: LessonTransition): void {
  const node = editor.state.doc.nodeAt(transition.from);
  if (!node) return;
  const last = node.lastChild;
  if (node.childCount > 1 && last && last.isTextblock && last.content.size === 0) {
    focusEndOf(editor, transition.to - 1);
    return;
  }
  editor.chain().insertContentAt(transition.to - 1, { type: "paragraph" }).run();
  focusEndOf(editor, transition.to + 1);
}

/**
 * 다음 곡으로: 지금 트랙 끝에 전환 칸(이미 있으면 그대로)과 다음 트랙 제목을 넣고 전환 칸에 커서를 둔다.
 * 트랙이 아직 없으면 첫 트랙 제목만 넣고 그 아래 빈 줄에 커서를 둔다.
 */
export function insertNextTrack(editor: Editor, { title = "", timestamp = null }: { title?: string; timestamp?: string | null } = {}): number {
  const structure = readLessonStructure(editor.state.doc);
  const current = structure.tracks.at(-1) ?? null;
  const number = nextTrackNumber(structure);
  const cleanTitle = title.replace(/\s+/gu, " ").trim();
  const heading: JSONContent = {
    type: "heading",
    attrs: { level: 3 },
    content: [text(withStamp(`트랙 ${padTrack(number)}${cleanTitle ? ` · ${cleanTitle}` : ""}`, timestamp))],
  };

  if (!current) {
    const at = structure.contentEnd;
    editor.chain().insertContentAt(at, [heading, { type: "paragraph" }]).run();
    const inserted = lastTrack(editor);
    if (inserted) focusEndOf(editor, inserted.headerEnd + 2);
    return number;
  }

  const nodes = current.transition ? [heading] : [transitionBlock(current.number, number, timestamp), heading];
  editor.chain().insertContentAt(current.contentEnd, nodes).run();
  const previous = readLessonStructure(editor.state.doc).tracks.find((track) => track.from === current.from);
  if (previous?.transition) focusTransitionNotes(editor, previous.transition);
  return number;
}

/** 곡 피드백: 지금 트랙의 곡 피드백 목록 끝(전환 칸 앞)에 새 항목을 열고 커서를 둔다. */
export function insertSongFeedback(editor: Editor): void {
  const structure = readLessonStructure(editor.state.doc);
  const current = structure.tracks.at(-1) ?? null;
  const regionStart = current ? current.headerEnd : 0;
  const regionEnd = current ? (current.transition ? current.transition.from : current.contentEnd) : structure.contentEnd;

  let lastBlock: TopBlock | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (offset >= regionStart && offset + node.nodeSize <= regionEnd && hasText(node) && !isTransitionBlock(node)) {
      lastBlock = { node, from: offset, to: offset + node.nodeSize };
    }
  });
  const found = lastBlock as TopBlock | null;

  if (found && found.node.type.name === "bulletList") {
    const lastItem = found.node.lastChild;
    if (lastItem && !lastItem.textContent.trim()) {
      focusEndOf(editor, found.to - 2);
      return;
    }
    editor.chain().insertContentAt(found.to - 1, { type: "listItem", content: [{ type: "paragraph" }] }).run();
    focusEndOf(editor, found.to + 2);
    return;
  }
  const at = found ? found.to : regionStart > 0 ? regionStart : structure.contentEnd;
  editor.chain().insertContentAt(at, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }).run();
  focusEndOf(editor, at + 4);
}

/** 전환 메모: 지금 트랙의 전환 칸(없으면 만든다)에 줄을 열고 커서를 둔다. 트랙이 없으면 false. */
export function insertTransitionNote(editor: Editor, { timestamp = null }: { timestamp?: string | null } = {}): boolean {
  const current = lastTrack(editor);
  if (!current) return false;
  if (current.transition) {
    focusTransitionNotes(editor, current.transition);
    return true;
  }
  editor.chain().insertContentAt(current.contentEnd, transitionBlock(current.number, current.number + 1, timestamp)).run();
  const updated = lastTrack(editor);
  if (updated?.transition) focusTransitionNotes(editor, updated.transition);
  return true;
}

/**
 * 빠른 태그: 편집기에 초점이 있고 커서가 피드백 줄에 있으면 그 줄 앞에 굵은 라벨을 붙인다.
 * 그렇지 않으면(트랙 제목·전환 머리 줄이거나 초점이 밖에 있으면) 곡 피드백 줄을 새로 열고 붙인다.
 */
export function insertLessonTag(editor: Editor, label: string): void {
  const { $from } = editor.state.selection;
  const block = $from.parent;
  const top = $from.depth > 0 ? $from.node(1) : null;
  const inTransitionLabel = top !== null && isTransitionBlock(top) && $from.depth >= 2 && $from.index(1) === 0;
  const usable = editor.view.hasFocus()
    && block.isTextblock
    && block.type.name !== "heading"
    && !(top && readTrackHeading(top))
    && !inTransitionLabel
    && block.type.name !== "codeBlock";
  if (!usable) insertSongFeedback(editor);
  // 줄 맨 앞에 넣고 커서는 원래 자리(빈 줄이면 라벨 뒤)를 따라간다.
  const start = editor.state.selection.$from.start();
  editor.chain().focus().insertContentAt(start, [text(label, true), text(" ")], { updateSelection: false }).run();
}

const TRAILING_TIMESTAMP = /\s*\[(?:\d{1,2}:)?\d{1,3}:[0-5]\d\]\s*$/u;

/** 세트 목록에서 누른 트랙 제목의 곡명 자리(맨 끝 시점 앞)로 커서를 옮긴다. */
export function focusLessonTrack(editor: Editor, number: number): void {
  const track = readLessonStructure(editor.state.doc).tracks.find((item) => item.number === number);
  if (!track) return;
  const node = editor.state.doc.nodeAt(track.from);
  const trailing = node ? TRAILING_TIMESTAMP.exec(node.textContent)?.[0].length ?? 0 : 0;
  focusEndOf(editor, track.headerEnd - trailing);
}

const INLINE_OPEN = "(?:<[^>]+>)*\\s*";
const NUMBER_END = "(?=\\s|$|<|[·:\\-–—[])";
const TRACK_HEADING_HTML = new RegExp(`<(h[1-6])(\\s[^>]*)?>(?=${INLINE_OPEN}(?:▸\\s*)?트랙\\s*\\d{1,3}${NUMBER_END})`, "gu");
const TRACK_PARAGRAPH_HTML = new RegExp(`<(p)(\\s[^>]*)?>(?=${INLINE_OPEN}▸\\s*트랙\\s*\\d{1,3}${NUMBER_END})`, "gu");
const TRANSITION_HTML = new RegExp(`<(blockquote)(\\s[^>]*)?>(?=\\s*<p[^>]*>${INLINE_OPEN}${TRANSITION_MARK})`, "gu");

/**
 * 읽기 화면(정화한 HTML)에도 편집기 decoration과 같은 class를 붙인다. 고정 class 이름만 더하므로 정화 결과를 넓히지 않는다.
 */
export function markLessonBlocksHtml(html: string): string {
  if (!html.includes("트랙") && !html.includes(TRANSITION_MARK)) return html;
  const mark = (className: string) => (whole: string, tag: string, attributes: string | undefined) =>
    attributes && /\sclass=/u.test(attributes) ? whole : `<${tag} class="${className}"${attributes ?? ""}>`;
  return html
    .replace(TRACK_HEADING_HTML, mark("lesson-track"))
    .replace(TRACK_PARAGRAPH_HTML, mark("lesson-track"))
    .replace(TRANSITION_HTML, mark("lesson-transition"));
}
