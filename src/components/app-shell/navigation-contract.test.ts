import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

/**
 * 화면 이동이 문서를 통째로 다시 받는(전체 페이지 로딩) 코드를 막는다. 2026-11-10 사용자 지적이 같은 원인으로 세 번 반복됐다:
 * 일반 GET form, 포탈 안으로 가는 일반 <a href>, window.location 이동. 앱 안 이동은 SoftGetForm·Link·router(useProgressRouter·pushInApp)를 쓴다.
 */
const root = process.cwd();
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === "test" ? [] : walk(path);
  return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
});
const sources = walk(join(root, "src")).map((file) => ({ file: relative(root, file), text: readFileSync(file, "utf8") }));

test("GET form은 SoftGetForm만 쓴다(일반 <form method=\"get\">은 문서 이동)", () => {
  const offenders = sources.filter(({ file, text }) => file !== "src/components/ui/soft-get-form.tsx" && /<form\b[^>]*method=["']get["']/iu.test(text));
  assert.deepEqual(offenders.map(({ file }) => file), []);
});

test("포탈 안으로 가는 링크는 Link를 쓴다(일반 <a>는 문서 이동)", () => {
  // 일반 <a>를 쓰는 이유가 분명한 곳만 둔다. 새로 생기면 Link로 바꾸거나 여기에 이유를 적는다.
  const allowed = new Map([
    ["src/app/(app)/community/CommunityClient.tsx", "BoardLink: 클릭은 화면 안에서 처리(preventDefault), href는 새 탭·주소 복사용"],
    ["src/components/admin/OneTimeSecret.tsx", "한 번만 보이는 가입 링크 원문(포탈 밖 사람에게 전달)"],
    ["src/components/admin/calendar-sync/CalendarSyncSettings.tsx", "Google 연결 시작 /api 경로(OAuth 문서 이동)"],
    ["src/components/admin/calendar-sync/ConnectionCard.tsx", "Google 연결 시작 /api 경로(OAuth 문서 이동)"],
  ]);
  const offenders: string[] = [];
  for (const { file, text } of sources) {
    if (!file.endsWith(".tsx") || allowed.has(file)) continue;
    for (const match of text.matchAll(/<a\b[^>]*>/gu)) {
      const tag = match[0];
      // 새 창·내려받기·같은 화면 위치·메일·API는 문서로 연다.
      if (/target=|download|href=["']#|href=\{?[`"']mailto:|href=\{?["'`]\/api\//u.test(tag)) continue;
      offenders.push(`${file}: ${tag.replace(/\s+/gu, " ").slice(0, 90)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("window.location 이동은 세션이 바뀌는 인증 흐름과 앱 라우터가 없을 때의 대체에서만 쓴다", () => {
  const allowed = new Set([
    "src/components/auth/AccountDeletionControl.tsx",
    "src/components/auth/InviteSignup.tsx",
    "src/components/auth/PasswordChangeControl.tsx",
    "src/components/auth/RequiredPasswordChange.tsx",
    "src/components/app-shell/NavigationProgress.tsx",
  ]);
  const offenders = sources
    .filter(({ file, text }) => !allowed.has(file) && /window\.location\.(?:assign|replace)\(|window\.location(?:\.href)?\s*=(?!=)/u.test(text))
    .map(({ file }) => file);
  assert.deepEqual(offenders, []);
});
