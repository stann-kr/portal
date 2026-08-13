import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteErrorState } from "./route-error-state";
import { RouteLoadingState } from "./route-loading-state";

test("route loading state는 status, busy 상태와 reduced-motion fallback을 제공한다", () => {
  const markup = renderToStaticMarkup(React.createElement(RouteLoadingState, {
    label: "커뮤니티 불러오는 중",
    compact: true,
  }));
  assert.match(markup, /role="status"/u);
  assert.match(markup, /aria-busy="true"/u);
  assert.match(markup, /커뮤니티 불러오는 중/u);
  assert.match(markup, /motion-reduce:animate-none/u);
});

test("route error state는 alert와 이름 있는 retry button을 제공한다", () => {
  const markup = renderToStaticMarkup(React.createElement(RouteErrorState, {
    title: "불러오지 못했습니다",
    description: "잠시 후 다시 시도해 주세요.",
    onRetry: () => undefined,
  }));
  assert.match(markup, /role="alert"/u);
  assert.match(markup, /<button[^>]*>다시 시도<\/button>/u);
});
