import type * as Y from "yjs";
import { applyUpdate, Doc as YDoc } from "yjs";
import { getHTMLFromFragment, getSchema, type AnyExtension } from "@tiptap/core";
import { yXmlFragmentToProsemirror } from "@tiptap/y-tiptap";
import type { Schema } from "@tiptap/pm/model";
import { buildCollabSeedUpdate, COLLAB_FRAGMENT } from "./seed";

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
