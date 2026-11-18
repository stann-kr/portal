import assert from "node:assert/strict";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { createFullEditorExtensions } from "./full-editor-extensions";
import {
  extractPastedDataImages,
  pastedDataImageFile,
  pastedImagesRejectedMessage,
  pastedImagesUploadFailedMessage,
} from "./pasted-data-images";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const schema = getSchema(createFullEditorExtensions());
const text = (value: string) => ({ type: "paragraph", content: [{ type: "text", text: value }] });
const image = (src: string) => ({ type: "image", attrs: { src } });
const sliceOf = (content: unknown[], openStart = 0, openEnd = 0) =>
  new Slice(schema.nodeFromJSON({ type: "doc", content }).content, openStart, openEnd);

test("붙여넣을 조각에서 data URL 이미지만 빼고 주소 이미지와 글은 그대로 둔다", () => {
  const extracted = extractPastedDataImages(sliceOf([
    text("앞 글"),
    image(PNG),
    image("https://example.test/a.png"),
    { type: "blockquote", content: [text("인용"), image(`${PNG}AAAA`)] },
    text("뒤 글"),
  ], 1, 1));

  assert.deepEqual(extracted.sources, [PNG, `${PNG}AAAA`]);
  assert.equal(extracted.slice.openStart, 1);
  assert.equal(extracted.slice.openEnd, 1);
  const json = extracted.slice.content.toJSON() as { type: string; attrs?: { src?: string }; content?: unknown[] }[];
  assert.deepEqual(json.map((node) => node.type), ["paragraph", "image", "blockquote", "paragraph"]);
  assert.equal(json[1].attrs?.src, "https://example.test/a.png");
  assert.equal(JSON.stringify(json).includes("data:"), false);
});

test("data 이미지가 없으면 받은 조각을 그대로 돌려주고, 이미지만 있던 조각은 빈 조각이 된다", () => {
  const plain = sliceOf([text("글만")], 1, 1);
  const untouched = extractPastedDataImages(plain);
  assert.equal(untouched.slice, plain);
  assert.deepEqual(untouched.sources, []);

  const onlyImage = extractPastedDataImages(sliceOf([image(PNG)]));
  assert.deepEqual(onlyImage.sources, [PNG]);
  assert.equal(onlyImage.slice.size, 0);
});

test("이미지만 들어 있던 칸은 문서 규칙에 맞게 빈 문단으로 채우고, 열린 깊이는 남은 구조에 맞춘다", () => {
  const extracted = extractPastedDataImages(sliceOf([{ type: "blockquote", content: [image(PNG)] }], 0, 0));
  const [quote] = extracted.slice.content.toJSON() as { type: string; content: { type: string }[] }[];
  assert.equal(quote.type, "blockquote");
  assert.deepEqual(quote.content.map((node) => node.type), ["paragraph"]);

  // 뒤 끝이 이미지(잎)였던 조각: 이미지를 빼도 열린 깊이가 남은 구조보다 깊어지지 않는다.
  const trailing = extractPastedDataImages(sliceOf([text("글"), image(PNG)], 1, 0));
  assert.equal(trailing.slice.openStart, 1);
  assert.equal(trailing.slice.openEnd, 0);
  assert.doesNotThrow(() => schema.topNodeType.createChecked(null, trailing.slice.content));
});

test("data URL은 업로드할 파일로 바꾸고, 읽을 수 없는 주소는 형식 확인에서 걸리는 빈 파일이 된다", async () => {
  const png = pastedDataImageFile(PNG);
  assert.equal(png.type, "image/png");
  assert.equal(png.name, "붙여넣은 이미지.png");
  assert.deepEqual([...new Uint8Array(await png.arrayBuffer())], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const jpeg = pastedDataImageFile("data:image/jpeg;charset=utf-8;base64,/9j/");
  assert.equal(jpeg.type, "image/jpeg");
  assert.equal(jpeg.name, "붙여넣은 이미지.jpg");

  const svg = pastedDataImageFile("data:image/svg+xml;base64,PHN2Zy8+");
  assert.equal(svg.type, "image/svg+xml");

  const notBase64 = pastedDataImageFile("data:image/svg+xml;utf8,<svg/>");
  assert.equal(notBase64.type, "application/octet-stream");
  assert.equal(notBase64.size, 0);
});

test("붙여넣은 이미지 안내는 장수와 이유를 함께 적는다", () => {
  assert.equal(
    pastedImagesRejectedMessage(1, "이미지는 한 장에 10MB까지 넣을 수 있습니다."),
    "붙여넣은 이미지 1장을 넣지 못했습니다. 이미지는 한 장에 10MB까지 넣을 수 있습니다.",
  );
  assert.equal(
    pastedImagesUploadFailedMessage(2),
    "붙여넣은 이미지 2장을 올리지 못해 뺐습니다. 이미지 버튼으로 다시 넣어 주세요.",
  );
});
