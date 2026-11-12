import assert from "node:assert/strict";
import test from "node:test";
import { buildInviteEmail, INVITE_EMAIL_FROM, INVITE_EMAIL_REPLY_TO, sendInviteEmail } from "./invite-email";

test("가입 링크 메일은 이름을 escape하고 링크·만료 시각을 글자와 HTML에 모두 담는다", () => {
  const mail = buildInviteEmail({
    displayName: "<민지>",
    inviteUrl: "https://portal.stann.kr/invite#s-1.secret",
    expiresAt: new Date("2026-11-19T03:00:00.000Z"),
  });
  assert.match(mail.subject, /가입 링크/u);
  assert.match(mail.text, /^<민지>님, 안녕하세요/u);
  assert.match(mail.text, /https:\/\/portal\.stann\.kr\/invite#s-1\.secret/u);
  assert.match(mail.text, /11월 19일/u);
  assert.match(mail.html, /&lt;민지&gt;님/u);
  assert.doesNotMatch(mail.html, /<민지>/u);
  assert.match(mail.html, /href="https:\/\/portal\.stann\.kr\/invite#s-1\.secret"/u);
});

test("binding이 있으면 AUTH_URL 주소로 보내고, 실패·binding 없음은 화면 링크로 넘긴다", async (context) => {
  const previous = process.env.AUTH_URL;
  process.env.AUTH_URL = "https://portal.stann.kr";
  context.after(() => { process.env.AUTH_URL = previous; });
  const sent: Record<string, unknown>[] = [];
  const input = { to: "minji@example.com", displayName: "민지", invitePath: "/invite#s-1.secret", expiresAt: new Date("2026-11-19T03:00:00.000Z") };

  assert.equal(await sendInviteEmail(input, { send: async (message) => { sent.push(message as Record<string, unknown>); } }), "sent");
  assert.equal(sent[0].to, "minji@example.com");
  assert.deepEqual(sent[0].from, { ...INVITE_EMAIL_FROM });
  assert.equal(sent[0].replyTo, INVITE_EMAIL_REPLY_TO);
  assert.match(String(sent[0].text), /https:\/\/portal\.stann\.kr\/invite#s-1\.secret/u);

  const originalError = console.error;
  console.error = () => {};
  context.after(() => { console.error = originalError; });
  assert.equal(await sendInviteEmail(input, { send: async () => { throw new Error("E_SENDER_NOT_VERIFIED"); } }), "failed");
  assert.equal(await sendInviteEmail(input, null), "skipped");
});
