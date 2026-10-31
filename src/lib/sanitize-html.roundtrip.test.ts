/**
 * @file src/lib/sanitize-html.roundtrip.test.ts
 * @description Tiptap(FullEditor와 같은 확장)이 내는 HTML을 `sanitizeHtml`이 그대로 돌려주는지(round-trip) 확인한다.
 * 편집기가 자기 저장 응답(sanitize된 HTML)으로 `setContent`하면 커서·undo를 잃으므로, 어떤 태그·속성이 달라지는지가
 * 그 설계(저장 응답으로 본문을 되돌려 넣지 않는다)의 근거다. 달라지는 case는 실패가 아니라 "알려진 차이"로 정확히 고정한다.
 *
 * `@tiptap/html`이 설치돼 있지 않아 `@tiptap/core`의 `generateHTML`을 happy-dom 전역 document 위에서 돌린다.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Window } from "happy-dom";
import { generateHTML, type Extensions, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
import ImageExtension from "@tiptap/extension-image";
import YoutubeExtension from "@tiptap/extension-youtube";
import { Table as TableExtension } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Typography from "@tiptap/extension-typography";
import { common, createLowlight } from "lowlight";
import { sanitizeHtml } from "./sanitize-html";

// FullEditor.tsx의 SafeTextAlign과 같다: style 대신 allowlist 가능한 data-text-align만 낸다.
const SafeTextAlign = TextAlign.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: this.options.defaultAlignment,
            parseHTML: (element: HTMLElement) => {
              const alignment = element.getAttribute("data-text-align") ?? element.style.textAlign;
              return this.options.alignments.includes(alignment) ? alignment : this.options.defaultAlignment;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const alignment = attributes.textAlign;
              return typeof alignment === "string" && this.options.alignments.includes(alignment)
                ? { "data-text-align": alignment }
                : {};
            },
          },
        },
      },
    ];
  },
});

/** FullEditor.tsx 429~470행과 같은 확장 구성(Placeholder·Markdown·GuideBlockId는 출력 HTML에 관여하지 않아 뺀다). */
function createEditorExtensions(): Extensions {
  return [
    StarterKit.configure({ codeBlock: false, link: false, underline: false }),
    Underline,
    Highlight.configure({ multicolor: false }),
    SafeTextAlign.configure({ types: ["heading", "paragraph"] }),
    LinkExtension.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: { class: "text-primary underline underline-offset-2 cursor-pointer" },
    }),
    ImageExtension.configure({ inline: false, allowBase64: true, HTMLAttributes: { class: "rounded-lg max-w-full my-2" } }),
    YoutubeExtension.configure({ controls: true, nocookie: true, HTMLAttributes: { class: "rounded-lg my-2" } }),
    TableExtension.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    CodeBlockLowlight.configure({ lowlight: createLowlight(common), HTMLAttributes: { class: "not-prose" } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Typography,
  ];
}

const text = (value: string, marks?: JSONContent["marks"]): JSONContent => (marks ? { type: "text", text: value, marks } : { type: "text", text: value });
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

/** sanitize가 Tiptap 출력을 그대로 돌려주는 대표 문서. */
const roundTripCases: Record<string, JSONContent> = {
  "제목·문단": doc({ type: "heading", attrs: { level: 1 }, content: [text("수업 노트")] }, { type: "heading", attrs: { level: 2 }, content: [text("오늘 한 것")] }, paragraph(text("비트매칭 연습"))),
  "굵게·기울임·밑줄·취소선": doc(paragraph(text("굵게", [{ type: "bold" }]), text(" "), text("기울임", [{ type: "italic" }]), text(" "), text("밑줄", [{ type: "underline" }]), text(" "), text("취소", [{ type: "strike" }]))),
  "하이라이트·인라인 코드": doc(paragraph(text("강조", [{ type: "highlight" }]), text(" "), text("cue", [{ type: "code" }]))),
  "글머리 목록": doc({ type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("첫째"))] }, { type: "listItem", content: [paragraph(text("둘째"))] }] }),
  "번호 목록(start)": doc({ type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [paragraph(text("셋째"))] }] }),
  "인용": doc({ type: "blockquote", content: [paragraph(text("박자를 먼저 들어라"))] }),
  "가운데 정렬": doc({ type: "paragraph", attrs: { textAlign: "center" }, content: [text("가운데")] }),
  "구분선": doc(paragraph(text("위")), { type: "horizontalRule" }, paragraph(text("아래"))),
  "줄바꿈": doc(paragraph(text("첫 줄"), { type: "hardBreak" }, text("둘째 줄"))),
};

/**
 * 알려진 차이(2026-10-31 확인, Tiptap core 3.x + parse5 sanitize). sanitize가 class·style·허용 목록 밖 속성을 떼므로
 * 저장 응답 HTML은 편집기 출력과 같지 않다 → 편집기는 자기 저장 응답으로 `setContent`하지 않아야 한다.
 * 저장본을 다시 열면 Tiptap이 parseHTML로 같은 문서를 복원하므로(언어·체크 상태 제외) 읽기 화면에는 영향이 없다.
 */
