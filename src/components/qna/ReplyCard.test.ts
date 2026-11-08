import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReplyCard } from "./ReplyCard";

const reply = (authorName: string, authorRole: string) => ({
  id: authorName, contentHtml: "<p>본문</p>", attachmentUrl: null, createdAt: new Date("2026-10-26T09:02:00Z"),
  authorName, authorEmail: null, authorRole,
});

test("Q&A 답변은 역할 배지 없이 Stann 이름만 semibold로 구분한다", () => {
  const stann = renderToStaticMarkup(createElement(ReplyCard, { reply: reply("Stann", "admin") }));
  const student = renderToStaticMarkup(createElement(ReplyCard, { reply: reply("김학생", "student") }));
  assert.doesNotMatch(stann + student, /강사|관리자/u);
  assert.match(stann, /<span class="font-semibold">Stann<\/span>/u);
  assert.match(student, /<span class="font-normal">김학생<\/span>/u);
});
