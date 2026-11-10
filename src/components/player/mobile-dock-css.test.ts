import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("좁은 화면 아래 입력줄은 미니 플레이어 위로 올라가고 홈 표시줄 여백은 미니 플레이어가 맡는다", () => {
  const css = read("src/components/player/player.css");
  assert.match(css, /html\[data-mini-player="on"\] body \{\s*padding-bottom: calc\(var\(--mini-player-height, 58px\) \+ env\(safe-area-inset-bottom\)\);/u);
  assert.match(
    css,
    /@media \(max-width: 47\.999rem\) \{\s*html\[data-mini-player="on"\] \.sticky-dock \{\s*bottom: calc\(var\(--mini-player-height, 58px\) \+ env\(safe-area-inset-bottom\)\);\s*padding-bottom: var\(--dock-pad, 0\.5rem\);/u,
  );
  // 댓글·답변 입력줄은 같은 표시와 같은 안전 영역 식을 쓴다.
  for (const path of ["src/components/qna/ThreadDetailClient.tsx", "src/app/community/[postId]/PostDetailClient.tsx"]) {
    const source = read(path);
    assert.match(source, /sticky-dock sticky bottom-0/u, path);
    assert.ok(source.includes("pb-[max(0.5rem,env(safe-area-inset-bottom))]"), path);
  }
  // 편집 서식 줄(fieldset): 화면 고정 + 키보드 높이만큼 위로, min-content 폭으로 넘치지 않게 줄어든다(B 묶음 ⑦).
  const editor = read("src/components/editor/FullEditor.tsx");
  assert.match(editor, /sticky-dock editor-dock fixed inset-x-0 bottom-\[var\(--keyboard-inset,0px\)\][^"]*\bmin-w-0\b/u);
  assert.match(css, /html\[data-mini-player="on"\] \.editor-dock \{\s*bottom: max\(var\(--keyboard-inset, 0px\), calc\(var\(--mini-player-height, 58px\) \+ env\(safe-area-inset-bottom\)\)\);/u);
});

test("iPhone 안전 영역: viewport-fit=cover와 위쪽 막대 높이에 상단 안전 영역을 더한다", () => {
  assert.match(read("src/app/layout.tsx"), /viewportFit: "cover"/u);
  assert.match(read("src/app/globals.css"), /--app-topbar-height: calc\(3\.25rem \+ env\(safe-area-inset-top\)\);/u);
});

test("미니 플레이어 높이는 재어 둔 --mini-player-height를 쓰고, 58px를 직접 쓰지 않는다", () => {
  const css = read("src/components/player/player.css");
  const rules = css.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/var\(--mini-player-height, 58px\)/gu, "");
  assert.doesNotMatch(rules, /\b58px\b/u);
  assert.match(css, /\.undo-toast-dock \{\s*bottom: calc\(var\(--mini-player-height, 58px\) \+ 12px \+ env\(safe-area-inset-bottom\)\);/u);
  const host = read("src/components/player/PersistentPlayerHost.tsx");
  assert.match(host, /new ResizeObserver\(measure\)/u);
  assert.match(host, /removeProperty\(MINI_PLAYER_HEIGHT_PROPERTY\)/u);
});
