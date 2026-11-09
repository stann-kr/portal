import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { APPLE_SPLASH_DEVICES, appleStartupImages } from "./apple-splash";

test("iPhone 시작 화면: 기기 크기마다 라이트·다크 이미지가 public/splash에 있고 media가 기기 설정을 따른다", () => {
  const images = appleStartupImages();
  assert.ok(Array.isArray(images));
  assert.equal(images.length, APPLE_SPLASH_DEVICES.length * 2);
  for (const image of images) {
    assert.ok(typeof image === "object" && image.media, "media가 있어야 기기별로 고른다");
    assert.ok(existsSync(join(process.cwd(), "public", image.url)), image.url);
    assert.match(image.media, /\(prefers-color-scheme: (light|dark)\)$/u);
  }
  // 생성 스크립트와 같은 크기 목록을 쓴다.
  const script = readFileSync(join(process.cwd(), "scripts/generate-splash.mjs"), "utf8");
  for (const [w, h, r] of APPLE_SPLASH_DEVICES) assert.ok(script.includes(`[${w}, ${h}, ${r}]`), `${w}x${h}@${r}`);
});
