import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultTreeAdapter,
  html,
  parseFragment,
  type DefaultTreeAdapterTypes,
} from "parse5";
import { sanitizeHtml } from "./sanitize-html";

const OUTPUT_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "col",
  "colgroup",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "iframe",
  "img",
  "label",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const BLOCK_ID_OUTPUT_TAGS = new Set([
  "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "img", "li", "p", "pre", "table",
]);
const OUTPUT_ATTRIBUTES = new Map<string, ReadonlySet<string>>(
  ([
    ["a", ["href", "title"]],
    ["col", ["title", "width"]],
    ["div", ["data-youtube-video", "title"]],
    ["h1", ["data-text-align", "title"]],
    ["h2", ["data-text-align", "title"]],
    ["h3", ["data-text-align", "title"]],
    ["h4", ["data-text-align", "title"]],
    ["h5", ["data-text-align", "title"]],
    ["h6", ["data-text-align", "title"]],
    ["iframe", ["allowfullscreen", "loading", "src", "title"]],
    ["img", ["alt", "height", "src", "title", "width"]],
    ["li", ["data-checked", "data-type", "title"]],
    ["ol", ["start", "title"]],
    ["p", ["data-text-align", "title"]],
    ["td", ["colspan", "colwidth", "rowspan", "title"]],
    ["th", ["colspan", "colwidth", "rowspan", "title"]],
    ["ul", ["data-type", "title"]],
    ["blockquote", ["title"]],
    ["hr", ["title"]],
    ["pre", ["title"]],
    ["table", ["title"]],
  ] as const).map(([tag, names]) => [
    tag,
    new Set<string>([...names, ...(BLOCK_ID_OUTPUT_TAGS.has(tag) ? ["data-block-id"] : [])]),
  ]),
);

function assertOutputPolicy(htmlValue: string): void {
  const context = defaultTreeAdapter.createElement("div", html.NS.HTML, []);
  const fragment = parseFragment(context, htmlValue, {});

  function visit(node: DefaultTreeAdapterTypes.ChildNode): void {
    if (defaultTreeAdapter.isTextNode(node)) return;
    assert.ok(defaultTreeAdapter.isElementNode(node), `unexpected node: ${node.nodeName}`);
    assert.equal(defaultTreeAdapter.getNamespaceURI(node), html.NS.HTML);

    const tagName = defaultTreeAdapter.getTagName(node);
    assert.ok(OUTPUT_TAGS.has(tagName), `unexpected tag: ${tagName}`);
    const tagAttributes = OUTPUT_ATTRIBUTES.get(tagName);
    for (const attribute of node.attrs) {
      assert.equal(attribute.namespace, undefined);
      assert.equal(attribute.prefix, undefined);
      assert.ok(
        attribute.name === "title" || tagAttributes?.has(attribute.name),
        `unexpected attribute: ${tagName}[${attribute.name}]`,
      );
      assert.doesNotMatch(attribute.name, /^on/iu);
    }

    for (const child of defaultTreeAdapter.getChildNodes(node)) visit(child);
  }

  for (const child of defaultTreeAdapter.getChildNodes(fragment)) visit(child);
}

test("script element와 inline event handler를 제거한다", () => {
  const sanitized = sanitizeHtml(
    '<p>안전한 본문</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
  );

  assert.match(sanitized, /<p>안전한 본문<\/p>/);
  assert.doesNotMatch(sanitized, /<script/i);
  assert.doesNotMatch(sanitized, /onerror/i);
});

test("javascript protocol 링크를 제거한다", () => {
  const sanitized = sanitizeHtml(
    '<a href="javascript:alert(1)">위험</a><a href="https://example.com">안전</a>',
  );

  assert.doesNotMatch(sanitized, /javascript:/i);
  assert.match(sanitized, /href="https:\/\/example\.com"/);
});

test("에디터가 사용하는 안전한 서식은 유지한다", () => {
  const sanitized = sanitizeHtml(
    '<h2>제목</h2><p data-text-align="center" style="text-align: center"><strong>강조</strong></p>' +
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">' +
      '<label><input type="checkbox" checked><span></span></label><div>완료</div></li></ul>',
  );

  assert.match(sanitized, /<h2>제목<\/h2>/);
  assert.match(sanitized, /<p data-text-align="center"><strong>강조<\/strong><\/p>/);
  assert.match(sanitized, /data-type="taskList"/);
  assert.match(sanitized, /data-checked="true"/);
  assert.doesNotMatch(sanitized, /<input\b/i);
});

