import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyDraftCopyText,
  legacyDraftHtmlToPlainText,
  parseLegacyServerDraftPayload,
  readLegacyDraftContent,
} from "./legacy-draft-content";

test("서버 초안 payload에서 제목과 본문 HTML을 읽는다", () => {
  const payload = JSON.stringify({ version: 1, data: { title: "제목", contentHtml: "<p>본문</p>" } });
  assert.deepEqual(parseLegacyServerDraftPayload(payload), { title: "제목", contentHtml: "<p>본문</p>" });
});

test("깨진 JSON·객체가 아닌 payload는 던지지 않고 빈 내용이다", () => {
  const empty = { title: "", contentHtml: "" };
  assert.deepEqual(parseLegacyServerDraftPayload("{not json"), empty);
  assert.deepEqual(parseLegacyServerDraftPayload("[1]"), empty);
  assert.deepEqual(parseLegacyServerDraftPayload(JSON.stringify({ data: "x" })), empty);
  assert.deepEqual(readLegacyDraftContent(null), empty);
  assert.deepEqual(readLegacyDraftContent({ title: 3, contentHtml: {} }), empty);
});

test("본문 필드는 contentHtml, content, body, text 순으로 비어 있지 않은 첫 값을 쓴다", () => {
  assert.equal(readLegacyDraftContent({ contentHtml: "  ", content: "<p>c</p>", body: "b" }).contentHtml, "<p>c</p>");
  assert.equal(readLegacyDraftContent({ body: "b", text: "t" }).contentHtml, "b");
});

test("HTML을 줄바꿈이 남는 평문으로 바꾸고 script와 엔티티를 처리한다", () => {
  assert.equal(
    legacyDraftHtmlToPlainText("<p>첫째 &amp; 둘째</p><p>셋째<br>넷째</p><script>alert(1)</script>"),
    "첫째 & 둘째\n셋째\n넷째",
  );
});

test("복사 평문은 제목과 본문 사이에 빈 줄을 두고 빈 쪽은 생략한다", () => {
  assert.equal(legacyDraftCopyText({ title: "제목", contentHtml: "<p>본문</p>" }), "제목\n\n본문");
  assert.equal(legacyDraftCopyText({ title: "", contentHtml: "<p>본문</p>" }), "본문");
  assert.equal(legacyDraftCopyText({ title: "제목", contentHtml: "" }), "제목");
});
