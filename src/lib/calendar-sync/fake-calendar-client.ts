/**
 * 테스트 전용 가짜 provider client(메모리 캘린더 하나). etag는 쓰기마다 바뀌고 cursor는 변경 순번이다.
 * 실제 코드에서 import하지 않는다.
 */
import assert from "node:assert/strict";
import {
  CalendarConflictError,
  CalendarNotFoundError,
  CalendarProviderError,
  type CalendarProviderClient,
  type PullResult,
  type PullWindow,
  type RemoteCalendar,
  type RemoteEvent,
  type RemoteEventInput,
  type WriteResult,
} from "./types";

/** 원격 캘린더 하나를 흉내 낸다. etag는 쓰기마다 바뀌고 cursor는 변경 순번이다. */
export class FakeCalendar implements CalendarProviderClient {
  readonly kind = "GOOGLE" as const;
  events = new Map<string, RemoteEvent>();
  private changeSeq = new Map<string, number>();
  private deletedSeq = new Map<string, number>();
  private seq = 0;
  private nextId = 0;
  calls: string[] = [];
  loseNextCreateResponse = false;
  failAll: Error | null = null;

  private touch(id: string): void {
    this.seq += 1;
    this.changeSeq.set(id, this.seq);
    this.deletedSeq.delete(id);
  }

  private guard(name: string): void {
    this.calls.push(name);
    if (this.failAll) throw this.failAll;
  }

  private newEtag(): string {
    this.nextId += 1;
    return `"etag-${this.nextId}"`;
  }

  /** 원격 사용자가 직접 만든 일정. */
  remoteAdd(event: Partial<RemoteEvent> & { title: string; start: Date; end: Date }): RemoteEvent {
    this.nextId += 1;
    const created: RemoteEvent = {
      remoteId: event.remoteId ?? `remote-${this.nextId}`,
      etag: this.newEtag(),
      description: "",
      allDay: false,
      status: "confirmed",
      ...event,
    };
    this.events.set(created.remoteId, created);
    this.touch(created.remoteId);
    return created;
  }

  remoteEdit(remoteId: string, patch: Partial<RemoteEvent>): void {
    const current = this.events.get(remoteId);
    assert.ok(current, "원격 일정이 있어야 한다");
    this.events.set(remoteId, { ...current, ...patch, etag: this.newEtag() });
    this.touch(remoteId);
  }

  remoteDelete(remoteId: string): void {
    this.events.delete(remoteId);
    this.seq += 1;
    this.deletedSeq.set(remoteId, this.seq);
    this.changeSeq.delete(remoteId);
  }

  writeCount(): number {
    return this.calls.filter((call) => call === "create" || call === "update" || call === "remove").length;
  }

  calendars: RemoteCalendar[] = [{ id: "cal-1", name: "학생 캘린더", readOnly: false }];

  async listCalendars(): Promise<RemoteCalendar[]> {
    this.guard("listCalendars");
    return this.calendars;
  }

  async pull(calendarId: string, cursor: string | null, window: PullWindow): Promise<PullResult> {
    this.guard("pull");
    if (cursor === null) {
      const changed = [...this.events.values()].filter((event) => event.end >= window.from && event.start <= window.to);
      return { changed, deletedRemoteIds: [], nextCursor: String(this.seq), fullResync: false };
    }
    const since = Number(cursor);
    const changed = [...this.changeSeq.entries()]
      .filter(([, seq]) => seq > since)
      .map(([id]) => this.events.get(id)!)
      .filter(Boolean);
    const deletedRemoteIds = [...this.deletedSeq.entries()].filter(([, seq]) => seq > since).map(([id]) => id);
    return { changed, deletedRemoteIds, nextCursor: String(this.seq), fullResync: false };
  }

  private toEvent(remoteId: string, etag: string, input: RemoteEventInput): RemoteEvent {
    return {
      remoteId,
      etag,
      title: input.title,
      description: input.description ?? "",
      start: input.start,
      end: input.end,
      allDay: Boolean(input.allDay),
      status: "confirmed",
      portalRef: input.portalRef,
    };
  }

  async create(calendarId: string, input: RemoteEventInput): Promise<WriteResult> {
    this.guard("create");
    this.nextId += 1;
    const remoteId = `created-${this.nextId}`;
    const etag = this.newEtag();
    this.events.set(remoteId, this.toEvent(remoteId, etag, input));
    this.touch(remoteId);
    if (this.loseNextCreateResponse) {
      this.loseNextCreateResponse = false;
      throw new CalendarProviderError("response lost");
    }
    return { remoteId, etag };
  }

  async update(calendarId: string, remoteId: string, input: RemoteEventInput, ifMatchEtag: string): Promise<WriteResult> {
    this.guard("update");
    const current = this.events.get(remoteId);
    if (!current) throw new CalendarNotFoundError("missing", { status: 404 });
    if (ifMatchEtag !== "*" && current.etag !== ifMatchEtag) throw new CalendarConflictError("conflict", { status: 412 });
    const etag = this.newEtag();
    this.events.set(remoteId, this.toEvent(remoteId, etag, input));
    this.touch(remoteId);
    return { remoteId, etag };
  }

  async remove(calendarId: string, remoteId: string, ifMatchEtag: string): Promise<void> {
    this.guard("remove");
    const current = this.events.get(remoteId);
    if (!current) throw new CalendarNotFoundError("missing", { status: 404 });
    if (ifMatchEtag !== "*" && current.etag !== ifMatchEtag) throw new CalendarConflictError("conflict", { status: 412 });
    this.remoteDelete(remoteId);
  }

  async findByPortalRef(calendarId: string, portalRef: string): Promise<RemoteEvent | null> {
    this.guard("findByPortalRef");
    return [...this.events.values()].find((event) => event.portalRef === portalRef) ?? null;
  }
}
