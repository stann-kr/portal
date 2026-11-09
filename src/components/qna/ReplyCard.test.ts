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

test("Q&A 이미지 첨부는 160×120 미리보기 버튼, 그 밖의 첨부는 새 창 칩으로 보인다", () => {
  const withAttachment = (attachmentKind: "image" | "audio" | null) => ({
    ...reply("김학생", "student"),
    attachmentUrl: "/api/media/m1/setup.jpg",
    attachmentKind,
  });
  const image = renderToStaticMarkup(createElement(ReplyCard, { reply: withAttachment("image") }));
  assert.match(image, /<button[^>]*aria-label="첨부 이미지 크게 보기: setup\.jpg"/u);
  assert.match(image, /<img[^>]*src="\/api\/media\/m1\/setup\.jpg"[^>]*class="[^"]*h-\[120px\] w-\[160px\]/u);
  assert.doesNotMatch(image, /target="_blank"/u);

  for (const kind of ["audio", null] as const) {
    const chip = renderToStaticMarkup(createElement(ReplyCard, { reply: withAttachment(kind) }));
    assert.match(chip, /<a[^>]*href="\/api\/media\/m1\/setup\.jpg"[^>]*target="_blank"/u);
    assert.doesNotMatch(chip, /첨부 이미지 크게 보기/u);
  }
});
