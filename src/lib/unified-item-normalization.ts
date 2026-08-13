import type { CalendarEventType, QnaStatus } from "@/db/schema";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

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
  mediaUrl: string;
  submittedAt: Date | null;
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
};

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
  return { kind: "PORTAL", entity, label: "포털" };
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
}: UnifiedItemNormalizationInput): UnifiedItem[] {
  const space = createSpace(profile);
  const source = createSource;
  const items: UnifiedItem[] = [];

  for (const event of events) {
    items.push(createCalendarEventUnifiedItem(event, profile));
  }

  for (const lesson of lessons) {
    items.push({
      id: lesson.id,
      type: "EVENT",
      subType: "LESSON",
      title: "레슨",
      date: new Date(lesson.scheduledAt),
      endDate: null,
      metadata: {},
      space,
      source: source("LESSON"),
    });
  }

  for (const note of notes) {
    items.push({
      id: note.id,
      type: "NOTE",
      title: note.title,
      date: new Date(note.noteDate ?? note.createdAt),
      metadata: {
        contentHtml: note.contentHtml,
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
      title: assignment.mediaUrl,
      date: new Date(assignment.submittedAt ?? Date.now()),
      metadata: {
        mediaUrl: assignment.mediaUrl,
        feedbackCount: feedbackCounts[assignment.id] ?? 0,
      },
      space,
      source: source("ASSIGNMENT"),
    });
  }

  return items.sort((a, b) => b.date.getTime() - a.date.getTime());
}
