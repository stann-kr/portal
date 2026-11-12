/**
 * @file src/lib/invite-email.ts
 * @description 학생 가입 링크 메일. Cloudflare Email Service의 `send_email` binding(`EMAIL`)으로
 * `no-reply@portal.stann.kr`에서 보낸다. binding이 없는 환경(로컬 Node·테스트)은 보내지 않고 "skipped"를,
 * 발송이 실패하면 "failed"를 돌려준다. 어느 경우든 관리자 화면은 링크를 그대로 보여 주므로 직접 전달할 수 있다.
 * 로그에는 받는 주소·링크를 남기지 않는다.
 */
import { formatKst } from "@/lib/kst-format";
import { readRuntimeEnv } from "@/lib/runtime-env";

export const INVITE_EMAIL_FROM = { email: "no-reply@portal.stann.kr", name: "Stann Lumo" } as const;
/** 학생이 답장하면 Stann이 받는 주소(개인정보처리방침의 문의 주소와 같다). */
export const INVITE_EMAIL_REPLY_TO = "stannlumo@gmail.com";

export type InviteEmailStatus = "sent" | "failed" | "skipped";

type EmailMessage = {
  to: string;
  from: { email: string; name: string };
  replyTo: string;
  subject: string;
  text: string;
  html: string;
};

type SendEmailBinding = { send(message: EmailMessage): Promise<unknown> };

const EXPIRES_FORMAT: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character
  ));
}

/** 메일 본문. 링크는 한 번만 쓸 수 있고 만료 시각을 함께 알린다. */
export function buildInviteEmail({
  displayName,
  inviteUrl,
  expiresAt,
}: {
  displayName: string;
  inviteUrl: string;
  expiresAt: Date;
}): Pick<EmailMessage, "subject" | "text" | "html"> {
  const expires = formatKst(expiresAt, EXPIRES_FORMAT);
  const subject = "[Portal - Stann] 레슨 포털 가입 링크";
  const lines = [
    `${displayName}님, 안녕하세요. Stann입니다.`,
    "",
    "레슨 포털 계정을 만들었습니다. 아래 링크에서 비밀번호를 정하면 바로 로그인할 수 있습니다.",
    "",
    inviteUrl,
    "",
    `링크는 ${expires}까지 한 번만 쓸 수 있습니다. 만료됐다면 Stann에게 새 링크를 요청해 주세요.`,
    "이 메일에 답장하시면 Stann에게 전달됩니다.",
  ];
  const name = escapeHtml(displayName);
  const url = escapeHtml(inviteUrl);
  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Apple SD Gothic Neo\',sans-serif;font-size:15px;line-height:1.7;color:#18181b;max-width:520px">',
    `<p>${name}님, 안녕하세요. Stann입니다.</p>`,
    "<p>레슨 포털 계정을 만들었습니다. 아래 버튼에서 비밀번호를 정하면 바로 로그인할 수 있습니다.</p>",
    `<p><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#18181b;color:#ffffff;text-decoration:none;font-weight:600">비밀번호 정하고 가입하기</a></p>`,
    `<p style="font-size:13px;color:#6b6b73">버튼이 열리지 않으면 이 주소를 브라우저에 붙여 넣어 주세요.<br><span style="word-break:break-all">${url}</span></p>`,
    `<p style="font-size:13px;color:#6b6b73">링크는 ${escapeHtml(expires)}까지 한 번만 쓸 수 있습니다. 만료됐다면 Stann에게 새 링크를 요청해 주세요. 이 메일에 답장하시면 Stann에게 전달됩니다.</p>`,
    "</div>",
  ].join("");
  return { subject, text: lines.join("\n"), html };
}

function readEmailBinding(): SendEmailBinding | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as {
      getCloudflareContext: () => { env?: Record<string, unknown> };
    };
    const binding = getCloudflareContext()?.env?.EMAIL as Partial<SendEmailBinding> | undefined;
    return binding && typeof binding.send === "function" ? (binding as SendEmailBinding) : null;
  } catch {
    return null;
  }
}

/** 학생에게 가입 링크를 보낸다. `invitePath`는 `/invite#...` 경로이고 주소는 `AUTH_URL`로 만든다. */
export async function sendInviteEmail(
  { to, displayName, invitePath, expiresAt }: { to: string; displayName: string; invitePath: string; expiresAt: Date },
  binding: SendEmailBinding | null = readEmailBinding(),
): Promise<InviteEmailStatus> {
  const origin = readRuntimeEnv("AUTH_URL");
  if (!binding || !origin) return "skipped";
  try {
    const inviteUrl = new URL(invitePath, origin).toString();
    await binding.send({
      to,
      from: { ...INVITE_EMAIL_FROM },
      replyTo: INVITE_EMAIL_REPLY_TO,
      ...buildInviteEmail({ displayName, inviteUrl, expiresAt }),
    });
    return "sent";
  } catch (error) {
    console.error("invite email failed", error instanceof Error ? error.name : "unknown");
    return "failed";
  }
}
