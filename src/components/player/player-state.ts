/**
 * @file src/components/player/player-state.ts
 * @description 이어 듣기 플레이어의 상태 전이(순수). 게시물 화면 안 플레이어(page)와 앱 아래 미니 플레이어
 * (persistent) 중 한쪽만 재생을 맡는다.
 *
 * - 게시물 화면이 열리면(page-mount) 그 게시물이 재생 중이던 곡이면 화면 안 플레이어가 이어받는다.
 * - 게시물 화면을 떠날 때(page-unmount) 재생 중이면 미니 플레이어가 그 위치부터 이어받고, 멈춰 있었으면 끝낸다.
 * - 다른 믹스셋을 재생하면(start) 지금 곡을 바꾼다.
 */

export type PlayerTrackKind = "audio" | "youtube" | "soundcloud";

export type PlayerTrack = {
  /** 게시물 ID. 같은 게시물이면 같은 곡으로 본다. */
  key: string;
  kind: PlayerTrackKind;
  url: string;
  title: string;
  /** 작성자 등 보조 줄. */
  subtitle: string;
  /** "게시물로 가기" 주소. */
  href: string;
  /** 업로드 오디오의 매체 ID(파형 저장용). 링크·예전 오디오는 null. */
  mediaObjectId: string | null;
};

export type PlayerOwner = "page" | "persistent";

export type PlayerState = {
  track: PlayerTrack | null;
  owner: PlayerOwner;
  /** 지금 열린 게시물 화면 플레이어의 곡 key. */
  pageKey: string | null;
  playing: boolean;
  position: number;
  duration: number;
  /** 링크 플레이어가 주인이 바뀌어 새로 열릴 때 이어 갈 위치. nonce는 같은 값도 새 요청으로 만든다. */
  resume: { seconds: number; nonce: number } | null;
  videoCollapsed: boolean;
  /** 공용 오디오 요소가 지금 곡을 재생하지 못했다(`error` event). 다음 start에서 지운다. */
  error: boolean;
};

export type PlayerAction =
  | { type: "page-mount"; key: string }
  | { type: "page-unmount"; key: string }
  | { type: "start"; track: PlayerTrack; at?: number }
  | { type: "progress"; key: string; position?: number; duration?: number; playing?: boolean }
  | { type: "close" }
  | { type: "toggle-video" }
  | { type: "error"; key: string };

export const INITIAL_PLAYER_STATE: PlayerState = {
  track: null,
  owner: "page",
  pageKey: null,
  playing: false,
  position: 0,
  duration: 0,
  resume: null,
  videoCollapsed: false,
  error: false,
};

function nextResume(state: PlayerState): PlayerState["resume"] {
  return { seconds: state.position, nonce: (state.resume?.nonce ?? 0) + 1 };
}

function finiteNonNegative(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function reducePlayer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "page-mount": {
      if (state.track?.key === action.key && state.owner === "persistent") {
        return { ...state, pageKey: action.key, owner: "page", resume: nextResume(state) };
      }
      return state.pageKey === action.key ? state : { ...state, pageKey: action.key };
    }
    case "page-unmount": {
      if (state.pageKey !== action.key) return state;
      const base = { ...state, pageKey: null };
      if (state.track?.key !== action.key || state.owner !== "page") return base;
      if (state.playing) return { ...base, owner: "persistent", resume: nextResume(state) };
      return { ...base, track: null, playing: false, position: 0, duration: 0, resume: null };
    }
    case "start": {
      const owner: PlayerOwner = state.pageKey === action.track.key ? "page" : "persistent";
      const same = state.track?.key === action.track.key && state.track.url === action.track.url;
      const position = finiteNonNegative(action.at) ? action.at : same ? state.position : 0;
      return {
        ...state,
        track: action.track,
        owner,
        playing: true,
        position,
        duration: same ? state.duration : 0,
        resume: owner === "persistent" ? { seconds: position, nonce: (state.resume?.nonce ?? 0) + 1 } : null,
        videoCollapsed: same ? state.videoCollapsed : false,
        error: false,
      };
    }
    case "progress": {
      if (state.track?.key !== action.key) return state;
      const next = {
        ...state,
        position: finiteNonNegative(action.position) ? action.position : state.position,
        duration: finiteNonNegative(action.duration) && action.duration > 0 ? action.duration : state.duration,
        playing: action.playing ?? state.playing,
      };
      return next.position === state.position && next.duration === state.duration && next.playing === state.playing ? state : next;
    }
    case "close":
      return { ...INITIAL_PLAYER_STATE, pageKey: state.pageKey, resume: state.resume };
    case "toggle-video":
      return { ...state, videoCollapsed: !state.videoCollapsed };
    case "error":
      if (state.track?.key !== action.key || state.error) return state;
      return { ...state, error: true, playing: false };
  }
}

/** 미니 플레이어를 보일지: 곡이 있고 게시물 화면이 맡고 있지 않을 때. */
export function isMiniPlayerVisible(state: PlayerState): boolean {
  return Boolean(state.track) && state.owner === "persistent";
}

/** 이 게시물 화면 플레이어가 지금 곡을 맡고 있는지. */
export function isPageActive(state: PlayerState, key: string): boolean {
  return state.track?.key === key && state.owner === "page";
}
