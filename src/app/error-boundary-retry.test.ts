import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function errorBoundaryFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return errorBoundaryFiles(path);
    return entry.name === "error.tsx" || entry.name === "global-error.tsx" ? [path] : [];
  });
}

/**
 * Next의 `reset`은 오류 상태만 지우고 같은 server 결과로 다시 그린다. server 렌더가 실패한 화면에서는 같은 오류가 반복된다.
 * "다시 시도"는 segment를 다시 받아 오는 `retry`에 연결한다(node_modules/next/dist/docs의 error 파일 규약).
 */
test("오류 화면의 다시 시도는 화면을 다시 받아 오는 retry에 연결한다", () => {
  const files = errorBoundaryFiles(join(process.cwd(), "src/app"));
  assert.ok(files.length >= 4, "root·global·dashboard·community 오류 화면이 있어야 한다");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /\{ retry \}: \{ retry: \(\) => void \}/u, file);
    assert.match(source, /onRetry=\{retry\}/u, file);
    assert.doesNotMatch(source, /\breset\b/u, file);
  }
});
