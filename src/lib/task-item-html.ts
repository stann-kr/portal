import { defaultTreeAdapter, html, parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";

type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

function isElement(node: DefaultTreeAdapterTypes.ChildNode): node is Element {
  return defaultTreeAdapter.isElementNode(node);
}

function isTaskItem(element: Element): boolean {
  return (
    defaultTreeAdapter.getTagName(element) === "li" &&
    element.attrs.some((attribute) => attribute.name === "data-type" && attribute.value === "taskItem")
  );
}

/** 편집기(Tiptap TaskItem)와 같게 `<label><span></span></label><div>내용</div>`으로 감싼다. 바꿨으면 true. */
function normalizeTaskItem(item: Element): boolean {
  const children = defaultTreeAdapter.getChildNodes(item);
  if (children.some((child) => isElement(child) && defaultTreeAdapter.getTagName(child) === "label")) return false;

  const label = defaultTreeAdapter.createElement("label", html.NS.HTML, []);
  defaultTreeAdapter.appendChild(label, defaultTreeAdapter.createElement("span", html.NS.HTML, []));
  const content = defaultTreeAdapter.createElement("div", html.NS.HTML, []);
  for (const child of [...children]) {
    defaultTreeAdapter.detachNode(child);
    defaultTreeAdapter.appendChild(content, child);
  }
  defaultTreeAdapter.appendChild(item, label);
  defaultTreeAdapter.appendChild(item, content);
  return true;
}

function normalizeWithin(parent: ParentNode): boolean {
  let changed = false;
  for (const child of defaultTreeAdapter.getChildNodes(parent)) {
    if (!isElement(child)) continue;
    if (isTaskItem(child) && normalizeTaskItem(child)) changed = true;
    if (normalizeWithin(child)) changed = true;
  }
  return changed;
}

/**
 * 정화한 HTML에서 칸(label)이 없는 체크 항목에 편집기와 같은 칸 구조를 보충한다.
 * 가이드 가져오기처럼 편집기를 거치지 않고 저장된 글도 읽기 화면에서 체크 칸이 보이게 한다.
 * 정화가 허용하는 태그(label·span·div)만 더하고, 바꿀 항목이 없으면 원문을 그대로 돌려준다.
 */
export function normalizeTaskItemsHtml(sanitizedHtml: string): string {
  if (!sanitizedHtml.includes('data-type="taskItem"')) return sanitizedHtml;
  const context = defaultTreeAdapter.createElement("div", html.NS.HTML, []);
  const fragment = parseFragment(context, sanitizedHtml, {});
  return normalizeWithin(fragment) ? serialize(fragment) : sanitizedHtml;
}
