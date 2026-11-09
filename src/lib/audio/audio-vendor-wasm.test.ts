import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);

test("LAME wasm: public 사본이 설치된 wasm-media-encoders의 mp3.wasm과 같다", async () => {
  const [vendored, installed] = await Promise.all([
    readFile(new URL("public/vendor/lame/mp3.wasm", root)),
    readFile(new URL("node_modules/wasm-media-encoders/wasm/mp3.wasm", root)),
  ]);
  assert.ok(vendored.equals(installed), "패키지를 올렸으면 public/vendor/lame/mp3.wasm을 다시 복사한다");
});

test("LAME wasm: 변환 Worker는 base64 내장본 대신 따로 받는 파일을 쓴다", async () => {
  const source = await readFile(new URL("src/lib/audio/audio-convert.worker.ts", root), "utf8");
  assert.match(source, /createEncoder\("audio\/mpeg", LAME_WASM_URL\)/u);
  assert.doesNotMatch(source, /createMp3Encoder/u);
});

test("고지: LGPL 전문과 공개 고지 파일이 있고 LAME 출처를 적는다", async () => {
  const [lgpl, notice] = await Promise.all([
    readFile(new URL("public/licenses/LGPL-2.0.txt", root), "utf8"),
    readFile(new URL("public/licenses/THIRD_PARTY_NOTICES.txt", root), "utf8"),
  ]);
  assert.match(lgpl, /GNU LIBRARY GENERAL PUBLIC LICENSE\s+Version 2, June 1991/u);
  assert.match(notice, /LAME 3\.100/u);
  assert.match(notice, /\/vendor\/lame\/mp3\.wasm/u);
});

test("proxy: 고지·교체용 wasm은 로그인 없이 받고, 하위 경로는 계속 보호한다", async () => {
  const source = await readFile(new URL("src/proxy.ts", root), "utf8");
  const pattern = /matcher:\s*\[\s*"([^"]+)"/u.exec(source)?.[1];
  assert.ok(pattern);
  const matcher = new RegExp(`^${pattern.replace(/\\\\/gu, "\\")}$`, "u");
  assert.equal(matcher.test("/licenses/LGPL-2.0.txt"), false);
  assert.equal(matcher.test("/vendor/lame/mp3.wasm"), false);
  assert.equal(matcher.test("/dashboard/licenses/x"), true);
  assert.equal(matcher.test("/licensesx"), true);
});