test("본문이 포털 UI를 덮거나 입력을 위장할 수 있는 속성과 control을 제거한다", () => {
  const sanitized = sanitizeHtml(
    '<div title=">" class="fixed inset-0 z-50" style="position:fixed;inset:0">덮개</div>' +
      '<form><input type="password" name="password"><button type="submit">로그인</button></form>' +
      '<textarea name="secret">입력값</textarea><select><option>선택값</option></select>' +
      '<p title="a>b" style="position:fixed;inset:0" id="fake">본문</p>',
  );

  assert.doesNotMatch(sanitized, /\b(?:class|id|style)\s*=/i);
  assert.doesNotMatch(sanitized, /<(?:form|button|input|option|select|textarea)\b/i);
  assert.match(sanitized, /덮개/);
  assert.match(sanitized, /로그인/);
  assert.match(sanitized, /입력값선택값/);
});

test("YouTube nocookie embed만 보존한다", () => {
  const sanitized = sanitizeHtml(
    '<div data-youtube-video><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0" onload="alert(1)"></iframe></div>' +
      '<iframe src="https://example.com/embed/tracker"></iframe>',
  );

  assert.match(sanitized, /https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?rel=0/);
  assert.match(sanitized, /title="YouTube 동영상"/);
  assert.doesNotMatch(sanitized, /example\.com/);
  assert.doesNotMatch(sanitized, /onload/);
});

test("YouTube embed의 사용자 정보·비표준 port와 알 수 없는 query를 제거한다", () => {
  const sanitized = sanitizeHtml(
    '<iframe src="https://user:pass@www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>' +
      '<iframe src="https://www.youtube-nocookie.com:444/embed/dQw4w9WgXcQ"></iframe>' +
      '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=10&origin=https://evil.example"></iframe>',
  );

  assert.equal((sanitized.match(/<iframe/g) ?? []).length, 1);
  assert.match(sanitized, /\?start=10/);
  assert.doesNotMatch(sanitized, /(?:user:pass|:444|origin=|evil\.example)/);
});

test("표·이미지·코드 등 에디터의 저장 형식을 보존한다", () => {
  const sanitized = sanitizeHtml(
    '<table><colgroup><col width="240"></colgroup><tbody><tr>' +
      '<th colspan="2" rowspan="1" colwidth="120,120"><p>헤더</p></th>' +
      "</tr></tbody></table>" +
      '<img src="https://cdn.example.com/image.png?x=1&amp;y=2" alt="설명" title="제목" width="640" height="480">' +
      '<pre><code><span>const safe = true;</span></code></pre>' +
      '<img src="data:image/png;base64,AAAA" alt="기존 이미지">',
  );

  assert.match(sanitized, /<col width="240">/u);
  assert.match(sanitized, /colspan="2"/u);
  assert.match(sanitized, /rowspan="1"/u);
  assert.match(sanitized, /colwidth="120,120"/u);
  assert.match(sanitized, /src="https:\/\/cdn\.example\.com\/image\.png\?x=1&amp;y=2"/u);
  assert.match(sanitized, /alt="설명"/u);
  assert.match(sanitized, /<pre><code><span>const safe = true;<\/span><\/code><\/pre>/u);
  assert.match(sanitized, /src="data:image\/png;base64,AAAA"/u);
});

test("HTML entity와 공백으로 위장한 실행 URL을 제거한다", () => {
  const sanitized = sanitizeHtml(
    '<a href="java&#x73;cript:alert(1)">entity</a>' +
      '<a href="jav&#x09;ascript:alert(1)">tab</a>' +
      '<a href="java\nscript:alert(1)">newline</a>' +
      '<a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">data</a>' +
      '<a href="/safe/path?x=1&amp;y=2">relative</a>' +
      '<a href="mailto:student@example.com">mail</a>' +
      '<a href="HTTPS://example.com/path">https</a>',
  );

  assert.doesNotMatch(sanitized, /(?:javascript|data:text\/html)/iu);
  assert.equal((sanitized.match(/href=/gu) ?? []).length, 3);
  assert.match(sanitized, /href="\/safe\/path\?x=1&amp;y=2"/u);
  assert.match(sanitized, /href="mailto:student@example\.com"/u);
  assert.match(sanitized, /href="HTTPS:\/\/example\.com\/path"/u);
});

