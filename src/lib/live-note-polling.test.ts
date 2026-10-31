import assert from "node:assert/strict";
import test from "node:test";
import { getLiveNotePollDelay } from "./live-note-polling";

test("숨김·오프라인이면 폴링하지 않는다", () => {
  assert.equal(getLiveNotePollDelay({ visible: false, online: true, unchangedPolls: 0 }), null);
  assert.equal(getLiveNotePollDelay({ visible: true, online: false, unchangedPolls: 0 }), null);
  assert.equal(getLiveNotePollDelay({ visible: false, online: false, unchangedPolls: 9 }), null);
});

test("기본 4초에서 변화 없는 조회 3회마다 두 배로 늘고 20초를 넘지 않는다", () => {
  const delay = (unchangedPolls: number) => getLiveNotePollDelay({ visible: true, online: true, unchangedPolls });
  assert.equal(delay(0), 4_000);
  assert.equal(delay(1), 4_000);
  assert.equal(delay(2), 4_000);
  assert.equal(delay(3), 8_000);
  assert.equal(delay(5), 8_000);
  assert.equal(delay(6), 16_000);
  assert.equal(delay(9), 20_000, "32초가 아니라 상한 20초");
  assert.equal(delay(100), 20_000);
  assert.equal(delay(-1), 4_000, "음수는 0으로 본다");
});

test("테스트용 짧은 기본 간격도 같은 규칙으로 늘어난다", () => {
  const delay = (unchangedPolls: number) => getLiveNotePollDelay({ visible: true, online: true, unchangedPolls, baseDelay: 10, maxDelay: 25 });
  assert.equal(delay(0), 10);
  assert.equal(delay(3), 20);
  assert.equal(delay(6), 25);
  assert.equal(getLiveNotePollDelay({ visible: true, online: true, unchangedPolls: 6, baseDelay: 50, maxDelay: 25 }), 50, "상한이 기본보다 작으면 기본을 쓴다");
});
