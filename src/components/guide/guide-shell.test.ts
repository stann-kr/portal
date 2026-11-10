import assert from "node:assert/strict";
import test from "node:test";
import { currentGuidePageId, isGuideEditPath } from "./GuideShell";

const pages = [{ id: "p1", title: "첫 페이지" }, { id: "p2", title: "둘째" }];

test("가이드 틀: 첫 화면은 첫 페이지, 페이지 주소는 그 id, 편집 화면은 목차 없이", () => {
  assert.equal(currentGuidePageId("/dashboard/guide", pages), "p1");
  assert.equal(currentGuidePageId("/dashboard/guide/", pages), "p1");
  assert.equal(currentGuidePageId("/dashboard/guide/p2", pages), "p2");
  assert.equal(currentGuidePageId("/dashboard/guide", []), null);
  assert.equal(isGuideEditPath("/dashboard/guide/p2/edit"), true);
  assert.equal(isGuideEditPath("/dashboard/guide/p2"), false);
});
