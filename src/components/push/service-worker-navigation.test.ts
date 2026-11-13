import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { safeNotificationPath } from "./ServiceWorkerNavigation";

test("알림 이동: 같은 출처 경로만 앱 안 이동으로 받고, Service Worker는 먼저 열린 화면에 부탁한다", () => {
  assert.equal(safeNotificationPath("/dashboard/qna/t1"), "/dashboard/qna/t1");
  assert.equal(safeNotificationPath("//evil.example/x"), null);
  assert.equal(safeNotificationPath("https://evil.example"), null);
  assert.equal(safeNotificationPath(42), null);
  for (const value of ["/\\evil.example", "/.//evil.example", "/a/..//evil.example"]) {
    assert.equal(safeNotificationPath(value), null, value);
  }
  const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  assert.match(sw, /askClientToNavigate\(client, path\)/u);
  assert.match(sw, /type: "portal:navigate"/u);
  assert.match(readFileSync(join(process.cwd(), "src", "app", "layout.tsx"), "utf8"), /<ServiceWorkerNavigation \/>/u);
});

test("Service Worker의 알림 주소 검사: 다른 출처로 풀리는 값은 대시보드로 연다", () => {
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  const context = { self: { location: { origin: "https://portal.example" }, addEventListener() {} }, URL, result: null as unknown };
  runInNewContext(`${source}\nresult = safePath;`, context);
  const safePath = context.result as (value: unknown) => string;
  assert.equal(safePath("/dashboard/qna/t1?reply=2#r"), "/dashboard/qna/t1?reply=2#r");
  for (const value of ["//evil.example/x", "/\\evil.example", "/.//evil.example", "/a/..//evil.example", "https://evil.example", 42, undefined]) {
    assert.equal(safePath(value), "/dashboard", String(value));
  }
});
