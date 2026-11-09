import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const appDir = join(process.cwd(), "src", "app");
const css = readFileSync(join(appDir, "globals.css"), "utf8");
const layout = readFileSync(join(appDir, "layout.tsx"), "utf8");

/** `selector {` 다음부터 짝이 맞는 `}`까지의 본문. */
function blockBody(source: string, selector: string, from = 0): string {
  const start = source.indexOf(`${selector} {`, from);
  assert.ok(start >= 0, `${selector} 블록이 있어야 한다`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(source.indexOf("{", start) + 1, index);
    }
  }
  assert.fail(`${selector} 블록이 닫혀야 한다`);
}

function declarations(body: string): string[] {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .map((line) => line.trim())
    .filter(Boolean);
}

test("어두운 token은 시스템(data-theme 없음·light 아님)과 수동 다크에 같은 값으로 적용된다", () => {
  const media = blockBody(css, "@media (prefers-color-scheme: dark)");
  const systemDark = declarations(blockBody(media, ':root:not([data-theme="light"])'));
  const manualDark = declarations(blockBody(css, ':root[data-theme="dark"]'));
  assert.ok(systemDark.includes("color-scheme: dark"));
  assert.ok(systemDark.some((line) => line.startsWith("--color-background:")));
  assert.deepEqual(manualDark, systemDark);
  // 라이트를 고르면 기기 설정이 어두워도 기본(:root) 밝은 값과 color-scheme: light가 남아야 한다.
  assert.doesNotMatch(css, /@media \(prefers-color-scheme: dark\) \{\s*:root \{/);
  assert.match(blockBody(css, ":root"), /color-scheme: light/);
});

test("prefers-color-scheme는 globals.css의 어두운 token 블록 한 곳에서만 CSS로 쓴다", () => {
  assert.equal(css.match(/prefers-color-scheme/g)?.length, 1);
});

test("입력 영역 글꼴은 별칭(swap)을 쓰고 본문은 block 하나만 선언한다(입력 중 글자 깜빡임 회귀)", () => {
  // next/font로 같은 글꼴을 두 번 선언하면 family 이름이 같아 본문까지 swap이 된다. 본문 선언은 하나만 둔다.
  assert.equal(layout.match(/IBM_Plex_Sans_KR\(\{/g)?.length, 1);
  assert.match(layout, /IBM_Plex_Sans_KR\(\{[^}]*display: "block"/);
  assert.match(layout, /<InputFontAlias \/>/);

  const inputVariable = css.match(/--font-sans-input:\s*([^;]+);/);
  assert.ok(inputVariable, "--font-sans-input이 정의돼야 한다");
  assert.match(inputVariable[1], /^"Portal Input Sans"/);
  // 대체 목록에 block 글꼴이 끼면 그 글꼴을 받는 동안 다시 투명해진다.
  assert.doesNotMatch(inputVariable[1], /--font-plex-sans\)|--font-sans\b|"IBM Plex Sans KR"/);

  const ruleAt = css.search(/\{\s*font-family:\s*var\(--font-sans-input\);/);
  assert.ok(ruleAt >= 0, "입력 선택자에 --font-sans-input이 붙어야 한다");
  const head = css.slice(0, ruleAt);
  const selectorText = head.slice(Math.max(head.lastIndexOf("}"), head.lastIndexOf("*/") + 1, head.lastIndexOf("{")) + 1);
  const selectors = selectorText.split(",").map((selector) => selector.trim());
  for (const selector of ["input", "textarea", "select", "[contenteditable]", ".ProseMirror"]) {
    assert.ok(selectors.includes(selector), selector);
  }
});

test("루트 layout은 화면 모드 cookie로 data-theme과 theme-color를 첫 HTML에 그린다", () => {
  assert.match(layout, /export const dynamic = "force-dynamic"/);
  assert.match(layout, /data-theme=\{theme \?\? undefined\}/);
  assert.match(layout, /export async function generateViewport/);
  assert.doesNotMatch(layout, /export const viewport/);
});
