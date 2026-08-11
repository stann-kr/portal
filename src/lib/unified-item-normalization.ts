import type { CalendarEventType, QnaStatus } from "@/db/schema";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

type ProfileContext = {
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
  const space = {
    studentId: profile.id,
    label: getUnifiedItemSpaceLabel(profile),
  };
  const source = (entity: UnifiedItem["source"]["entity"]): UnifiedItem["source"] => ({
    kind: "PORTAL",
    entity,
    label: "포털",
  });
  const items: UnifiedItem[] = [];

  for (const event of events) {
    items.push({
      id: event.id,
      type: "EVENT",
      subType: event.eventType,
      title: event.title,
      description: event.description ?? undefined,
      date: new Date(event.startTime),
      endDate: event.endTime ? new Date(event.endTime) : null,
      metadata: { eventType: event.eventType, description: event.description },
      space,
      source: source("CALENDAR_EVENT"),
    });
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

  const trackNameColumnId = columns.find((column) => column.name.toLowerCase() === "track name")?.id;
  const artistColumnId = columns.find((column) => column.name.toLowerCase() === "artist")?.id;
  for (const track of tracks) {
    const values = parseDiggingValues(track.values);
    const trackName = trackNameColumnId && typeof values[trackNameColumnId] === "string"
      ? values[trackNameColumnId]
      : undefined;
    const artistName = artistColumnId && typeof values[artistColumnId] === "string"
      ? values[artistColumnId]
      : undefined;
    const title = trackName && artistName
      ? `${trackName} — ${artistName}`
      : trackName ?? track.linkUrl ?? "디깅 트랙";

    items.push({
      id: track.id,
      type: "DIGGING",
      title,
      date: new Date(track.createdAt ?? Date.now()),
      metadata: {
        values,
        linkUrl: track.linkUrl,
        columnIds: { trackName: trackNameColumnId, artist: artistColumnId },
      },
      space,
      source: source("DIGGING_TRACK"),
    });
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
