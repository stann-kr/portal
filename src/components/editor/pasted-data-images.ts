import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * 다른 문서에서 복사한 글에는 이미지가 주소가 아니라 내용 통째(data URL)로 들어 있을 수 있다.
 * 그대로 넣으면 본문이 크기 한도를 넘어 그 뒤 저장이 계속 실패하므로, 붙여넣을 때 골라내 파일로 올린다
 * (2026-11-14 사용자 결정 paste-image=upload, 캔버스 "코드 리뷰 2차 후속" ④).
 */

const DATA_URL_PREFIX = /^\s*data:/iu;
const BASE64_DATA_URL = /^\s*data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;[a-z0-9-]+=[^;,]*)*;base64,([a-z0-9+/\s]*={0,2})\s*$/iu;

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function isDataImageNode(node: ProseMirrorNode): boolean {
  return node.type.name === "image" && typeof node.attrs.src === "string" && DATA_URL_PREFIX.test(node.attrs.src);
}

function withoutDataImages(fragment: Fragment, found: string[]): Fragment {
  const kept: ProseMirrorNode[] = [];
  fragment.forEach((child) => {
    if (isDataImageNode(child)) {
      found.push(String(child.attrs.src));
      return;
    }
    if (child.isLeaf || child.content.size === 0) {
      kept.push(child);
      return;
    }
    const before = found.length;
    const content = withoutDataImages(child.content, found);
    if (found.length === before) {
      kept.push(child);
      return;
    }
    if (child.type.validContent(content)) {
      kept.push(child.copy(content));
      return;
    }
    // 이미지만 들어 있던 칸(표 칸 등)은 빈 문단으로 채운다. 채울 수 없는 node는 함께 뺀다.
    const refilled = child.type.createAndFill(child.attrs, content, child.marks);
    if (refilled) kept.push(refilled);
  });
  return Fragment.fromArray(kept);
}

/** 조각의 앞·뒤 끝에서 열어 둘 수 있는 가장 깊은 단계. 이미지를 빼 구조가 얕아졌으면 열린 깊이를 여기에 맞춘다. */
function openableDepth(fragment: Fragment, fromStart: boolean): number {
  let depth = 0;
  let node = fromStart ? fragment.firstChild : fragment.lastChild;
  while (node && !node.isLeaf) {
    depth += 1;
    node = fromStart ? node.firstChild : node.lastChild;
  }
  return depth;
}

/** 붙여넣을 조각에서 data URL 이미지를 빼고, 뺀 이미지의 주소를 문서 순서대로 돌려준다. */
export function extractPastedDataImages(slice: Slice): { slice: Slice; sources: string[] } {
  const sources: string[] = [];
  const content = withoutDataImages(slice.content, sources);
  if (sources.length === 0) return { slice, sources };
  if (content.size === 0) return { slice: Slice.empty, sources };
  return {
    slice: new Slice(
      content,
      Math.min(slice.openStart, openableDepth(content, true)),
      Math.min(slice.openEnd, openableDepth(content, false)),
    ),
    sources,
  };
}

/**
 * data URL을 업로드할 파일로 바꾼다. 읽을 수 없는 주소도 파일(빈 내용)로 돌려, 형식·크기 확인이
 * 다른 이미지와 같은 자리에서 이유를 알리게 한다. 파일 이름은 대체 글자로도 쓰인다.
 */
export function pastedDataImageFile(source: string): File {
  const match = BASE64_DATA_URL.exec(source);
  const mimeType = match?.[1]?.toLowerCase() ?? "application/octet-stream";
  const name = `붙여넣은 이미지.${EXTENSION_BY_MIME_TYPE[mimeType] ?? "bin"}`;
  if (!match) return new File([], name, { type: mimeType });
  try {
    const binary = atob(match[2].replace(/\s+/gu, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], name, { type: mimeType });
  } catch {
    return new File([], name, { type: mimeType });
  }
}

/** 형식·크기 때문에 넣지 못한 붙여넣은 이미지 안내. `reason`은 파일로 넣을 때와 같은 문구다. */
export function pastedImagesRejectedMessage(count: number, reason: string): string {
  return `붙여넣은 이미지 ${count}장을 넣지 못했습니다. ${reason}`;
}

/** 올리다 실패해 본문에서 뺀 붙여넣은 이미지 안내. */
export function pastedImagesUploadFailedMessage(count: number): string {
  return `붙여넣은 이미지 ${count}장을 올리지 못해 뺐습니다. 이미지 버튼으로 다시 넣어 주세요.`;
}
