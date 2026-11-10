/**
 * @file src/components/player/player-store.ts
 * @description 앱 전체에서 하나뿐인 재생 상태와 업로드 오디오 요소.
 *
 * 업로드 오디오는 문서에 붙이지 않은 단일 `<audio>`(모듈 단위)로 재생한다. 문서에서 떼어 낸 media 요소는
 * 멈추지만 처음부터 붙이지 않은 요소는 계속 재생되므로, 게시물 화면 파형과 하단 미니 플레이어가 같은 요소를
 * 조작하고 app router 이동이나 레이아웃 교체에도 소리가 끊기지 않는다.
 * YouTube·SoundCloud는 iframe이라 옮길 수 없으므로 주인이 바뀔 때 위치를 넘겨 새 플레이어가 이어 간다.
 */
"use client";

import { useSyncExternalStore } from "react";
import {
  INITIAL_PLAYER_STATE,
  reducePlayer,
  type PlayerAction,
  type PlayerState,
  type PlayerTrack,
} from "./player-state";

/** HTMLMediaElement.HAVE_METADATA */
const HAVE_METADATA = 1;

let state: PlayerState = INITIAL_PLAYER_STATE;
const listeners = new Set<() => void>();
let audio: HTMLAudioElement | null = null;
let pendingSeek: number | null = null;
/** 지금 주소의 metadata를 받았는지. hydration·테스트 환경에서 readyState가 늦게 바뀌어도 event로 판단한다. */
let audioReady = false;
/**
 * 재생을 멈출 수 있는 손잡이. 업로드 오디오 줄은 media 요소(HTMLMediaElement), 링크 줄·미니 플레이어는
 * iframe 플레이어의 PlaybackController를 넘긴다. `paused`를 알려 주지 않으면 늘 멈춤을 요청한다(이미 멈춘 iframe에는 영향 없음).
 */
export type PlaybackStopHandle = { pause(): void; readonly paused?: boolean };
/** 공용 플레이어 밖에서(믹스셋 목록 줄처럼) 지금 재생을 맡은 손잡이. 한 번에 하나만 소리를 낸다. */
let localOwner: PlaybackStopHandle | null = null;
/** 하단 미니 플레이어가 링크 곡(YouTube·SoundCloud)을 재생하는 iframe 손잡이. 상태만 바꾸면 iframe은 멈추지 않는다. */
let sharedLinkHandle: PlaybackStopHandle | null = null;
/** 재생 상태를 쓴 로그인 계정. 다른 계정으로 바뀌면 앞 계정의 곡을 닫는다. */
let playerOwnerId: string | null = null;

function stopHandle(handle: PlaybackStopHandle) {
  if (handle.paused === true) return;
  handle.pause();
}

function emit() {
  for (const listener of listeners) listener();
}

export function dispatchPlayer(action: PlayerAction): void {
  const previous = state;
  state = reducePlayer(state, action);
  if (state !== previous) {
    syncAudio(previous, state);
    // 공용 플레이어가 재생을 시작하면 목록 줄 재생은 멈춘다.
    if (state.playing && !previous.playing && localOwner) stopHandle(localOwner);
    emit();
  }
}

export function getPlayerState(): PlayerState {
  return state;
}

export function subscribePlayer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlayerState(): PlayerState {
  return useSyncExternalStore(subscribePlayer, getPlayerState, () => INITIAL_PLAYER_STATE);
}

/** 테스트에서 초기 상태로 돌린다. */
export function resetPlayerForTests(): void {
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
  }
  audio = null;
  pendingSeek = null;
  audioReady = false;
  localOwner = null;
  sharedLinkHandle = null;
  playerOwnerId = null;
  state = INITIAL_PLAYER_STATE;
  emit();
}

function isReady(element: HTMLAudioElement): boolean {
  return audioReady || element.readyState >= HAVE_METADATA;
}

function applyPendingSeek(element: HTMLAudioElement) {
  if (pendingSeek === null || !isReady(element)) return;
  element.currentTime = pendingSeek;
  pendingSeek = null;
}

