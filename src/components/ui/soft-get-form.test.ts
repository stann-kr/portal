import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { softGetFormHref } from "./soft-get-form";

test("앱 안 GET form 주소: form 값과 누른 버튼 값으로 query를 만들고 action의 query는 버리고 hash는 남긴다", () => {
  const browser = new Window({ url: "https://portal.test/dashboard/qna?qnaStatus=OPEN" });
  const document = browser.document;
  const originalFormData = globalThis.FormData;
  globalThis.FormData = browser.FormData as unknown as typeof FormData;
  try {
  document.body.innerHTML = `
    <form action="/dashboard/qna?old=1#list" method="get">
      <input type="hidden" name="studentId" value="s1" />
      <button type="submit" name="qnaStatus" value="ANSWERED">답변됨</button>
      <input name="qnaQuery" value="키 연결" />
    </form>`;
  const form = document.querySelector("form") as unknown as HTMLFormElement;
  const button = document.querySelector("button") as unknown as HTMLElement;
  assert.equal(
    softGetFormHref(form, button, browser.location.href),
    "/dashboard/qna?studentId=s1&qnaStatus=ANSWERED&qnaQuery=%ED%82%A4+%EC%97%B0%EA%B2%B0#list",
  );
  assert.equal(
    softGetFormHref(form, null, browser.location.href),
    "/dashboard/qna?studentId=s1&qnaQuery=%ED%82%A4+%EC%97%B0%EA%B2%B0#list",
    "Enter로 제출하면 버튼 값 없이",
  );
  } finally {
    globalThis.FormData = originalFormData;
  }
});
