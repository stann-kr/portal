import * as Y from "yjs";
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "@noble/hashes/utils";
import { getSchema, generateJSON, type AnyExtension } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";

/**
 * 빈 room을 서버 head로 채우는 결정적 시드.
 * 같은 key·version·내용이면 clientID와 연산이 같아 여러 기기가 동시에 넣어도 한 번만 들어간다.
 * "시딩됨" 표시는 본문이 아니라 `meta.seeded`로 판단한다(사용자가 내용을 모두 지운 경우와 구분).
 */
export const COLLAB_FRAGMENT = "default";
export const COLLAB_META = "meta";
export const COLLAB_META_SEEDED = "seeded";

export type CollabSeedFields = Record<string, string | number | null>;

export type CollabSeedInput = {
  key: string;
  version: number;
  html: string;
  fields?: CollabSeedFields;
};

export function collabSeedClientId(input: CollabSeedInput): number {
  const fields = JSON.stringify(Object.entries(input.fields ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const digest = sha256(utf8ToBytes(`${input.key}\u0000${input.version}\u0000${fields}\u0000${input.html}`));
  // Yjs clientID는 uint32. 0은 피한다.
  const value = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  return value === 0 ? 1 : value;
}

export function isCollabDocSeeded(doc: Y.Doc): boolean {
  return doc.getMap(COLLAB_META).has(COLLAB_META_SEEDED);
}

export function buildCollabSeedUpdate(input: CollabSeedInput, extensions: AnyExtension[]): Uint8Array {
  const schema = getSchema(extensions);
  const json = generateJSON(input.html.trim() ? input.html : "<p></p>", extensions);
  const seedDoc = new Y.Doc({ gc: false });
  seedDoc.clientID = collabSeedClientId(input);
  seedDoc.transact(() => {
    prosemirrorJSONToYXmlFragment(schema, json, seedDoc.getXmlFragment(COLLAB_FRAGMENT));
    const meta = seedDoc.getMap(COLLAB_META);
    for (const [name, value] of Object.entries(input.fields ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      meta.set(name, value);
    }
    meta.set(COLLAB_META_SEEDED, input.version);
  });
  const update = Y.encodeStateAsUpdate(seedDoc);
  seedDoc.destroy();
  return update;
}

export function seedCollabDoc(doc: Y.Doc, input: CollabSeedInput, extensions: AnyExtension[]): boolean {
  if (isCollabDocSeeded(doc)) return false;
  Y.applyUpdate(doc, buildCollabSeedUpdate(input, extensions), "seed");
  return true;
}
