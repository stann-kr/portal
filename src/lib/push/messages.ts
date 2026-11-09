import { formatKstMonthDayTime } from "@/lib/kst-format";
import { toKstDateInputValue } from "@/lib/date-input";
import { calendarItemHref } from "@/lib/portal-location";
import { assignmentTaskHref } from "@/lib/student-space-routes";

/**
 * 알림 종류. 계정마다 종류별로 끌 수 있다(test는 끌 수 없다).
 * assignment는 학생에게 "새 과제", 관리자에게 "과제 제출"이다.
 */
export const PUSH_CATEGORIES = [
  "feedback",
  "assignment",
  "lesson",
  "qna",
  "announcement",
  "community_post",
  "community_comment",
] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/** 기기 알림 한 건. url은 알림을 눌렀을 때 열 포털 안 경로다. tag가 같으면 기기에서 앞 알림을 바꾼다. */
export type PushMessage = {
  category: PushCategory | "test";
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
      category: "feedback",
      title: "새 피드백",
      body: `${quoted(input.title, "제출한 과제")}에 피드백이 달렸습니다.`,
      url: assignmentHref(input.assignmentId),
      tag: `feedback:${input.assignmentId}`,
    };
  },
  /** 피드백 없이 Stann이 확인함으로 표시했을 때. 같은 제출의 피드백 알림과 tag를 같이 써서 뒤에 오는 피드백 알림이 이 알림을 바꾼다. */
  assignmentAcknowledged(input: { assignmentId: string; title: string | null }): PushMessage {
    return {
      category: "feedback",
      title: "Stann이 과제를 확인했습니다",
      body: quoted(input.title, "제출한 과제"),
      url: assignmentHref(input.assignmentId),
      tag: `feedback:${input.assignmentId}`,
    };
  },
  /** analysis가 true면(믹스셋 분석 과제) 분석 쓰기 화면, 아니면 그 과제가 펼쳐진 과제 목록을 연다. */
  assignmentAssigned(input: { taskId: string; title: string; dueAt: Date | null; analysis?: boolean }): PushMessage {
    const due = input.dueAt ? ` 마감 ${formatKstMonthDayTime(input.dueAt)}` : "";
    return {
      category: "assignment",
      title: "새 과제",
      body: `${quoted(input.title, "새 과제")} 과제가 나왔습니다.${due}`,
      url: assignmentTaskHref(input.taskId, { analysis: input.analysis }),
      tag: `task:${input.taskId}`,
    };
  },
  assignmentSubmitted(input: { assignmentId: string; studentName: string | null; title: string | null }): PushMessage {
    return {
      category: "assignment",
      title: "과제 제출",
      body: `${person(input.studentName, "학생")}님 과제 제출: ${quoted(input.title, "자유 과제")}`,
      url: assignmentHref(input.assignmentId),
      tag: `submission:${input.assignmentId}`,
    };
  },
  questionCreated(input: { threadId: string; studentName: string | null; title: string }): PushMessage {
    return {
      category: "qna",
      title: "새 질문",
      body: `${person(input.studentName, "학생")}님: ${quoted(input.title, "새 질문")}`,
      url: qnaHref(input.threadId),
      tag: `qna:${input.threadId}`,
    };
  },
  replyAdded(input: { threadId: string; authorName: string | null; title: string; toStudent: boolean }): PushMessage {
    return {
      category: "qna",
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
      category: "lesson",
      title: input.changed ? "레슨 일정 변경" : "새 레슨 일정",
      body,
      // 학생은 그 날짜로 이동해 레슨 상세를 연다(레슨이 지워졌으면 날짜만). 관리자 캘린더는 아직 날짜 딥링크가 없다.
      url: input.toAdmin
        ? "/dashboard/calendar"
        : calendarItemHref(toKstDateInputValue(input.scheduledAt), `PORTAL:LESSON:${input.lessonId}`),
      tag: `lesson:${input.lessonId}`,
    };
  },
  announcementPosted(input: { postId: string; title: string }): PushMessage {
    return {
      category: "announcement",
      title: "새 공지",
      body: quoted(input.title, "새 공지가 올라왔습니다."),
      url: `/community/${encodeURIComponent(input.postId)}`,
      tag: `announcement:${input.postId}`,
    };
  },
  communityPostCreated(input: { postId: string; authorName: string | null; title: string }): PushMessage {
    return {
      category: "community_post",
      title: "커뮤니티 새 글",
      body: `${person(input.authorName, "누군가")}님: ${quoted(input.title, "새 글")}`,
      url: `/community/${encodeURIComponent(input.postId)}`,
      tag: `post:${input.postId}`,
    };
  },
  commentAdded(input: { postId: string; authorName: string | null; title: string; toPostAuthor: boolean }): PushMessage {
    return {
      category: "community_comment",
      title: input.toPostAuthor ? "내 글에 새 댓글" : "새 댓글",
      body: `${person(input.authorName, "누군가")}님 댓글: ${quoted(input.title, input.toPostAuthor ? "내 글" : "참여한 글")}`,
      url: `/community/${encodeURIComponent(input.postId)}`,
      tag: `comment:${input.postId}`,
    };
  },
  test(): PushMessage {
    return { category: "test", title: "알림 테스트", body: "이 기기에서 포털 알림을 받을 수 있습니다.", url: "/dashboard", tag: "test" };
  },
};
