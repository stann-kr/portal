import assert from "node:assert/strict";
import test from "node:test";
import { getPortalStatus, STATUS_TONE_CLASS_NAMES } from "./portal-status";

test("Q&A 상태는 사용자용 label, tone, icon을 함께 반환한다", () => {
  assert.deepEqual(getPortalStatus("qnaOpen"), {
    label: "답변 대기",
    tone: "warning",
    icon: "clock",
  });
  assert.deepEqual(getPortalStatus("qnaAnswered"), {
    label: "답변 완료",
    tone: "success",
    icon: "message",
  });
});

test("피드백 대기와 도착은 서로 다른 의미 tone을 사용한다", () => {
  assert.equal(getPortalStatus("feedbackWaiting").tone, "warning");
  assert.equal(getPortalStatus("feedbackReady").tone, "info");
});

test("모든 status tone은 semantic token class를 가진다", () => {
  for (const className of Object.values(STATUS_TONE_CLASS_NAMES)) {
    assert.match(className, /(bg|text|border)-(muted|accent|success|warning|destructive|info|primary)/);
    assert.doesNotMatch(className, /(red|green|blue|orange|violet|pink)-/);
  }
});
