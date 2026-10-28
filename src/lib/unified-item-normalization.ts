import type { CalendarEventType, QnaStatus } from "@/db/schema";
import { ASSIGNMENT_TASK_SUBTYPE, type UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { getSearchableDocumentText } from "@/lib/document-search";

const NOTE_PREVIEW_MAX_CHARS = 240;

/** 통합 일정의 노트 상세는 HTML을 싣지 않고 안전한 평문 미리보기만 전달한다. */
export function createNotePreview(contentHtml: string): string {
  const text = getSearchableDocumentText(contentHtml);
  const characters = Array.from(text);
  return characters.length > NOTE_PREVIEW_MAX_CHARS
    ? `${characters.slice(0, NOTE_PREVIEW_MAX_CHARS).join("")}…`
    : text;
}

export type ProfileContext = {
  id: string;
  email: string;
  displayName: string | null;
};

type CalendarEventRow = {
  id: string;
  eventType: CalendarEventType;
  title: string;
  startTime: Date;
  endTime: Date | null;
  description: string | null;
};

type LessonRow = {
  id: string;
  scheduledAt: Date;
};

type NoteRow = {
  id: string;
  title: string;
  contentHtml: string;
  authorId: string;
  noteDate: Date | null;
  createdAt: Date;
};

type DiggingTrackRow = {
  id: string;
  linkUrl: string | null;
  values: string | null;
  createdAt: Date | null;
};

type DiggingColumnRow = {
  id: string;
  name: string;
};

export type CreatedCalendarEventInput = CalendarEventRow;

export type CreatedDiggingTrackInput = Omit<DiggingTrackRow, "values"> & {
  values: Record<string, unknown> | string | null;
};

type QnaThreadRow = {
  id: string;
  title: string;
  status: QnaStatus;
  createdAt: Date | null;
};

type AssignmentRow = {
  id: string;
  mediaUrl: string | null;
  submittedAt: Date | null;
  /** 관리자가 낸 과제에 대한 제출이면 그 과제 제목 */
  taskTitle?: string | null;
};

/** 아직 제출하지 않은 관리자 과제(마감일에 놓인다). */
type AssignmentTaskRow = {
  id: string;
  title: string;
  dueAt: Date | null;
  createdAt: Date;
  submissionFormat: string;
};


export type UnifiedItemNormalizationInput = {
  profile: ProfileContext;
  events: CalendarEventRow[];
  lessons: LessonRow[];
  notes: NoteRow[];
  tracks: DiggingTrackRow[];
  columns: DiggingColumnRow[];
  threads: QnaThreadRow[];
  assignments: AssignmentRow[];
  feedbackCounts: Record<string, number>;
  tasks?: AssignmentTaskRow[];
};

/** 목록·캘린더에 원본 URL 대신 제출 플랫폼을 보여 주는 과제 제목. 링크가 없으면 글 제출이다. */
export function describeAssignmentMedia(mediaUrl: string | null): string {
  if (!mediaUrl) return "글 제출";
  let hostname = "";
  try {
    hostname = new URL(mediaUrl).hostname.toLowerCase();
  } catch {
    return "제출한 믹스셋";
  }
  if (hostname === "youtu.be" || hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
    return "YouTube 믹스셋";
  }
  if (hostname === "soundcloud.com" || hostname.endsWith(".soundcloud.com")) {
    return "SoundCloud 믹스셋";
  }
  return "제출한 믹스셋";
}

/** 제출 목록의 제목: 관리자 과제 제출이면 과제 제목, 자유 제출이면 플랫폼 이름(글이면 "글 제출"). */
export function describeAssignmentSubmission({
  mediaUrl,
  taskTitle,
}: {
  mediaUrl: string | null;
  taskTitle?: string | null;
}): string {
  return taskTitle?.trim() || describeAssignmentMedia(mediaUrl);
}

/** 학생 스페이스의 단일 표시명 규칙. */
export function getUnifiedItemSpaceLabel({
  displayName,
  email,
}: Pick<ProfileContext, "displayName" | "email">): string {
  return displayName?.trim() || email;
}

function parseDiggingValues(values: string | null): Record<string, unknown> {
  if (!values) return {};
  try {
    const parsed: unknown = JSON.parse(values);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeColumnName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function findNamedColumnId(
  columns: DiggingColumnRow[],
  names: readonly string[],
): string | undefined {
  const accepted = new Set(names.map(normalizeColumnName));
  return columns.find((column) => accepted.has(normalizeColumnName(column.name)))?.id;
}

function createSource(entity: UnifiedItem["source"]["entity"]): UnifiedItem["source"] {
  return { kind: "PORTAL", entity, label: "포탈" };
}

function createSpace(profile: ProfileContext): UnifiedItem["space"] {
  return { studentId: profile.id, label: getUnifiedItemSpaceLabel(profile) };
}

export function createCalendarEventUnifiedItem(
  event: CreatedCalendarEventInput,
  profile: ProfileContext,
): UnifiedItem {
  return {
    id: event.id,
    type: "EVENT",
    subType: event.eventType,
    title: event.title,
    description: event.description ?? undefined,
    date: new Date(event.startTime),
    endDate: event.endTime ? new Date(event.endTime) : null,
    metadata: { eventType: event.eventType, description: event.description },
    space: createSpace(profile),
    source: createSource("CALENDAR_EVENT"),
  };
}

export function createLessonUnifiedItem(
  lesson: LessonRow,
  profile: ProfileContext,
): UnifiedItem {
  return {
    id: lesson.id,
    type: "EVENT",
    subType: "LESSON",
    title: "레슨",
    date: new Date(lesson.scheduledAt),
    endDate: null,
    metadata: {},
    space: createSpace(profile),
    source: createSource("LESSON"),
  };
}

export function createDiggingTrackUnifiedItem(
  track: CreatedDiggingTrackInput,
  columns: DiggingColumnRow[],
  profile: ProfileContext,
): UnifiedItem {
  const values = typeof track.values === "string"
    ? parseDiggingValues(track.values)
    : track.values ?? {};
  const trackNameColumnId = findNamedColumnId(columns, ["track name", "트랙명"]);
  const artistColumnId = findNamedColumnId(columns, ["artist", "아티스트"]);
  const trackName = trackNameColumnId && typeof values[trackNameColumnId] === "string"
    ? values[trackNameColumnId] as string
    : undefined;
  const artistName = artistColumnId && typeof values[artistColumnId] === "string"
    ? values[artistColumnId] as string
    : undefined;
  const title = trackName && artistName
    ? `${trackName} — ${artistName}`
    : trackName ?? track.linkUrl ?? "디깅 트랙";

  return {
    id: track.id,
    type: "DIGGING",
    title,
    date: new Date(track.createdAt ?? Date.now()),
    metadata: {
      values,
      linkUrl: track.linkUrl,
      columnIds: { trackName: trackNameColumnId, artist: artistColumnId },
    },
    space: createSpace(profile),
    source: createSource("DIGGING_TRACK"),
  };
}

/**
 * 학생 스페이스의 날짜 기반 엔티티를 UI 공통 계약으로 정규화한다.
 * lessons와 calendar_events는 안정적인 연결 키가 없으므로 절대 dedupe하지 않는다.
 */
export function normalizeUnifiedItems({
  profile,
  events,
  lessons,
  notes,
  tracks,
  columns,
  threads,
  assignments,
  feedbackCounts,
  tasks = [],
}: UnifiedItemNormalizationInput): UnifiedItem[] {
  const space = createSpace(profile);
  const source = createSource;
  const items: UnifiedItem[] = [];

  for (const event of events) {
    items.push(createCalendarEventUnifiedItem(event, profile));
  }

  for (const lesson of lessons) {
    items.push(createLessonUnifiedItem(lesson, profile));
  }

  for (const note of notes) {
    items.push({
      id: note.id,
      type: "NOTE",
      title: note.title,
      date: new Date(note.noteDate ?? note.createdAt),
      metadata: {
        preview: createNotePreview(note.contentHtml),
        authorId: note.authorId,
        noteDate: note.noteDate,
      },
      space,
      source: source("PRIVATE_NOTE"),
    });
  }

  for (const track of tracks) {
    items.push(createDiggingTrackUnifiedItem(track, columns, profile));
  }

  for (const thread of threads) {
    items.push({
      id: thread.id,
      type: "QNA",
      subType: thread.status,
      title: thread.title,
      date: new Date(thread.createdAt ?? Date.now()),
      metadata: { status: thread.status },
      space,
      source: source("QNA_THREAD"),
    });
  }

  for (const assignment of assignments) {
    items.push({
      id: assignment.id,
      type: "ASSIGNMENT",
      title: describeAssignmentSubmission(assignment),
      date: new Date(assignment.submittedAt ?? Date.now()),
      metadata: {
        mediaUrl: assignment.mediaUrl,
        feedbackCount: feedbackCounts[assignment.id] ?? 0,
      },
      space,
      source: source("ASSIGNMENT"),
    });
  }

  for (const task of tasks) {
    items.push({
      id: task.id,
      type: "ASSIGNMENT",
      subType: ASSIGNMENT_TASK_SUBTYPE,
      title: task.title,
      date: new Date(task.dueAt ?? task.createdAt),
      metadata: {
        taskId: task.id,
        dueAt: task.dueAt ? task.dueAt.toISOString() : null,
        submissionFormat: task.submissionFormat,
      },
      space,
      source: source("ASSIGNMENT_TASK"),
    });
  }

  return items.sort((a, b) => b.date.getTime() - a.date.getTime());
}