/** 업로드 오디오 재생 요소(문서에 붙이지 않음). 서버에서는 null. */
export function getSharedAudio(): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  if (audio) return audio;
  const element = document.createElement("audio");
  element.preload = "metadata";
  const report = () => {
    const key = state.track?.kind === "audio" ? state.track.key : null;
    if (!key) return;
    dispatchPlayer({
      type: "progress",
      key,
      position: element.currentTime,
      duration: Number.isFinite(element.duration) ? element.duration : undefined,
      playing: !element.paused && !element.ended,
    });
  };
  const onReady = () => {
    audioReady = true;
    applyPendingSeek(element);
    report();
  };
  element.addEventListener("loadedmetadata", onReady);
  element.addEventListener("canplay", onReady);
  element.addEventListener("timeupdate", report);
  element.addEventListener("durationchange", report);
  element.addEventListener("play", report);
  element.addEventListener("pause", report);
  element.addEventListener("ended", report);
  // 받지 못했거나 디코딩하지 못한 오디오. 곡을 닫으며 src를 뗀 경우(주소 없음)는 오류로 보지 않는다.
  element.addEventListener("error", () => {
    const key = state.track?.kind === "audio" ? state.track.key : null;
    if (!key || !element.getAttribute("src")) return;
    dispatchPlayer({ type: "error", key });
  });
  element.addEventListener("timeupdate", () => updateMediaSessionPosition(element));
  audio = element;
  return element;
}

function playAudio(element: HTMLAudioElement) {
  // 자동 재생이 막히면 그 자리에 멈춰 두고 사용자가 다시 누른다.
  void Promise.resolve(element.play()).catch(() => {
    const key = state.track?.key;
    if (key) dispatchPlayer({ type: "progress", key, playing: false });
  });
}

/** 상태가 바뀐 뒤 업로드 오디오 요소를 맞춘다. */
function syncAudio(previous: PlayerState, next: PlayerState) {
  const before = previous.track?.kind === "audio" ? previous.track : null;
  const after = next.track?.kind === "audio" ? next.track : null;
  if (before && (!after || after.url !== before.url)) {
    const element = getSharedAudio();
    element?.pause();
    if (!after && element) {
      audioReady = false;
      element.removeAttribute("src");
      clearMediaSession();
    }
  }
}

/**
 * 곡을 시작하거나(다른 곡이면 바꾼다) 지정 위치부터 재생한다. 업로드 오디오는 공용 요소를 바로 재생하고,
 * 링크는 상태만 바꿔 주인 플레이어가 재생한다.
 */
export function startTrack(track: PlayerTrack, at?: number): void {
  dispatchPlayer({ type: "start", track, at });
  if (track.kind !== "audio") return;
  const element = getSharedAudio();
  if (!element) return;
  const absolute = new URL(track.url, window.location.href).href;
  if (element.src !== absolute) {
    audioReady = false;
    element.src = track.url;
    pendingSeek = typeof at === "number" ? at : null;
  } else if (typeof at === "number") {
    pendingSeek = at;
    applyPendingSeek(element);
  }
  setMediaSession(track);
  playAudio(element);
}

export function pauseTrack(): void {
  const track = state.track;
  if (!track) return;
  if (track.kind === "audio") getSharedAudio()?.pause();
  else {
    // 상태만 바꾸면 미니 플레이어의 iframe은 계속 소리를 내므로 손잡이로 직접 멈춘다.
    sharedLinkHandle?.pause();
    dispatchPlayer({ type: "progress", key: track.key, playing: false });
  }
}

export function resumeTrack(): void {
  const track = state.track;
  if (!track) return;
  if (track.kind === "audio") {
    const element = getSharedAudio();
    if (element) playAudio(element);
  } else dispatchPlayer({ type: "progress", key: track.key, playing: true });
}

/** 지금 곡의 위치를 옮긴다(업로드 오디오). 링크는 주인 플레이어가 seek 요청으로 처리한다. */
export function seekAudio(seconds: number): void {
  const element = getSharedAudio();
  if (!element || state.track?.kind !== "audio") return;
  pendingSeek = seconds;
  applyPendingSeek(element);
  dispatchPlayer({ type: "progress", key: state.track.key, position: seconds });
}

