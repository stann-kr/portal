import assert from "node:assert/strict";
import test from "node:test";
import { richTextLinkAction } from "./ZoomableRichText";

const link = (href: string | null) => ({ getAttribute: () => href });
const origin = "https://portal.stann.kr";
const here = { pathname: "/dashboard/guide/g1", search: "" };

test("본문 링크: 포탈 안은 앱 안 이동, 다른 사이트는 새 탭, 같은 화면 위치·메일·파일은 브라우저에", () => {
  assert.deepEqual(richTextLinkAction(link("/dashboard/qna/t1"), origin, here), { kind: "internal", href: "/dashboard/qna/t1" });
  assert.deepEqual(richTextLinkAction(link("https://portal.stann.kr/community/p1?x=1#c"), origin, here), { kind: "internal", href: "/community/p1?x=1#c" });
  assert.deepEqual(richTextLinkAction(link("https://youtube.com/watch?v=1"), origin, here), { kind: "external", href: "https://youtube.com/watch?v=1" });
  assert.equal(richTextLinkAction(link("#section"), origin, here), null);
  assert.equal(richTextLinkAction(link("/dashboard/guide/g1#block"), origin, here), null);
  assert.equal(richTextLinkAction(link("mailto:a@b.c"), origin, here), null);
  assert.equal(richTextLinkAction(link("/api/media/m1"), origin, here), null);
  assert.equal(richTextLinkAction(link("javascript:alert(1)"), origin, here), null);
  assert.equal(richTextLinkAction(link(null), origin, here), null);
});
