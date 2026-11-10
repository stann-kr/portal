import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { safeNotificationPath } from "./ServiceWorkerNavigation";

test("알림 이동: 같은 출처 경로만 앱 안 이동으로 받고, Service Worker는 먼저 열린 화면에 부탁한다", () => {
  assert.equal(safeNotificationPath("/dashboard/qna/t1"), "/dashboard/qna/t1");
  assert.equal(safeNotificationPath("//evil.example/x"), null);
  assert.equal(safeNotificationPath("https://evil.example"), null);
  assert.equal(safeNotificationPath(42), null);
  const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  assert.match(sw, /askClientToNavigate\(client, path\)/u);
  assert.match(sw, /type: "portal:navigate"/u);
  assert.match(readFileSync(join(process.cwd(), "src", "app", "layout.tsx"), "utf8"), /<ServiceWorkerNavigation \/>/u);
});
