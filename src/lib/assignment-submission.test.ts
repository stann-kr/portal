import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSIGNMENT_TEXT_MAX_LENGTH,
  getAssignmentTaskStatus,
  htmlToPlainText,
  isLateSubmission,
  normalizePlainTextField,
  plainTextToHtml,
  validateFreeSubmissionPayload,
  validateSubmissionPayload,
} from "./assignment-submission";

test("글은 escape된 문단 HTML로 저장하고 같은 글로 되돌린다", () => {
  const text = "첫 줄 <b>강조</b> & \"인용\"\n둘째 줄\n\n새 문단";
  const html = plainTextToHtml(text);
  assert.doesNotMatch(html, /<b>/u);
  assert.match(html, /^<p>첫 줄 &lt;b&gt;/u);
  assert.match(html, /<br>/u);
  assert.equal(htmlToPlainText(html), text);
  assert.equal(plainTextToHtml("   \n\n "), "");
});

test("제출 형식마다 필요한 칸만 받고 나머지는 저장하지 않는다", () => {
  const link = "https://youtu.be/aqz-KE-bpKQ";
  assert.deepEqual(validateSubmissionPayload("MIX", { mediaUrl: link, text: "무시할 글" }), { ok: true, mediaUrl: link, textHtml: null });
  assert.equal(validateSubmissionPayload("MIX", { mediaUrl: "", text: "글" }).ok, false);
  const text = validateSubmissionPayload("TEXT", { mediaUrl: link, text: "연습 기록" });
  assert.deepEqual(text, { ok: true, mediaUrl: null, textHtml: "<p>연습 기록</p>" });
  assert.equal(validateSubmissionPayload("TEXT", { mediaUrl: link, text: "  " }).ok, false);
  assert.equal(validateSubmissionPayload("BOTH", { mediaUrl: link, text: "" }).ok, false);
  assert.equal(validateSubmissionPayload("BOTH", { mediaUrl: "", text: "글" }).ok, false);
  assert.equal(validateSubmissionPayload("BOTH", { mediaUrl: link, text: "글" }).ok, true);
  assert.equal(normalizePlainTextField("가".repeat(ASSIGNMENT_TEXT_MAX_LENGTH + 1), { maxLength: ASSIGNMENT_TEXT_MAX_LENGTH, label: "글" }).ok, false);
});

test("자유 제출은 링크·글 중 하나 이상을 받고 빈 칸은 null로 저장한다", () => {
  const link = "https://youtu.be/aqz-KE-bpKQ";
  assert.deepEqual(validateFreeSubmissionPayload({ mediaUrl: link, text: "" }), { ok: true, mediaUrl: link, textHtml: null });
  assert.deepEqual(validateFreeSubmissionPayload({ mediaUrl: "  ", text: "연습 기록" }), { ok: true, mediaUrl: null, textHtml: "<p>연습 기록</p>" });
  assert.deepEqual(validateFreeSubmissionPayload({ mediaUrl: link, text: "둘 다" }), { ok: true, mediaUrl: link, textHtml: "<p>둘 다</p>" });
  assert.deepEqual(validateFreeSubmissionPayload({ mediaUrl: "", text: " \n " }), { ok: false, error: "링크나 글 중 하나 이상을 입력해 주세요." });
  assert.deepEqual(validateFreeSubmissionPayload({ mediaUrl: null, text: null }), { ok: false, error: "링크나 글 중 하나 이상을 입력해 주세요." });
  const invalid = validateFreeSubmissionPayload({ mediaUrl: "https://example.test/mix", text: "글은 있음" });
  assert.equal(invalid.ok, false);
  assert.match(invalid.ok ? "" : invalid.error, /YouTube|SoundCloud/u);
  const escaped = validateFreeSubmissionPayload({ mediaUrl: "", text: "<script>alert(1)</script> & <b>굵게</b>" });
  assert.equal(escaped.ok, true);
  const html = escaped.ok ? escaped.textHtml ?? "" : "";
  assert.doesNotMatch(html, /<script|<b>/u);
  assert.match(html, /&lt;script&gt;/u);
  assert.equal(validateFreeSubmissionPayload({ mediaUrl: "", text: "가".repeat(ASSIGNMENT_TEXT_MAX_LENGTH + 1) }).ok, false);
});

test("과제 상태는 제출·피드백·마감으로 정하고 마감 뒤 제출은 늦은 제출이다", () => {
  const now = new Date("2026-11-02T12:00:00.000Z");
  const past = new Date("2026-11-01T12:00:00.000Z");
  const future = new Date("2026-11-03T12:00:00.000Z");
  assert.equal(getAssignmentTaskStatus({ dueAt: future }, null, now), "open");
  assert.equal(getAssignmentTaskStatus({ dueAt: null }, null, now), "open");
  assert.equal(getAssignmentTaskStatus({ dueAt: past }, null, now), "overdue");
  assert.equal(getAssignmentTaskStatus({ dueAt: past }, { feedbackCount: 0 }, now), "submitted");
  assert.equal(getAssignmentTaskStatus({ dueAt: past }, { feedbackCount: 2 }, now), "reviewed");
  assert.equal(isLateSubmission(past, now), true);
  assert.equal(isLateSubmission(future, now), false);
  assert.equal(isLateSubmission(null, now), false);
});
