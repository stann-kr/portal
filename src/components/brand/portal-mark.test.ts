import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import manifest from "@/app/manifest";
import { PORTAL_MARK, PORTAL_SERVICE_NAME, PORTAL_SHORT_NAME, portalMarkSvg } from "./portal-mark";

const root = new URL("../../../", import.meta.url);

test("브랜드: src/app/icon.svg는 portal-mark.ts 수치로 만든 그림과 같다", async () => {
  const svg = (await readFile(new URL("src/app/icon.svg", root), "utf8")).trim();
  assert.equal(svg, portalMarkSvg({ tile: "rounded" }));
});

test("브랜드: 고리 다섯은 안쪽일수록 작아지며 아래로 내려가고, 낙차는 목 근처에서 가팔라진다", () => {
  const rings = PORTAL_MARK.rings;
  assert.equal(rings.length, 5);
  const drops: number[] = [];
  for (let i = 1; i < rings.length; i += 1) {
    const [r, , , cy] = rings[i];
    const [pr, , , pcy] = rings[i - 1];
    assert.ok(r < pr && cy > pcy, `고리 ${i}`);
    drops.push((cy - pcy) / (pr - r)); // 반지름이 줄어드는 만큼 얼마나 떨어지는지(기울기)
  }
  for (let i = 1; i < drops.length; i += 1) assert.ok(drops[i] > drops[i - 1], "안쪽일수록 기울기가 가팔라진다");
});

test("브랜드: 중간 고리는 옅어지고 가장 깊은 고리는 다시 밝다(아래쪽 무게)", () => {
  const opacity = PORTAL_MARK.rings.map((ring) => ring[4]);
  for (let i = 1; i < opacity.length - 1; i += 1) assert.ok(opacity[i] < opacity[i - 1], `고리 ${i}`);
  assert.ok(opacity[opacity.length - 1] > opacity[opacity.length - 2]);
});

test("브랜드: manifest 이름과 아이콘(any 둥근 타일, maskable 따로)", () => {
  const m = manifest();
  assert.equal(m.name, PORTAL_SERVICE_NAME);
  assert.equal(m.short_name, PORTAL_SHORT_NAME);
  const maskable = m.icons?.find((icon) => icon.purpose === "maskable");
  assert.equal(maskable?.src, "/icons/icon-maskable-512.png");
});

test("브랜드: favicon.ico에 16·32·48 세 크기가 있다", async () => {
  const ico = await readFile(new URL("src/app/favicon.ico", root));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  assert.deepEqual([0, 1, 2].map((i) => ico[6 + i * 16]), [16, 32, 48]);
});
