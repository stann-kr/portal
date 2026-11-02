import * as Y from "yjs";
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "@noble/hashes/utils";
import { getSchema, generateJSON, type AnyExtension } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";

/**
 * 빈 room을 서버 head로 채우는 결정적 시드.
 * 같은 key·내용이면 clientID와 연산이 같아 여러 기기가 동시에 넣어도 한 번만 들어간다.
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

/**
 * 본문 시드 clientID는 room key와 본문으로만 정한다. version·제목이 달라도 본문이 같으면 같은 시드라
 * 합쳐도 한 번만 들어간다. 칸(제목 등)은 별도 clientID(key·칸 값)로 넣어, 칸이 달라도 본문이 겹치지 않고
 * 칸은 room `meta`에서 하나로 수렴한다. 본문이 다른 head로 따로 시드된 경우만 중복될 수 있어, 서버 연결 없이
 * 시드하는 일은 처음 연 문서를 오프라인으로 열었을 때로 제한한다(useCollabDocument).
 */
function hashClientId(text: string): number {
  const digest = sha256(utf8ToBytes(text));
  // Yjs clientID는 uint32. 0은 피한다.
  const value = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  return value === 0 ? 1 : value;
}

export function collabSeedClientId(input: CollabSeedInput): number {
  return hashClientId(`body\u0000${input.key}\u0000${input.html}`);
}

function collabSeedFieldsClientId(input: CollabSeedInput): number {
  const fields = JSON.stringify(Object.entries(input.fields ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return hashClientId(`fields\u0000${input.key}\u0000${fields}`);
}

export function isCollabDocSeeded(doc: Y.Doc): boolean {
  return doc.getMap(COLLAB_META).has(COLLAB_META_SEEDED);
}

export function buildCollabSeedUpdate(input: CollabSeedInput, extensions: AnyExtension[]): Uint8Array {
  const schema = getSchema(extensions);
  const json = generateJSON(input.html.trim() ? input.html : "<p></p>", extensions);
  const bodyDoc = new Y.Doc({ gc: false });
  bodyDoc.clientID = collabSeedClientId(input);
  bodyDoc.transact(() => {
    prosemirrorJSONToYXmlFragment(schema, json, bodyDoc.getXmlFragment(COLLAB_FRAGMENT));
    // version은 넣지 않는다(같은 본문의 시드가 바이트까지 같도록).
    bodyDoc.getMap(COLLAB_META).set(COLLAB_META_SEEDED, true);
  });
  const updates = [Y.encodeStateAsUpdate(bodyDoc)];
  bodyDoc.destroy();
  const entries = Object.entries(input.fields ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length > 0) {
    const fieldsDoc = new Y.Doc({ gc: false });
    fieldsDoc.clientID = collabSeedFieldsClientId(input);
    fieldsDoc.transact(() => {
      const meta = fieldsDoc.getMap(COLLAB_META);
      for (const [name, value] of entries) meta.set(name, value);
    });
    updates.push(Y.encodeStateAsUpdate(fieldsDoc));
    fieldsDoc.destroy();
  }
  return Y.mergeUpdates(updates);
}

export function seedCollabDoc(doc: Y.Doc, input: CollabSeedInput, extensions: AnyExtension[]): boolean {
  if (isCollabDocSeeded(doc)) return false;
  Y.applyUpdate(doc, buildCollabSeedUpdate(input, extensions), "seed");
  return true;
}
