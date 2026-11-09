import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSIGNMENT_TASK_STATUS_LABELS,
  ASSIGNMENT_TEXT_MAX_LENGTH,
  getAssignmentTaskStatus,
  getSubmissionReviewStatus,
  htmlToPlainText,
  isLateSubmission,
  isSubmissionSettled,
  settledSubmissionError,
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
  assert.deepEqual(validateSubmissionPayload("MIX", { mediaUrl: link, text: "무시할 글" }), { ok: true, mediaUrl: link, textHtml: null, analysisJson: null });
  assert.equal(validateSubmissionPayload("MIX", { mediaUrl: "", text: "글" }).ok, false);
  const text = validateSubmissionPayload("TEXT", { mediaUrl: link, text: "연습 기록" });
  assert.deepEqual(text, { ok: true, mediaUrl: null, textHtml: "<p>연습 기록</p>", analysisJson: null });
  assert.equal(validateSubmissionPayload("TEXT", { mediaUrl: link, text: "  " }).ok, false);
  assert.equal(validateSubmissionPayload("BOTH", { mediaUrl: link, text: "" }).ok, false);
  assert.equal(validateSubmissionPayload("BOTH", { mediaUrl: "", text: "글" }).ok, false);
  assert.equal(validateSubmissionPayload("BOTH", { mediaUrl: link, text: "글" }).ok, true);
  assert.equal(normalizePlainTextField("가".repeat(ASSIGNMENT_TEXT_MAX_LENGTH + 1), { maxLength: ASSIGNMENT_TEXT_MAX_LENGTH, label: "글" }).ok, false);
});

test("믹스셋 분석은 링크와 분석 JSON만 받고 글은 저장하지 않는다", () => {
  const link = "https://youtu.be/aqz-KE-bpKQ";
  const analysis = JSON.stringify({ rating: 4, recommended: true, oneLiner: "좋은 셋", entries: [{ at: "3:30", memo: "킥 교체" }] });
  const result = validateSubmissionPayload("ANALYSIS", { mediaUrl: link, text: "무시할 글", analysis });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.mediaUrl, link);
  assert.equal(result.textHtml, null);
  assert.deepEqual(JSON.parse(result.analysisJson ?? "null"), {
    v: 1, rating: 4, recommended: true, oneLiner: "좋은 셋", entries: [{ at: 210, memo: "킥 교체" }],
  });
  assert.equal(validateSubmissionPayload("ANALYSIS", { mediaUrl: "", text: "", analysis }).ok, false);
  assert.equal(validateSubmissionPayload("ANALYSIS", { mediaUrl: link, text: "", analysis: "{}" }).ok, false);
  assert.equal(validateSubmissionPayload("ANALYSIS", { mediaUrl: link, text: "" }).ok, false);
});

test("자유 제출은 링크·글 중 하나 이상을 받고 빈 칸은 null로 저장한다", () => {
  const link = "https://youtu.be/aqz-KE-bpKQ";
  assert.deepEqual(validateFreeSubmissionPayload({ mediaUrl: link, text: "" }), { ok: true, mediaUrl: link, textHtml: null, analysisJson: null });
  assert.deepEqual(validateFreeSubmissionPayload({ mediaUrl: "  ", text: "연습 기록" }), { ok: true, mediaUrl: null, textHtml: "<p>연습 기록</p>", analysisJson: null });
  assert.deepEqual(validateFreeSubmissionPayload({ mediaUrl: link, text: "둘 다" }), { ok: true, mediaUrl: link, textHtml: "<p>둘 다</p>", analysisJson: null });
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
  assert.equal(getAssignmentTaskStatus({ dueAt: past }, { feedbackCount: 0, reviewedAt: null }, now), "submitted");
  assert.equal(getAssignmentTaskStatus({ dueAt: past }, { feedbackCount: 2, reviewedAt: null }, now), "reviewed");
  assert.equal(getAssignmentTaskStatus({ dueAt: past }, { feedbackCount: 0, reviewedAt: now }, now), "acknowledged");
  assert.equal(getAssignmentTaskStatus({ dueAt: past }, { feedbackCount: 1, reviewedAt: now }, now), "reviewed", "피드백이 확인함보다 앞선다");
  assert.equal(isLateSubmission(past, now), true);
  assert.equal(isLateSubmission(future, now), false);
  assert.equal(isLateSubmission(null, now), false);
});

test("검토 상태: 피드백 > 확인함 > 피드백 대기 순서이고, 피드백이나 확인함이 있으면 잠긴(끝난) 제출이다", () => {
  const at = new Date("2026-11-02T12:00:00.000Z");
  assert.equal(getSubmissionReviewStatus({ feedbackCount: 0, reviewedAt: null }), "submitted");
  assert.equal(getSubmissionReviewStatus({ feedbackCount: 0, reviewedAt: at }), "acknowledged");
  assert.equal(getSubmissionReviewStatus({ feedbackCount: 0, reviewedAt: at.toISOString() }), "acknowledged", "통합 목록 metadata의 ISO 문자열");
  assert.equal(getSubmissionReviewStatus({ feedbackCount: 0, reviewedAt: "" }), "submitted");
  assert.equal(getSubmissionReviewStatus({ feedbackCount: 3, reviewedAt: at }), "reviewed");
  assert.equal(isSubmissionSettled({ feedbackCount: 0, reviewedAt: null }), false);
  assert.equal(isSubmissionSettled({ feedbackCount: 0, reviewedAt: at }), true);
  assert.equal(isSubmissionSettled({ feedbackCount: 1, reviewedAt: null }), true);
  assert.equal(ASSIGNMENT_TASK_STATUS_LABELS.acknowledged, "Stann 확인함");
  assert.equal(ASSIGNMENT_TASK_STATUS_LABELS.submitted, "피드백 대기");
  assert.equal(ASSIGNMENT_TASK_STATUS_LABELS.reviewed, "피드백 완료");
  assert.match(settledSubmissionError("고칠", { feedbackCount: 1, reviewedAt: at }), /^피드백이 등록된 제출은 고칠 수 없습니다/u);
  assert.match(settledSubmissionError("삭제할", { feedbackCount: 0, reviewedAt: at }), /^Stann이 확인한 제출은 삭제할 수 없습니다/u);
});