test("이미지 src는 웹 URL과 image data URL만 허용한다", () => {
  const sanitized = sanitizeHtml(
    '<img src="javascript:alert(1)" alt="javascript">' +
      '<img src="data:text/html,&lt;svg onload=alert(1)&gt;" alt="html-data">' +
      '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+" alt="svg-data">' +
      '<img src="blob:https://example.com/id" alt="blob">' +
      '<img src="ftp://example.com/image.png" alt="ftp">' +
      '<img src="/media/image.png" alt="relative">' +
      '<img src="https://cdn.example.com/image.webp" alt="https">' +
      '<img src="data:image/webp;base64,AAAA" alt="data-image">',
  );

  assert.doesNotMatch(sanitized, /(?:javascript:|data:text\/html|data:image\/svg|blob:|ftp:)/iu);
  assert.match(sanitized, /src="\/media\/image\.png"/u);
  assert.match(sanitized, /src="https:\/\/cdn\.example\.com\/image\.webp"/u);
  assert.match(sanitized, /src="data:image\/webp;base64,AAAA"/u);
  assert.equal((sanitized.match(/<img\b/gu) ?? []).length, 8);
});

test("foreign content와 파서 문맥을 바꾸는 element의 subtree를 제거한다", () => {
  const sanitized = sanitizeHtml(
    '<svg><foreignObject><p onclick="alert(1)">SVG HTML</p></foreignObject></svg>' +
      '<math><mtext><img src="x" onerror="alert(1)"></mtext></math>' +
      '<template><img src="x" onerror="alert(1)"></template>' +
      '<style>body{display:none}</style>' +
      '<noscript><img src="x" onerror="alert(1)"></noscript>' +
      '<object data="https://evil.example">fallback</object>' +
      "<!-- <img src=x onerror=alert(1)> -->" +
      "<p>정상 본문</p>",
  );

  assert.equal(sanitized, "<p>정상 본문</p>");
  assertOutputPolicy(sanitized);
});

test("malformed markup도 HTML5 parse 후 allowlist 밖 실행 표면을 남기지 않는다", () => {
  const sanitized = sanitizeHtml(
    '<table><svg><script>alert(1)</script></svg><tr><td title="safe" onclick="alert(1)">셀</td></tr></table>' +
      '<p><math><mtext></p><img src="javascript:alert(1)" onerror="alert(1)">' +
      '<a href="javascript:alert(1)" style="position:fixed">링크</a>',
  );

  assert.doesNotMatch(sanitized, /(?:<svg|<math|<script|onclick|onerror|javascript:|style=)/iu);
  assert.match(sanitized, /셀/u);
  assertOutputPolicy(sanitized);
});

test("iframe은 실제 src 속성의 canonical YouTube nocookie URL만 사용한다", () => {
  const sanitized = sanitizeHtml(
    '<iframe title=\'src="https://www.youtube-nocookie.com/embed/spoof"\'></iframe>' +
      '<iframe src="https://www.youtube-nocookie.com./embed/trailing-dot"></iframe>' +
      '<iframe src="https://www.youtube-nocookie.com/embed/ok?rel=1&amp;start=30&amp;origin=https://evil.example#fragment" srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;" onload="alert(1)"></iframe>',
  );

  assert.equal((sanitized.match(/<iframe\b/gu) ?? []).length, 1);
  assert.match(
    sanitized,
    /src="https:\/\/www\.youtube-nocookie\.com\/embed\/ok\?rel=1&amp;start=30"/u,
  );
  assert.match(sanitized, /title="YouTube 동영상"/u);
  assert.match(sanitized, /loading="lazy"/u);
  assert.match(sanitized, /allowfullscreen=""/u);
  assert.doesNotMatch(sanitized, /(?:spoof|trailing-dot|origin=|fragment|srcdoc|onload)/u);
});

