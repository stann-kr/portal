import type * as Y from "yjs";
import { applyUpdate, Doc as YDoc } from "yjs";
import { getHTMLFromFragment, getSchema, type AnyExtension } from "@tiptap/core";
import { updateYFragment, yXmlFragmentToProsemirror } from "@tiptap/y-tiptap";
import type { Schema } from "@tiptap/pm/model";
import { buildCollabSeedUpdate, COLLAB_FRAGMENT, COLLAB_META } from "./seed";

/**
 * Y.Doc 본문을 편집기와 같은 schema로 HTML로 만든다. 저장 담당은 편집기 mount 여부와 관계없이 이 값을 저장한다.
 */
const schemaCache = new WeakMap<AnyExtension[], Schema>();

export function collabDocHtml(doc: Y.Doc, extensions: AnyExtension[]): string {
  let schema = schemaCache.get(extensions);
  if (!schema) {
    schema = getSchema(extensions);
    schemaCache.set(extensions, schema);
  }
  const node = yXmlFragmentToProsemirror(schema, doc.getXmlFragment(COLLAB_FRAGMENT));
  return getHTMLFromFragment(node.content, schema);
}

/** 서버 HTML을 편집기 schema로 한 번 읽고 다시 쓴 형태. room 본문과 같은 내용인지 비교할 때 쓴다. */
export function canonicalCollabHtml(html: string, extensions: AnyExtension[]): string {
  const doc = new YDoc();
  try {
    applyUpdate(doc, buildCollabSeedUpdate({ key: "canonical", version: 0, html }, extensions));
    return collabDocHtml(doc, extensions);
  } finally {
    doc.destroy();
  }
}

/**
 * room 본문을 주어진 HTML로 바꾸고 meta 칸을 함께 고친다(한 transaction이라 다른 기기에도 한 번에 간다).
 * 이미 올린 글 고치기의 "취소"(기준 본문으로 되돌리기)와 저장 뒤 기준 맞추기에 쓴다.
 */
export function replaceCollabDocHtml(
  doc: Y.Doc,
  html: string,
  extensions: AnyExtension[],
  fields: Record<string, string> = {},
): void {
  if (doc.isDestroyed) return;
  const source = new YDoc();
  try {
    applyUpdate(source, buildCollabSeedUpdate({ key: "replace", version: 0, html }, extensions));
    const schema = getSchema(extensions);
    const node = yXmlFragmentToProsemirror(schema, source.getXmlFragment(COLLAB_FRAGMENT));
    doc.transact(() => {
      updateYFragment(doc, doc.getXmlFragment(COLLAB_FRAGMENT), node, { mapping: new Map(), isOMark: new Map() });
      const meta = doc.getMap(COLLAB_META);
      for (const [name, value] of Object.entries(fields)) {
        if (meta.get(name) !== value) meta.set(name, value);
      }
    });
  } finally {
    source.destroy();
  }
}
