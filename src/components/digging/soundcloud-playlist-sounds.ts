/**
 * @file src/components/digging/soundcloud-playlist-sounds.ts
 * @description SoundCloud 공식 위젯을 화면 밖에 잠깐 열어 플레이리스트 곡 정보를 읽는다(트랙 가져오기).
 * 위젯은 전체 곡 수만큼 항목을 주지만 제목·링크는 앞 20곡 정도만 채우고, 그것도 READY 뒤 몇 초에 걸쳐 채운다.
 * 그래서 채워진 곡 수가 기대치에 닿거나 시간이 다 될 때까지 몇 번 다시 읽는다.
 */
import { DIGGING_IMPORT_SOUNDCLOUD_LIMIT } from "@/lib/digging-import";

type SoundCloudReadWidget = {
  bind(event: string, handler: () => void): void;
  getSounds(callback: (sounds: unknown[]) => void): void;
};

type SoundCloudReadApi = {
  Widget: ((iframe: HTMLIFrameElement) => SoundCloudReadWidget) & {
    Events: { READY: string; ERROR: string };
  };
};

const WIDGET_API_URL = "https://w.soundcloud.com/player/api.js";
const READY_TIMEOUT_MS = 15_000;
const FILL_TIMEOUT_MS = 8_000;
const FILL_POLL_MS = 500;

let apiPromise: Promise<SoundCloudReadApi> | null = null;

function readApi(): SoundCloudReadApi | undefined {
  return (window as Window & { SC?: SoundCloudReadApi }).SC;
}

function loadWidgetApi(): Promise<SoundCloudReadApi> {
  const ready = readApi();
  if (ready) return Promise.resolve(ready);
  apiPromise ??= new Promise<SoundCloudReadApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = WIDGET_API_URL;
    script.async = true;
    script.onload = () => {
      const api = readApi();
      if (api) resolve(api);
      else reject(new Error("SoundCloud 위젯을 불러오지 못했습니다."));
    };
    script.onerror = () => reject(new Error("SoundCloud 위젯을 불러오지 못했습니다."));
    document.head.append(script);
  }).catch((error: unknown) => {
    apiPromise = null;
    throw error;
  });
  return apiPromise;
}

function filledCount(sounds: readonly unknown[]): number {
  return sounds.filter((sound) => Boolean(sound && typeof sound === "object" && (sound as { title?: unknown }).title)).length;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
}

/** 플레이리스트 곡 정보(위젯 `getSounds()` 그대로). 중간에 닫으면 AbortError로 멈추고 iframe을 치운다. */
export async function readSoundCloudPlaylistSounds(url: string, signal: AbortSignal): Promise<unknown[]> {
  const api = await loadWidgetApi();
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const iframe = document.createElement("iframe");
  iframe.src = `https://w.soundcloud.com/player/?${new URLSearchParams({ url, auto_play: "false", visual: "false" })}`;
  iframe.title = "SoundCloud 곡 목록 읽기";
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.allow = "autoplay";
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:320px;height:200px;border:0;opacity:0;pointer-events:none";
  document.body.append(iframe);
  try {
    const widget = api.Widget(iframe);
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("SoundCloud 응답이 늦습니다.")), READY_TIMEOUT_MS);
      const stop = (error: Error) => { window.clearTimeout(timer); reject(error); };
      widget.bind(api.Widget.Events.READY, () => { window.clearTimeout(timer); resolve(); });
      widget.bind(api.Widget.Events.ERROR, () => stop(new Error("SoundCloud가 이 플레이리스트를 열지 못했습니다.")));
      signal.addEventListener("abort", () => stop(new DOMException("aborted", "AbortError")), { once: true });
    });
    const read = () => new Promise<unknown[]>((resolve) => widget.getSounds((sounds) => resolve(Array.isArray(sounds) ? sounds : [])));
    const deadline = Date.now() + FILL_TIMEOUT_MS;
    let sounds = await read();
    while (filledCount(sounds) < Math.min(DIGGING_IMPORT_SOUNDCLOUD_LIMIT, sounds.length) && Date.now() < deadline) {
      await wait(FILL_POLL_MS, signal);
      sounds = await read();
    }
    return sounds;
  } finally {
    iframe.remove();
  }
}