test("YouTube nocookie 재생목록은 검증된 단일 list ID와 안전한 query만 보존한다", () => {
  const sanitized = sanitizeHtml(
    '<iframe src="https://www.youtube-nocookie.com/embed/videoseries?list=PL_safe-123&amp;rel=1&amp;origin=https://evil.example"></iframe>' +
      '<iframe src="https://www.youtube-nocookie.com/embed/videoseries?rel=1"></iframe>' +
      '<iframe src="https://www.youtube-nocookie.com/embed/videoseries?list=PL_one&amp;list=PL_two"></iframe>' +
      '<iframe src="https://www.youtube-nocookie.com/embed/videoseries?list=PL%20unsafe"></iframe>',
  );

  assert.equal((sanitized.match(/<iframe\b/gu) ?? []).length, 1);
  assert.match(
    sanitized,
    /src="https:\/\/www\.youtube-nocookie\.com\/embed\/videoseries\?list=PL_safe-123&amp;rel=1"/u,
  );
  assert.doesNotMatch(sanitized, /(?:origin=|PL_one|PL_two|PL%20unsafe)/u);
});

test("허용 속성을 태그와 값 단위로 제한한다", () => {
  const sanitized = sanitizeHtml(
    '<p data-text-align="center" data-type="taskList" data-youtube-video="" colspan="2">본문</p>' +
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">완료</li></ul>' +
      '<ul data-type="other"><li data-type="other" data-checked="yes">무효</li></ul>' +
      '<table><tbody><tr><td colspan="1001" rowspan="99999" colwidth="100,evil">셀</td></tr></tbody></table>',
  );

  assert.match(sanitized, /<p data-text-align="center">본문<\/p>/u);
  assert.match(
    sanitized,
    /<ul data-type="taskList"><li data-type="taskItem" data-checked="true">완료<\/li><\/ul>/u,
  );
  assert.match(sanitized, /<ul><li>무효<\/li><\/ul>/u);
  assert.doesNotMatch(sanitized, /(?:colspan="1001"|rowspan="99999"|colwidth="100,evil")/u);
  assertOutputPolicy(sanitized);
});

test("sanitizer 결과는 공격·정상 입력 모두에서 멱등이다", () => {
  const corpus = [
    "",
    "일반 텍스트 & < >",
    '<p title="a&gt;b &amp; c">본문 <strong>강조</strong></p>',
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">작업</li></ul>',
    '<table><tr><td colspan="2" colwidth="120,120">셀</td></tr></table>',
    '<table><caption>허용하지 않는 표 제목</caption><tr><td>셀</td></tr></table>',
    '<iframe src="https://www.youtube-nocookie.com/embed/video_id?rel=0&amp;start=15"></iframe>',
    '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
    '<a href="jav&#x09;ascript:alert(1)"><img src="data:text/html,x"></a>',
    '<form><button>로그인</button><input type="password"></form>',
    "<p><button><p>X</p></button></p>",
    "<li><form><li>X</li></form></li>",
  ];

  for (const input of corpus) {
    const once = sanitizeHtml(input);
    assert.equal(sanitizeHtml(once), once, input);
    assertOutputPolicy(once);
  }
});

test("wrapper 제거 뒤 실제 div sink의 HTML parse 결과로 고정된다", () => {
  const paragraph = sanitizeHtml("<p><button><p>X</p></button></p>");
  const list = sanitizeHtml("<li><form><li>X</li></form></li>");

  assert.equal(paragraph, "<p></p><p>X</p><p></p>");
  assert.equal(list, "<li></li><li>X</li>");
  assert.equal(sanitizeHtml(paragraph), paragraph);
  assert.equal(sanitizeHtml(list), list);
  assertOutputPolicy(paragraph);
  assertOutputPolicy(list);
});

