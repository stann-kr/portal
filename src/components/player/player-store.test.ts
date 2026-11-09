import assert from "node:assert/strict";
import test from "node:test";
import {
  bindPlayerOwner,
  bindSharedLinkPlayback,
  claimLocalPlayback,
  getPlayerState,
  releaseLocalPlayback,
  resetPlayerForTests,
  resumeTrack,
  startTrack,
} from "./player-store";
import type { PlayerTrack } from "./player-state";

// 링크 곡은 공용 audio 요소(document)를 쓰지 않으므로 Node에서도 상태 전이를 확인할 수 있다.
const LINK_TRACK: PlayerTrack = {
  key: "post-1",
  kind: "youtube",
  url: "https://www.youtube.com/watch?v=abc",
  title: "믹스셋",
  subtitle: "김학생",
  href: "/community/post-1",
  mediaObjectId: null,
};

function fakeMedia() {
  const media = { paused: false, pauseCalls: 0, pause() { media.paused = true; media.pauseCalls += 1; } };
  return media;
}
const asElement = (media: ReturnType<typeof fakeMedia>) => media as unknown as HTMLMediaElement;

/** iframe 플레이어의 controller처럼 `paused`를 알려 주지 않는 손잡이. */
function fakeController() {
  const controller = { pauseCalls: 0, pause() { controller.pauseCalls += 1; } };
  return controller;
}

test("목록 줄 재생을 시작하면 하단 미니 플레이어를 멈추고, 다른 줄의 재생도 멈춘다", () => {
  resetPlayerForTests();
  const mini = fakeController();
  bindSharedLinkPlayback(mini);
  startTrack(LINK_TRACK);
  assert.equal(getPlayerState().playing, true);

  const rowA = fakeMedia();
  claimLocalPlayback(asElement(rowA));
  assert.equal(getPlayerState().playing, false, "공용 곡이 멈춘다");
  assert.equal(mini.pauseCalls, 1, "상태만이 아니라 미니 플레이어의 iframe도 실제로 멈춘다");
  assert.equal(getPlayerState().track?.key, "post-1", "곡은 남겨 다시 재생할 수 있다");

  const rowB = fakeMedia();
  claimLocalPlayback(asElement(rowB));
  assert.equal(rowA.pauseCalls, 1, "앞 줄이 멈춘다");
  assert.equal(rowB.pauseCalls, 0);
  resetPlayerForTests();
});

test("하단 미니 플레이어가 다시 재생을 시작하면 목록 줄 오디오가 멈춘다", () => {
  resetPlayerForTests();
  startTrack(LINK_TRACK);
  const row = fakeMedia();
  claimLocalPlayback(asElement(row));
  row.paused = false;
  resumeTrack();
  assert.equal(getPlayerState().playing, true);
  assert.equal(row.pauseCalls, 1);

  releaseLocalPlayback(asElement(row));
  row.paused = false;
  startTrack({ ...LINK_TRACK, key: "post-2" });
  assert.equal(row.pauseCalls, 1, "놓은 요소는 더 건드리지 않는다");
  resetPlayerForTests();
});

test("로그아웃하거나 다른 계정으로 바뀌면 앞 계정의 곡을 닫고, 같은 계정이면 그대로 둔다", () => {
  resetPlayerForTests();
  bindPlayerOwner("student-a");
  startTrack(LINK_TRACK);
  bindPlayerOwner("student-a");
  assert.equal(getPlayerState().track?.key, "post-1");

  bindPlayerOwner(null);
  assert.equal(getPlayerState().track, null, "로그아웃하면 닫는다");
  assert.equal(getPlayerState().playing, false);

  bindPlayerOwner("student-a");
  startTrack(LINK_TRACK);
  const row = fakeMedia();
  claimLocalPlayback(asElement(row));
  bindPlayerOwner("student-b");
  assert.equal(getPlayerState().track, null, "다른 계정이면 닫는다");
  assert.equal(row.pauseCalls, 1);
  resetPlayerForTests();
});

test("링크 줄 B가 재생을 시작하면 링크 줄 A와 하단 미니 플레이어(링크 곡)의 controller를 실제로 멈춘다", () => {
  resetPlayerForTests();
  const mini = fakeController();
  bindSharedLinkPlayback(mini);
  const rowA = fakeController();
  claimLocalPlayback(rowA);
  assert.equal(rowA.pauseCalls, 0);

  startTrack(LINK_TRACK);
  assert.equal(rowA.pauseCalls, 1, "미니 플레이어가 시작하면 줄 A가 멈춘다");
  claimLocalPlayback(rowA);
  assert.equal(mini.pauseCalls, 1, "줄 A가 다시 시작하면 미니 플레이어가 멈춘다");
  assert.equal(getPlayerState().playing, false);

  const rowB = fakeController();
  claimLocalPlayback(rowB);
  assert.equal(rowA.pauseCalls, 2, "줄 B가 시작하면 줄 A가 멈춘다");
  assert.equal(rowB.pauseCalls, 0);
  assert.equal(mini.pauseCalls, 1, "이미 멈춘 미니 플레이어는 다시 멈추지 않는다");
  resetPlayerForTests();
});

test("하단 미니 플레이어(링크 곡)가 재생을 시작하면 링크 줄 controller를 멈추고, 놓은 손잡이는 건드리지 않는다", () => {
  resetPlayerForTests();
  const mini = fakeController();
  bindSharedLinkPlayback(mini);
  startTrack(LINK_TRACK);
  const row = fakeController();
  claimLocalPlayback(row);
  assert.equal(mini.pauseCalls, 1);

  resumeTrack();
  assert.equal(getPlayerState().playing, true);
  assert.equal(row.pauseCalls, 1, "미니 플레이어가 다시 재생하면 줄이 멈춘다");

  releaseLocalPlayback(row);
  claimLocalPlayback(fakeController());
  resumeTrack();
  assert.equal(row.pauseCalls, 1, "놓은 줄은 다시 멈추지 않는다");

  // 미니 플레이어가 사라지면(다른 controller가 이미 맡은 경우 제외) 손잡이를 놓는다.
  const next = fakeController();
  bindSharedLinkPlayback(next);
  bindSharedLinkPlayback(null, mini);
  claimLocalPlayback(fakeController());
  assert.equal(next.pauseCalls, 1, "새로 맡은 미니 플레이어 손잡이는 앞 손잡이 해제로 지워지지 않는다");
  resetPlayerForTests();
});