/** 공용 오디오의 현재 위치. 이 곡이 아니거나 아직 길이를 모르면 null. */
export function readAudioPosition(key: string): number | null {
  const element = audio;
  if (!element || state.track?.key !== key || state.track.kind !== "audio" || !isReady(element)) return null;
  const value = element.currentTime;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function closePlayer(): void {
  dispatchPlayer({ type: "close" });
}

/**
 * 공용 플레이어 밖의 재생(목록 줄 오디오 요소·링크 플레이어 controller)이 실제로 재생을 시작할 때 부른다.
 * 하단 미니 플레이어(공용 곡)와 다른 줄의 재생을 멈춰 소리가 겹치지 않게 한다.
 */
export function claimLocalPlayback(handle: PlaybackStopHandle): void {
  if (localOwner && localOwner !== handle) stopHandle(localOwner);
  localOwner = handle;
  if (state.track && state.playing) pauseTrack();
}

/** 목록 줄이 멈추거나 사라질 때 맡긴 손잡이를 놓는다(언마운트된 플레이어를 멈추려 하지 않게). */
export function releaseLocalPlayback(handle: PlaybackStopHandle | null): void {
  if (handle && localOwner === handle) localOwner = null;
}

/** 하단 미니 플레이어가 링크 곡 iframe의 controller를 맡긴다(null이면 놓는다). 앞 손잡이가 다르면 무시한다. */
export function bindSharedLinkPlayback(handle: PlaybackStopHandle | null, previous: PlaybackStopHandle | null = null): void {
  if (handle) sharedLinkHandle = handle;
  else if (previous && sharedLinkHandle === previous) sharedLinkHandle = null;
}

/**
 * 로그아웃했거나 다른 계정으로 바뀌면 재생 상태(곡·위치·미니 플레이어)를 비운다.
 * ownerId가 null이면(로그아웃) 무조건 닫고, 다른 계정이면 앞 계정의 곡을 닫는다. 같은 계정이면 그대로 둔다.
 */
export function bindPlayerOwner(ownerId: string | null): void {
  const changed = ownerId === null || (playerOwnerId !== null && playerOwnerId !== ownerId);
  playerOwnerId = ownerId;
  if (!changed) return;
  if (localOwner) stopHandle(localOwner);
  localOwner = null;
  if (state.track) closePlayer();
}

// ── 잠금 화면 조작(Media Session) ──

function mediaSession(): MediaSession | null {
  return typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;
}

function setMediaSession(track: PlayerTrack) {
  const session = mediaSession();
  if (!session) return;
  try {
    if (typeof MediaMetadata !== "undefined") {
      session.metadata = new MediaMetadata({ title: track.title, artist: track.subtitle, album: "Portal - Stann 믹스셋" });
    }
    session.setActionHandler("play", () => resumeTrack());
    session.setActionHandler("pause", () => pauseTrack());
    session.setActionHandler("seekbackward", (details) => seekAudio(Math.max(0, (audio?.currentTime ?? 0) - (details.seekOffset ?? 10))));
    session.setActionHandler("seekforward", (details) => seekAudio((audio?.currentTime ?? 0) + (details.seekOffset ?? 10)));
    session.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") seekAudio(details.seekTime);
    });
  } catch {
    // 일부 브라우저는 지원하지 않는 action에서 예외를 던진다. 조작부 없이 재생은 계속한다.
  }
}

function clearMediaSession() {
  const session = mediaSession();
  if (!session) return;
  try {
    session.metadata = null;
    for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto"] as const) session.setActionHandler(action, null);
  } catch {
    // 무시
  }
}

let lastPositionUpdate = 0;
function updateMediaSessionPosition(element: HTMLAudioElement) {
  const session = mediaSession();
  if (!session?.setPositionState || !Number.isFinite(element.duration) || element.duration <= 0) return;
  const now = Date.now();
  if (now - lastPositionUpdate < 1000) return;
  lastPositionUpdate = now;
  try {
    session.setPositionState({ duration: element.duration, position: Math.min(element.duration, element.currentTime), playbackRate: element.playbackRate || 1 });
  } catch {
    // 무시
  }
}
