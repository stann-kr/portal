import type * as Y from "yjs";
import { getHTMLFromFragment, getSchema, type AnyExtension } from "@tiptap/core";
import { yXmlFragmentToProsemirror } from "@tiptap/y-tiptap";
import type { Schema } from "@tiptap/pm/model";
import { COLLAB_FRAGMENT } from "./seed";

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
