import { defaultTreeAdapter, parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { parseMediaUuidV4 } from "@/lib/media-lifecycle";

const MEDIA_DELIVERY_PATH_PATTERN = /^\/api\/media\/([0-9a-fA-F-]{36})$/u;

/**
 * 저장할 본문 HTML의 img가 참조하는 관리 media ID를 문서 순서대로 중복 없이 꺼낸다.
 * 속성 값 안의 `>` 같은 정상 HTML도 놓치지 않도록 실제 HTML parser로 읽는다.
 */
export function extractDocumentImageMediaIds(contentHtml: string): string[] {
  const ids = new Set<string>();
  const pending: DefaultTreeAdapterTypes.ParentNode[] = [parseFragment(contentHtml)];
  while (pending.length > 0) {
    const node = pending.pop()!;
    const children = defaultTreeAdapter.getChildNodes(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]!;
      if (!defaultTreeAdapter.isElementNode(child)) continue;
      if (child.tagName === "img") {
        const source = child.attrs.find((attribute) => attribute.name === "src")?.value;
        const match = source?.match(MEDIA_DELIVERY_PATH_PATTERN);
        const id = match ? parseMediaUuidV4(match[1]) : null;
        if (id) ids.add(id);
      }
      pending.push(child);
    }
  }
  return [...ids];
}
