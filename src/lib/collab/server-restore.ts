import * as Y from "yjs";
import { parseHTML } from "linkedom";
import { getSchema, type AnyExtension } from "@tiptap/core";
import { DOMParser as PmDOMParser, DOMSerializer, type Schema, type Node as PmNodeType } from "@tiptap/pm/model";
import { updateYFragment, yXmlFragmentToProsemirror } from "@tiptap/y-tiptap";
import { createFullEditorExtensions } from "@/components/editor/full-editor-extensions";
import { COLLAB_FRAGMENT, COLLAB_META, COLLAB_META_SEEDED } from "./client/seed";
import { mergeCollabDocuments, type MergeFields, type PmDoc } from "./client/merge";

/**
 * 서버에서 room 상태(Yjs)와 저장 HTML을 오간다. 복원을 "room을 비우고 다시 시작"이 아니라
 * 같은 live 문서에 적용하는 한 번의 Yjs update로 만들 때 쓴다.
 *
 * - DOM은 전역을 바꾸지 않고 linkedom 문서를 만들어 ProseMirror DOMParser/DOMSerializer에 직접 넘긴다.
 * - schema는 편집기와 같은 확장 목록(full-editor-extensions)에서 만든다(노트·게시물은 블록 id 없음).
 * - update는 room 상태를 복제한 임시 doc(매번 새 clientID)에서 만들어, 서버만 한 번 만든다(room이 조건부로 한 번 적용).
 */

/** 저장 HTML·Y meta에 쓰지 않는 내부 칸. 내용 비교·병합에서 뺀다. */
export const COLLAB_META_LIFECYCLE = "lifecycle";
const INTERNAL_FIELDS = new Set([COLLAB_META_SEEDED, "savedHash", "headVersion", "operationId", COLLAB_META_LIFECYCLE]);

let cachedExtensions: AnyExtension[] | null = null;
let cachedSchema: Schema | null = null;

function serverSchema(): { extensions: AnyExtension[]; schema: Schema } {
  cachedExtensions ??= createFullEditorExtensions();
  cachedSchema ??= getSchema(cachedExtensions);
  return { extensions: cachedExtensions, schema: cachedSchema };
}

export function collabHtmlToPmNode(html: string, schema: Schema = serverSchema().schema): PmNodeType {
  const { document } = parseHTML(`<!doctype html><html><head></head><body>${html.trim() ? html : "<p></p>"}</body></html>`);
  return PmDOMParser.fromSchema(schema).parse(document.body as unknown as Node);
}

export function collabPmNodeToHtml(node: PmNodeType, schema: Schema = serverSchema().schema): string {
  const { document } = parseHTML("<!doctype html><html><head></head><body></body></html>");
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(node.content, { document: document as unknown as Document });
  const container = document.createElement("div");
  container.appendChild(fragment as unknown as Parameters<typeof container.appendChild>[0]);
  return container.innerHTML;
}

function contentFields(doc: Y.Doc): MergeFields {
  const fields: MergeFields = {};
  for (const [name, value] of doc.getMap(COLLAB_META).entries()) {
    if (INTERNAL_FIELDS.has(name) || name.endsWith("@v")) continue;
    if (typeof value === "string" || typeof value === "number" || value === null) fields[name] = value as string | number | null;
  }
  return fields;
}

function docFromState(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc({ gc: true });
  Y.applyUpdate(doc, state);
  return doc;
}

/** room 상태의 본문 HTML과 칸. checkpoint 저장·게시본 비교에 쓴다. 시드되지 않은 room은 null. */
export function readCollabStateContent(state: Uint8Array): { html: string; fields: MergeFields; seeded: boolean } {
  const { schema } = serverSchema();
  const doc = docFromState(state);
  try {
    const seeded = doc.getMap(COLLAB_META).has(COLLAB_META_SEEDED);
    const node = yXmlFragmentToProsemirror(schema, doc.getXmlFragment(COLLAB_FRAGMENT));
    return { html: collabPmNodeToHtml(node, schema), fields: contentFields(doc), seeded };
  } finally {
    doc.destroy();
  }
}

/** 편집기 schema로 한 번 읽고 다시 쓴 HTML(서로 다른 저장 형식을 같은 기준으로 비교). */
export function canonicalServerHtml(html: string): string {
  const { schema } = serverSchema();
  return collabPmNodeToHtml(collabHtmlToPmNode(html, schema), schema);
}

function randomClientId(taken: Set<number>): number {
  const bytes = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(bytes);
    const id = bytes[0] >>> 0;
    if (id !== 0 && !taken.has(id)) return id;
  }
}

export type CollabRestoreInput = {
  /** 복원 준비 때 남긴 room 상태(S). 그 뒤의 변경은 동시 입력으로 보고 남긴다. 없으면 current. */
  base: Uint8Array | null;
  /** 지금 room 상태(C). update는 이 상태 위에 적용된다. */
  current: Uint8Array;
  /** 복원 revision의 본문 HTML과 칸. */
  html: string;
  fields: MergeFields;
  /** 복원 revision 번호(lifecycle 표지). */
  lifecycle: number;
};

/**
 * 복원을 지금 room 상태(C) 위의 한 update로 만든다.
 * 목표 = merge3(base=S, mine=C, theirs=복원본): S 뒤에 들어온 동시 입력은 문서에 남기고(겹치면 복원 블록 뒤에),
 * 칸 충돌은 동시 입력을 남긴다. meta에는 칸과 `lifecycle`을 같은 transaction으로 쓴다.
 */
export function buildCollabRestoreUpdate(input: CollabRestoreInput): Uint8Array {
  const { schema } = serverSchema();
  const current = docFromState(input.current);
  const base = input.base ? docFromState(input.base) : null;
  try {
    const theirsNode = collabHtmlToPmNode(input.html, schema);
    const read = (doc: Y.Doc) => yXmlFragmentToProsemirror(schema, doc.getXmlFragment(COLLAB_FRAGMENT)).toJSON() as PmDoc;
    const currentPm = read(current);
    const merged = mergeCollabDocuments({
      base: base ? read(base) : currentPm,
      mine: currentPm,
      theirs: theirsNode.toJSON() as PmDoc,
      baseFields: base ? contentFields(base) : contentFields(current),
      mineFields: contentFields(current),
      theirsFields: input.fields,
      fieldConflict: "mine",
    });
    const target = schema.nodeFromJSON(merged.doc);
    const before = Y.encodeStateVector(current);
    current.clientID = randomClientId(new Set(current.store.clients.keys()));
    current.transact(() => {
      updateYFragment(current, current.getXmlFragment(COLLAB_FRAGMENT), target, { mapping: new Map(), isOMark: new Map() });
      const meta = current.getMap(COLLAB_META);
      for (const [name, value] of Object.entries(merged.fields)) {
        if (INTERNAL_FIELDS.has(name)) continue;
        if (meta.get(name) !== value) meta.set(name, value);
      }
      if (!meta.has(COLLAB_META_SEEDED)) meta.set(COLLAB_META_SEEDED, true);
      meta.set(COLLAB_META_LIFECYCLE, input.lifecycle);
    });
    return Y.encodeStateAsUpdate(current, before);
  } finally {
    current.destroy();
    base?.destroy();
  }
}
