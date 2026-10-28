import assert from "node:assert/strict";
import test from "node:test";
import { isProgressNavigationClick } from "./navigation-progress";

const location = { origin: "https://portal.test", pathname: "/dashboard/student", search: "?section=today" };

function anchor(href: string, attrs: Record<string, string> = {}) {
  const element = {
    target: attrs.target ?? "",
    getAttribute: (name: string) => (name === "href" ? href : attrs[name] ?? null),
    hasAttribute: (name: string) => name in attrs,
  };
  return { closest: () => element };
}

function click(href: string, overrides: Partial<{ button: number; metaKey: boolean; attrs: Record<string, string> }> = {}) {
  return {
    button: overrides.button ?? 0,
    metaKey: overrides.metaKey ?? false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: anchor(href, overrides.attrs) as unknown as EventTarget,
  };
}

test("다른 앱 주소로 가는 왼쪽 클릭만 위쪽 진행 막대를 켠다", () => {
  assert.equal(isProgressNavigationClick(click("/community"), location), true);
  assert.equal(isProgressNavigationClick(click("/dashboard/student?section=workspace"), location), true, "query만 달라도 이동이다");
  assert.equal(isProgressNavigationClick(click("/dashboard/student?section=today"), location), false, "같은 주소");
  assert.equal(isProgressNavigationClick(click("#notes"), location), false, "같은 주소의 # 이동");
  assert.equal(isProgressNavigationClick(click("https://example.com/"), location), false, "외부 주소");
  assert.equal(isProgressNavigationClick(click("/community", { metaKey: true }), location), false, "새 탭");
  assert.equal(isProgressNavigationClick(click("/community", { button: 1 }), location), false, "가운데 버튼");
  assert.equal(isProgressNavigationClick(click("/community", { attrs: { target: "_blank" } }), location), false);
  assert.equal(isProgressNavigationClick(click("/files/a.pdf", { attrs: { download: "" } }), location), false);
  assert.equal(isProgressNavigationClick(click("/community?boardType=GENERAL", { attrs: { "data-progress-skip": "" } }), location), false, "화면 안에서 처리하는 링크");
  assert.equal(
    isProgressNavigationClick({ ...click("/community"), target: { closest: () => null } as unknown as EventTarget }, location),
    false,
    "링크가 아닌 곳",
  );
});
