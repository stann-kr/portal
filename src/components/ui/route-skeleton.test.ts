import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteSkeleton } from "./route-skeletons";
import { resolveRouteSkeletonKind, type RouteSkeletonKind } from "./route-skeleton-kind";

const root = process.cwd();
const appRoot = join(root, "src", "app");

function collectPages(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "api" ? [] : collectPages(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

function nearestLoading(pageFile: string): string | null {
  for (let directory = dirname(pageFile); directory.startsWith(appRoot); directory = dirname(directory)) {
    const candidate = join(directory, "loading.tsx");
    if (existsSync(candidate)) return candidate;
    if (directory === appRoot) break;
  }
  return null;
}

/** app 경로를 주소로 바꾼다. (group)은 주소에서 빠지고 [param]은 예시 값으로 채운다. */
function routePathOf(pageFile: string) {
  const segments = relative(appRoot, dirname(pageFile)).split(/[\\/]/u).filter(Boolean)
    .filter((segment) => !/^\(.+\)$/u.test(segment))
    .map((segment) => (/^\[.+\]$/u.test(segment) ? "sample-id" : segment));
  return `/${segments.join("/")}`;
}

/** 다른 화면으로 보내기만 하는 page는 이동한 화면의 스켈레톤이 보이므로 자기 모양이 없다. */
function isRedirectOnly(pageFile: string) {
  const source = readFileSync(pageFile, "utf8");
  return !/return\s*\(?\s*</u.test(source);
}

test("모든 화면에는 가장 가까운 loading.tsx가 있다(루트 redirect page 제외)", () => {
  const missing = collectPages(appRoot)
    .filter((page) => dirname(page) !== appRoot)
    .filter((page) => nearestLoading(page) === null)
    .map((page) => relative(root, page));
  assert.deepEqual(missing, []);
});

test("내용을 그리는 화면의 loading.tsx 스켈레톤 모양은 첫 진입 셸 스켈레톤의 주소 대응과 같다", () => {
  for (const page of collectPages(appRoot)) {
    if (dirname(page) === appRoot || isRedirectOnly(page)) continue;
    const loading = nearestLoading(page);
    assert.ok(loading, relative(root, page));
    const source = readFileSync(loading, "utf8");
    const declared = /kind="([a-z-]+)"/u.exec(source)?.[1] ?? (source.includes("RouteLoadingState") ? "generic" : null);
    // 셸 밖 화면((auth)·privacy)도 같은 대응을 쓴다.
    assert.equal(resolveRouteSkeletonKind(routePathOf(page)), declared as RouteSkeletonKind, relative(root, page));
  }
});

test("스켈레톤은 status·busy로 한 번 알리고 막대는 화면 읽기에서 숨긴다", () => {
  const kinds: RouteSkeletonKind[] = [
    "generic", "work-queue", "today", "student-detail", "record-list", "record-list-narrow", "history", "thread-list",
    "document", "editor", "form", "form-narrow", "form-wide", "board", "assignment", "guide-index", "guide-page", "auth", "privacy",
  ];
  for (const kind of kinds) {
    const markup = renderToStaticMarkup(React.createElement(RouteSkeleton, { kind }));
    assert.equal(markup.match(/role="status"/gu)?.length, 1, kind);
    assert.match(markup, /aria-busy="true"/u, kind);
    assert.match(markup, /aria-label="[^"]+"/u, kind);
    assert.match(markup, /class="skeleton-region/u, kind);
    for (const bar of markup.matchAll(/<span[^>]*class="skeleton-bar[^"]*"[^>]*>/gu)) {
      assert.match(bar[0], /aria-hidden="true"/u, `${kind}: ${bar[0]}`);
    }
  }
});

test("스켈레톤 움직임: 왼쪽→오른쪽 1.4초 빛 띠, 앱 안 이동만 지연 후 나타남(첫 진입은 바로), 움직임 줄이기에서는 정지", () => {
  const css = readFileSync(join(root, "src/components/ui/skeleton.css"), "utf8");
  assert.match(css, /animation:\s*skeleton-sweep 1\.4s ease-in-out infinite/u);
  assert.match(css, /@keyframes skeleton-sweep\s*\{\s*from \{ background-position: -100% 0; \}\s*to \{ background-position: 200% 0; \}/u);
  assert.match(css, /html\[data-client-nav\] \.skeleton-region \{\s*animation:\s*skeleton-appear [^;]* 160ms both/u);
  // 첫 진입(표시 없음)에는 기다림 규칙이 걸리지 않는다.
  assert.doesNotMatch(css, /(^|\n)\.skeleton-region \{/u);
  assert.match(readFileSync(join(root, "src/components/app-shell/NavigationProgress.tsx"), "utf8"), /dataset\.clientNav = ""/u);
  const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}\s*$/u.exec(css)?.[1] ?? "";
  assert.match(reduced, /html\[data-client-nav\] \.skeleton-region,\s*\.skeleton-bar\s*\{\s*animation: none;/u);
  // 다크 값은 시스템 설정과 data-theme 두 곳 모두에 둔다.
  assert.match(css, /:root:not\(\[data-theme="light"\]\)\s*\{\s*--color-skeleton: #232327;/u);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{\s*--color-skeleton: #232327;/u);
  assert.match(readFileSync(join(root, "src/app/globals.css"), "utf8"), /@import "\.\.\/components\/ui\/skeleton\.css";/u);
});

test("첫 진입 셸 fallback은 화면(children)을 다른 자리에 그리지 않는다", () => {
  const source = readFileSync(join(root, "src/components/app-shell/AppShell.tsx"), "utf8");
  assert.match(source, /<Suspense fallback=\{<AppShellSkeleton \/>\}>/u);
  assert.equal(source.match(/\{children\}/gu)?.length, 2, "AppShell→AuthenticatedShell→AppSidebar 한 경로로만 전달");
});

test("주소 대응 대표 사례", () => {
  assert.equal(resolveRouteSkeletonKind("/dashboard/admin"), "work-queue");
  assert.equal(resolveRouteSkeletonKind("/dashboard/admin/students/abc/digging"), "student-detail");
  assert.equal(resolveRouteSkeletonKind("/dashboard/student/assignments"), "today");
  assert.equal(resolveRouteSkeletonKind("/dashboard/qna/"), "thread-list");
  assert.equal(resolveRouteSkeletonKind("/dashboard/calendar"), "generic");
});