test("태그 하나의 attribute 폭탄은 parse 전에 선형 제한한다", () => {
  const attributes = Array.from({ length: 10_000 }, (_, index) => ` x${index}=v`).join("");

  assert.equal(sanitizeHtml(`<p${attributes}>본문</p>`), "");
  assert.equal(sanitizeHtml(`<p>본문</p${attributes}>`), "");
  assert.equal(sanitizeHtml(`<!-- --!><p${attributes}>본문</p>`), "");

  const boundaryAttributes = Array.from(
    { length: 64 },
    (_, index) => ` x${index}="quoted > value ${index}"`,
  ).join("");
  assert.equal(sanitizeHtml(`<p${boundaryAttributes}>본문</p>`), "<p>본문</p>");
  assert.match(
    sanitizeHtml('<img src="data:image/png;base64,AAAA" alt="공백과 > 문자를 포함한 설명">'),
    /src="data:image\/png;base64,AAAA" alt="공백과 > 문자를 포함한 설명"/u,
  );
});

test("active formatting Noah's Ark 폭탄은 parse 전에 제한한다", () => {
  const formattingBomb = Array.from({ length: 10_000 }, (_, index) => `<b x=${index}>`).join("");
  const closingTags = "</b>".repeat(10_000);
  const misnestedFormatting = "<b><i></b></i>".repeat(10_000);

  assert.equal(sanitizeHtml(`${formattingBomb}본문${closingTags}`), "");
  assert.equal(sanitizeHtml(misnestedFormatting), "");

  const sequentialFormatting = Array.from(
    { length: 2_000 },
    () => "<strong>강조</strong>",
  ).join("");
  assert.equal((sanitizeHtml(sequentialFormatting).match(/<strong>/gu) ?? []).length, 2_000);
});

test("비정상적으로 깊은 markup을 parse 전에 제한한다", () => {
  const boundary = `${"<div>".repeat(128)}끝${"</div>".repeat(128)}`;
  const tooDeep = `${"<div>".repeat(129)}끝${"</div>".repeat(129)}`;

  assert.equal((sanitizeHtml(boundary).match(/<div>/gu) ?? []).length, 128);
  assert.equal(sanitizeHtml(tooDeep), "");
  assert.equal(sanitizeHtml("<div/>".repeat(129)), "");
  assert.equal(sanitizeHtml("<div>".repeat(10_000)), "");
});

test("브라우저 DOM global이 없는 Node 환경에서 동작한다", () => {
  assert.equal("window" in globalThis, false);
  assert.equal("document" in globalThis, false);
  assert.equal("DOMParser" in globalThis, false);
  assert.equal(sanitizeHtml('<p onclick="alert(1)">서버 본문</p>'), "<p>서버 본문</p>");
});

test("가이드 블록 식별자 data-block-id는 블록 태그와 안전한 값만 허용한다", () => {
  const sanitized = sanitizeHtml(
    '<p data-block-id="b_1-A">문단</p>' +
      '<h2 data-block-id="h2id">제목</h2>' +
      '<ul><li data-block-id="li1"><p data-block-id="lp1">항목</p></li></ul>' +
      '<blockquote data-block-id="q1"><p>인용</p></blockquote>' +
      '<pre data-block-id="pre1"><code>x</code></pre>' +
      '<table data-block-id="t1"><tbody><tr><td data-block-id="cell">셀</td></tr></tbody></table>' +
      '<img src="/api/guide-assets/a" data-block-id="img1">' +
      '<hr data-block-id="hr1">' +
      '<p data-block-id="bad id">공백</p>' +
      '<p data-block-id="">빈 값</p>' +
      `<p data-block-id="${"a".repeat(65)}">너무 김</p>` +
      '<p data-block-id="&quot;onload=x">따옴표</p>' +
      '<span data-block-id="s1">인라인</span>' +
      '<strong data-block-id="s2">강조</strong>',
  );

  for (const id of ["b_1-A", "h2id", "li1", "lp1", "q1", "pre1", "t1", "img1", "hr1"]) {
    assert.match(sanitized, new RegExp(`data-block-id="${id}"`, "u"));
  }
  assert.doesNotMatch(sanitized, /data-block-id="(?:bad id|cell|s1|s2|)"/u);
  assert.doesNotMatch(sanitized, /data-block-id="a{65}"/u);
  assert.doesNotMatch(sanitized, /onload/u);
  assert.equal(sanitizeHtml(sanitized), sanitized);
  assertOutputPolicy(sanitized);
});

test("data-block-id가 없는 노트·게시물 HTML은 그대로다", () => {
  const note = '<p data-text-align="center">본문</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>할 일</p></li></ul>';
  assert.equal(sanitizeHtml(note), note);
});
