import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AudioConvertFailedCard, AudioConvertingCard, AudioUploadingCard, formatFileSize } from "./AudioUploadStatus";

const noop = () => undefined;

test("변환 카드는 파일 이름·크기, 진행률(aria-valuenow), 남은 시간과 원본 안내를 보인다", () => {
  const html = renderToStaticMarkup(
    createElement(AudioConvertingCard, { fileName: "set-nov.wav", fileSize: 612 * 1024 * 1024, percent: 42, etaSec: 40, onCancel: noop }),
  );
  assert.match(html, /role="status"/u);
  assert.match(html, /set-nov\.wav · 612MB/u);
  assert.match(html, /aria-valuenow="42"/u);
  assert.match(html, /MP3로 바꾸는 중 42% · 약 40초 남음/u);
  assert.match(html, /이 탭을 열어 두세요\. 원본은 올라가지 않습니다\./u);
  assert.match(html, /motion-reduce:transition-none/u);
});

test("업로드 카드와 실패 카드", () => {
  const uploading = renderToStaticMarkup(createElement(AudioUploadingCard, { fileName: "set-nov.mp3", fileSize: 84 * 1024 * 1024, percent: 70, onCancel: noop }));
  assert.match(uploading, /set-nov\.mp3 · 84MB/u);
  assert.match(uploading, /올리는 중 70%/u);
  assert.match(uploading, /aria-valuenow="70"/u);
  const failed = renderToStaticMarkup(createElement(AudioConvertFailedCard, { message: "이 기기에서 이 파일을 읽지 못했습니다.", onPickAnother: noop }));
  assert.match(failed, /role="alert"/u);
  assert.match(failed, /바꾸지 못했습니다/u);
  assert.match(failed, /다른 파일 고르기/u);
  assert.equal(formatFileSize(1.5 * 1024 * 1024), "1.5MB");
  assert.equal(formatFileSize(300 * 1024), "300KB");
});