const knownDifferenceCases: Record<string, { json: JSONContent; tiptap: string; sanitized: string; note: string }> = {
  "링크": {
    json: doc(paragraph(text("참고 "), text("영상", [{ type: "link", attrs: { href: "https://example.com/mix" } }]))),
    tiptap: '<p>참고 <a target="_blank" rel="noopener noreferrer nofollow" class="text-primary underline underline-offset-2 cursor-pointer" href="https://example.com/mix">영상</a></p>',
    sanitized: '<p>참고 <a href="https://example.com/mix">영상</a></p>',
    note: "a의 target·rel·class를 뗀다(href만 남김).",
  },
  "체크리스트": {
    json: doc({ type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph(text("한 것"))] }, { type: "taskItem", attrs: { checked: false }, content: [paragraph(text("할 것"))] }] }),
    tiptap: '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>한 것</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>할 것</p></div></li></ul>',
    sanitized: '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><span></span></label><div><p>한 것</p></div></li><li data-checked="false" data-type="taskItem"><label><span></span></label><div><p>할 것</p></div></li></ul>',
    note: "label 안의 <input type=checkbox>를 뗀다(input은 허용 태그가 아님). 체크 상태는 li의 data-checked로 남는다.",
  },
  "코드블록": {
    json: doc({ type: "codeBlock", attrs: { language: "javascript" }, content: [text("const bpm = 128;")] }),
    tiptap: '<pre class="not-prose"><code class="language-javascript">const bpm = 128;</code></pre>',
    sanitized: "<pre><code>const bpm = 128;</code></pre>",
    note: "pre·code의 class를 뗀다. code의 language-* class가 사라져 저장본에는 코드 언어가 남지 않는다.",
  },
  "표": {
    json: doc({ type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", content: [paragraph(text("곡"))] }, { type: "tableHeader", content: [paragraph(text("BPM"))] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [paragraph(text("Track A"))] }, { type: "tableCell", content: [paragraph(text("128"))] }] },
    ] }),
    tiptap: '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>곡</p></th><th colspan="1" rowspan="1"><p>BPM</p></th></tr><tr><td colspan="1" rowspan="1"><p>Track A</p></td><td colspan="1" rowspan="1"><p>128</p></td></tr></tbody></table>',
    sanitized: '<table><colgroup><col><col></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>곡</p></th><th colspan="1" rowspan="1"><p>BPM</p></th></tr><tr><td colspan="1" rowspan="1"><p>Track A</p></td><td colspan="1" rowspan="1"><p>128</p></td></tr></tbody></table>',
    note: "table·col의 style(min-width)을 뗀다. colspan·rowspan·colgroup은 남는다.",
  },
  "이미지": {
    json: doc({ type: "image", attrs: { src: "https://cdn.example.com/cover.png", alt: "앨범 표지" } }),
    tiptap: '<img class="rounded-lg max-w-full my-2" src="https://cdn.example.com/cover.png" alt="앨범 표지">',
    sanitized: '<img src="https://cdn.example.com/cover.png" alt="앨범 표지">',
    note: "img의 class를 뗀다(src·alt는 남김).",
  },
  "YouTube": {
    json: doc({ type: "youtube", attrs: { src: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" } }),
    tiptap: '<div data-youtube-video=""><iframe class="rounded-lg my-2" width="640" height="480" allowfullscreen="true" autoplay="false" disablekbcontrols="false" enableiframeapi="false" endtime="0" ivloadpolicy="0" loop="false" modestbranding="false" origin="" playlist="" rel="1" src="https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?rel=1" start="0"></iframe></div>',
    sanitized: '<div data-youtube-video=""><iframe src="https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?rel=1" title="YouTube 동영상" loading="lazy" allowfullscreen=""></iframe></div>',
    note: "iframe을 src만 남기고 title·loading·allowfullscreen으로 다시 만든다(class·width·height·autoplay 등 Tiptap 속성 제거). nocookie src는 그대로 통과한다.",
  },
};

let restoreGlobals: () => void = () => undefined;
let extensions: Extensions;

before(() => {
  // @tiptap/core의 generateHTML은 전역 document로 직렬화한다.
  const browserWindow = new Window({ url: "https://portal.test/editor" });
  const bindings: Record<string, unknown> = {
    window: browserWindow,
    document: browserWindow.document,
    Node: browserWindow.Node,
    DOMParser: browserWindow.DOMParser,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(bindings)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  restoreGlobals = () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    browserWindow.close();
  };
  extensions = createEditorExtensions();
});

after(() => restoreGlobals());

for (const [name, json] of Object.entries(roundTripCases)) {
  test(`sanitize round-trip: ${name}은 Tiptap 출력을 그대로 돌려준다`, () => {
    const html = generateHTML(json, extensions);
    assert.equal(sanitizeHtml(html), html);
  });
}

for (const [name, { json, tiptap, sanitized, note }] of Object.entries(knownDifferenceCases)) {
  test(`sanitize round-trip 알려진 차이: ${name} — ${note}`, () => {
    const html = generateHTML(json, extensions);
    assert.equal(html, tiptap, "Tiptap 출력이 바뀌면 알려진 차이도 다시 확인한다");
    const result = sanitizeHtml(html);
    assert.notEqual(result, html, "같아졌다면 이 case를 round-trip 목록으로 옮긴다");
    assert.equal(result, sanitized);
    assert.equal(sanitizeHtml(result), result, "sanitize는 멱등이어야 한다");
  });
}
