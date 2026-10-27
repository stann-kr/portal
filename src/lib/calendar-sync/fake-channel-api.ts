/**
 * 테스트 전용: Google 변경 알림 channel 등록·중지를 메모리에서 흉내 낸다. 실제 코드에서 import하지 않는다.
 */
import type { GoogleChannelApiFactory } from "./client-factory";
import type { GoogleWatchInput } from "./google";

export type RecordedWatch = GoogleWatchInput & { connectionId: string; resourceId: string };
export type RecordedStop = { connectionId: string; channelId: string; resourceId: string };

export class FakeGoogleChannels {
  watches: RecordedWatch[] = [];
  stops: RecordedStop[] = [];
  failWatch: Error | null = null;
  failStop: Error | null = null;
  /** watch 응답 직전에 부른다(경합 재현용). */
  beforeWatchResolves: (() => void | Promise<void>) | null = null;
  expiresAt: () => Date = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
  private sequence = 0;

  readonly factory: GoogleChannelApiFactory = async ({ connection }) => ({
    watch: async (input) => {
      if (this.failWatch) throw this.failWatch;
      this.sequence += 1;
      const resourceId = `resource-${this.sequence}`;
      this.watches.push({ ...input, connectionId: connection.id, resourceId });
      await this.beforeWatchResolves?.();
      return { resourceId, expiresAt: this.expiresAt() };
    },
    stop: async (input) => {
      if (this.failStop) throw this.failStop;
      this.stops.push({ ...input, connectionId: connection.id });
    },
  });

  /** 해당 캘린더에 마지막으로 등록한 channel(알림 header 재현용). */
  lastWatchFor(calendarId: string): RecordedWatch {
    const found = [...this.watches].reverse().find((watch) => watch.calendarId === calendarId);
    if (!found) throw new Error(`no watch for ${calendarId}`);
    return found;
  }
}
