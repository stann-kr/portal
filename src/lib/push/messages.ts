import { formatKstMonthDayTime } from "@/lib/kst-format";

/** 기기 알림 한 건. url은 알림을 눌렀을 때 열 포털 안 경로다. tag가 같으면 기기에서 앞 알림을 바꾼다. */
export type PushMessage = {
  title: string;
  body: string;
  url: string;
  tag?: string;
};

const TITLE_LIMIT = 40;

/** 알림 한 줄에 들어갈 제목. 너무 길면 줄이고, 비었으면 대신할 말을 쓴다. */
function quoted(value: string | null | undefined, fallback: string): string {
  const text = (value ?? "").replace(/\s+/gu, " ").trim();
  if (!text) return fallback;
  return `‘${text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT - 1)}…` : text}’`;
}

function person(name: string | null | undefined, fallback: string): string {
  const text = (name ?? "").trim();
  return text || fallback;
}

const assignmentHref = (assignmentId: string) => `/dashboard/student/assignments/${encodeURIComponent(assignmentId)}`;
const qnaHref = (threadId: string) => `/dashboard/qna/${encodeURIComponent(threadId)}`;

export const pushMessages = {
  feedbackAdded(input: { assignmentId: string; title: string | null }): PushMessage {
    return {
      title: "새 피드백",
      body: `${quoted(input.title, "제출한 과제")}에 피드백이 달렸습니다.`,
      url: assignmentHref(input.assignmentId),
      tag: `feedback:${input.assignmentId}`,
    };
  },
  /** 피드백 없이 Stann이 확인함으로 표시했을 때. 같은 제출의 피드백 알림과 tag를 같이 써서 뒤에 오는 피드백 알림이 이 알림을 바꾼다. */
  assignmentAcknowledged(input: { assignmentId: string; title: string | null }): PushMessage {
    return {
      title: "Stann이 과제를 확인했습니다",
      body: quoted(input.title, "제출한 과제"),
      url: assignmentHref(input.assignmentId),
      tag: `feedback:${input.assignmentId}`,
    };
  },
  assignmentAssigned(input: { taskId: string; title: string; dueAt: Date | null }): PushMessage {
    const due = input.dueAt ? ` 마감 ${formatKstMonthDayTime(input.dueAt)}` : "";
    return {
      title: "새 과제",
      body: `${quoted(input.title, "새 과제")} 과제가 나왔습니다.${due}`,
      url: "/dashboard/student/assignments",
      tag: `task:${input.taskId}`,
    };
  },
  assignmentSubmitted(input: { assignmentId: string; studentName: string | null; title: string | null }): PushMessage {
    return {
      title: "과제 제출",
      body: `${person(input.studentName, "학생")}님 과제 제출: ${quoted(input.title, "자유 과제")}`,
      url: assignmentHref(input.assignmentId),
      tag: `submission:${input.assignmentId}`,
    };
  },
  questionCreated(input: { threadId: string; studentName: string | null; title: string }): PushMessage {
    return {
      title: "새 질문",
      body: `${person(input.studentName, "학생")}님: ${quoted(input.title, "새 질문")}`,
      url: qnaHref(input.threadId),
      tag: `qna:${input.threadId}`,
    };
  },
  replyAdded(input: { threadId: string; authorName: string | null; title: string; toStudent: boolean }): PushMessage {
    return {
      title: input.toStudent ? "Q&A 답변" : "Q&A 답글",
      body: input.toStudent
        ? `${quoted(input.title, "내 질문")}에 답이 달렸습니다.`
        : `${person(input.authorName, "학생")}님 답글: ${quoted(input.title, "질문")}`,
      url: qnaHref(input.threadId),
      tag: `qna:${input.threadId}`,
    };
  },
  lessonScheduled(input: { lessonId: string; scheduledAt: Date; changed: boolean; studentName?: string | null; toAdmin?: boolean }): PushMessage {
    const when = formatKstMonthDayTime(input.scheduledAt);
    const body = input.toAdmin
      ? `${person(input.studentName, "학생")}님이 레슨을 옮겼습니다: ${when}`
      : input.changed
        ? `레슨 시간 변경: ${when}`
        : `새 레슨: ${when}`;
    return {
      title: input.changed ? "레슨 일정 변경" : "새 레슨 일정",
      body,
      url: "/dashboard/calendar",
      tag: `lesson:${input.lessonId}`,
    };
  },
  announcementPosted(input: { postId: string; title: string }): PushMessage {
    return {
      title: "새 공지",
      body: quoted(input.title, "새 공지가 올라왔습니다."),
      url: `/community/${encodeURIComponent(input.postId)}`,
      tag: `announcement:${input.postId}`,
    };
  },
  test(): PushMessage {
    return { title: "알림 테스트", body: "이 기기에서 포털 알림을 받을 수 있습니다.", url: "/dashboard", tag: "test" };
  },
};
