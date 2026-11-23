import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTERNAL_ICS_CACHE_TTL_MS,
  clearExternalIcsCache,
  externalIcsCacheKey,
  readExternalIcsCached,
} from "./external-calendar-cache";

test("iCal 구독 원문은 보관 시간 안에는 다시 받지 않고, 동시 요청은 하나로 합치며, 실패는 보관하지 않는다", async () => {
  clearExternalIcsCache();
  let now = 1_000_000;
  const clock = () => now;
  let loads = 0;
  const load = async () => {
    loads += 1;
    return `BEGIN:VCALENDAR\r\n#${loads}\r\nEND:VCALENDAR`;
  };
  const key = await externalIcsCacheKey("sub-1", "encrypted-a");

  const [first, second] = await Promise.all([readExternalIcsCached(key, load, clock), readExternalIcsCached(key, load, clock)]);
  assert.equal(loads, 1, "동시 요청은 한 번만 받는다");
  assert.equal(first, second);
  assert.equal(await readExternalIcsCached(key, load, clock), first, "보관 시간 안에는 보관한 원문을 쓴다");
  assert.equal(loads, 1);

  now += EXTERNAL_ICS_CACHE_TTL_MS + 1;
  assert.notEqual(await readExternalIcsCached(key, load, clock), first, "보관 시간이 지나면 다시 받는다");
  assert.equal(loads, 2);

  // 구독 주소를 바꾸면 열쇠가 달라 옛 원문을 쓰지 않는다. 열쇠에는 원문 값이 드러나지 않는다.
  const changed = await externalIcsCacheKey("sub-1", "encrypted-b");
  assert.notEqual(changed, key);
  assert.equal(changed.includes("encrypted"), false);

  // 실패는 보관하지 않아 다음 요청이 다시 받는다.
  const failingKey = await externalIcsCacheKey("sub-2", "encrypted-c");
  await assert.rejects(() => readExternalIcsCached(failingKey, async () => { throw new Error("offline"); }, clock));
  assert.match(await readExternalIcsCached(failingKey, load, clock), /VCALENDAR/u);
  clearExternalIcsCache();
});
