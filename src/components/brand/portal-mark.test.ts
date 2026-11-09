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

test("브랜드: 구멍은 바깥 타원 안에 있고 같은 비율이며, 위 테두리가 아래보다 두껍다", () => {
  const { outer, hole } = PORTAL_MARK;
  assert.equal(Math.round((hole.ry / hole.rx) * 100), Math.round((outer.ry / outer.rx) * 100));
  const side = outer.rx - hole.rx;
  const top = hole.cy - hole.ry - (outer.cy - outer.ry);
  const bottom = outer.cy + outer.ry - (hole.cy + hole.ry);
  assert.ok(side > 0 && top > 0 && bottom > 0);
  assert.ok(top > bottom * 2, "구멍이 아래로 내려가 위가 두껍다");
});

test("브랜드: 바깥 타원은 가로 가운데, 폭은 타일의 76%", () => {
  const { outer, hole, viewBox } = PORTAL_MARK;
  assert.equal(outer.cx, viewBox / 2);
  assert.equal(hole.cx, viewBox / 2);
  assert.equal(Math.round(((outer.rx * 2) / viewBox) * 100), 76);
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
