import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const css = readFileSync(join(process.cwd(), "src/components/student-portal/unified-calendar.css"), "utf8");
const skeleton = readFileSync(join(process.cwd(), "src/components/ui/skeleton.css"), "utf8");

test("주 보기 블록: 좁으면 시간을 숨겨 학생 이름 칩에 자리를 주고, 칩은 말줄임한다", () => {
  assert.match(css, /\.calendar-chip-block \{\s*container-type: inline-size;/);
  assert.match(css, /@container \(max-width: \d+px\) \{\s*\.fc-notion \.calendar-chip-block \.calendar-chip-time \{\s*display: none;/);
  assert.match(css, /\.calendar-chip-block \[data-student-chip\] \{[^}]*flex-shrink: 1;[^}]*text-overflow: ellipsis;/);
});

test("다크 스켈레톤 빛 띠는 어두운 막대 위에서 보이는 진하기다", () => {
  const darkShines = [...skeleton.matchAll(/--color-skeleton: #232327;\s*--color-skeleton-shine: rgb\(255 255 255 \/ ([\d.]+)\)/g)].map((match) => Number(match[1]));
  assert.equal(darkShines.length, 2);
  for (const alpha of darkShines) assert.ok(alpha >= 0.12, `빛 띠 ${alpha}`);
});
