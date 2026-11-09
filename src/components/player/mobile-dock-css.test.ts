import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("좁은 화면 아래 입력줄은 미니 플레이어 위로 올라가고 홈 표시줄 여백은 미니 플레이어가 맡는다", () => {
  const css = read("src/components/player/player.css");
  assert.match(css, /html\[data-mini-player="on"\] body \{\s*padding-bottom: calc\(59px \+ env\(safe-area-inset-bottom\)\);/u);
  assert.match(
    css,
    /@media \(max-width: 47\.999rem\) \{\s*html\[data-mini-player="on"\] \.sticky-dock \{\s*bottom: calc\(59px \+ env\(safe-area-inset-bottom\)\);\s*padding-bottom: var\(--dock-pad, 0\.5rem\);/u,
  );
  // 입력줄 세 곳이 같은 표시와 같은 안전 영역 식을 쓴다.
  for (const [path, pad] of [
    ["src/components/qna/ThreadDetailClient.tsx", "0.5rem"],
    ["src/app/community/[postId]/PostDetailClient.tsx", "0.5rem"],
    ["src/components/editor/FullEditor.tsx", "0.25rem"],
  ] as const) {
    const source = read(path);
    assert.match(source, /sticky-dock sticky bottom-0/u, path);
    assert.ok(source.includes(`pb-[max(${pad},env(safe-area-inset-bottom))]`), path);
  }
  // 편집 서식 줄(fieldset)은 min-content 폭으로 넘치지 않게 줄어든다.
  assert.match(read("src/components/editor/FullEditor.tsx"), /sticky-dock sticky bottom-0 z-10 [^"]*\bmin-w-0\b/u);
});

test("iPhone 안전 영역: viewport-fit=cover와 위쪽 막대 높이에 상단 안전 영역을 더한다", () => {
  assert.match(read("src/app/layout.tsx"), /viewportFit: "cover"/u);
  assert.match(read("src/app/globals.css"), /--app-topbar-height: calc\(3\.25rem \+ env\(safe-area-inset-top\)\);/u);
});
