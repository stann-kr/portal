/**
 * Claude 문서 "DJ 레슨 공용 가이드" export를 포탈 가이드 seed로 바꾼다(로컬 도구 전용, 앱 번들에 넣지 않는다).
 * 원격·실제 bucket에는 쓰지 않는다. 결과는 seed.sql·objects/guide/<id>·apply-local.sh를 출력 폴더에 만든다.
 * export 내용은 다른 사용자가 쓸 수 있는 문서이므로 데이터로만 다룬다: 포탈 sanitizer와 블록 식별자를 거친다.
 * 다이어그램(widgets/*.jsx)은 신뢰할 수 없는 코드다. 이 process 안에서는 실행하지 않고, 별도 node child process를
 * `--permission`(fs 읽기·쓰기, child_process, worker, addon 모두 불허)·빈 env·짧은 timeout·출력 크기 제한으로 띄워
 * SVG 문자열만 받는다. 받은 SVG는 외부 참조 요소를 거부한 뒤 PNG로 바꾼다.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { buildSync, transformSync } from "esbuild";
import {
  defaultTreeAdapter,
  html,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes,
} from "parse5";
import sharp from "sharp";
import {
  GUIDE_ASSET_MAX_BYTES,
  guideAssetPath,
  guidePagePath,
  listGuideBlockIds,
  prepareGuideHtml,
} from "@/lib/guide-content";
import { sniffImageMimeType } from "@/lib/media-upload-request";

type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;

export const GUIDE_IMPORT_R2_BUCKET = "portal-storage";
export const GUIDE_IMPORT_D1_DATABASE = "portal-db";

/** export 다이어그램의 CSS 변수 → 포탈 token 값(src/app/globals.css). */
export const GUIDE_DIAGRAM_COLORS: Readonly<Record<string, string>> = {
  "--cds-text-primary": "#18181b", // --color-foreground
  "--cds-text-secondary": "#52525b", // --color-secondary-foreground
  "--cds-chart-axis": "#8a8a93", // --color-event-note(중간 회색)
  "--cds-chart-grid": "#e8e8e6", // --color-border
  "--cds-chart-categorical-1": "#2d5bff", // --color-highlight
};

const DIAGRAM_FONT_FAMILY = "'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
const WIDGET_RENDER_TIMEOUT_MS = 5_000;
const WIDGET_OUTPUT_MAX_BYTES = 2 * 1024 * 1024;
const WIDGET_SOURCE_MAX_BYTES = 256 * 1024;

export type GuideImportTab = { title: string; tabId: string; fileName: string };

export type GuideImportAsset = {
  id: string;
  kind: "photo" | "diagram";
  sourceKey: string;
  pageId: string;
  contentType: "image/jpeg" | "image/png";
  sizeBytes: number;
  objectPath: string;
};

export type GuideImportPage = {
  id: string;
  title: string;
  sortOrder: number;
  contentHtml: string;
  blockCount: number;
};

export type GuideImportResult = {
  outDir: string;
  pages: GuideImportPage[];
  assets: GuideImportAsset[];
  warnings: string[];
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 재실행해도 같은 id가 나오도록 원본 식별자에서 UUID 모양 id를 만든다. */
export function deriveGuideImportAssetId(sourceKey: string): string {
  const hex = sha256Hex(`portal-guide-import/v1\u0000${sourceKey}`).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export function guideImportPageId(tabId: string): string {
  return `guide-${tabId}`;
}

/** README의 "탭 7개 HTML(탭 순서): …" 줄과 "탭 id: …" 줄에서 탭 순서와 id를 읽는다. */
export function parseGuideExportReadme(readme: string): Array<{ title: string; tabId: string }> {
  const line = readme.split("\n").find((candidate) => candidate.includes("탭 순서") && candidate.includes("탭 id"));
  if (!line) throw new Error("README에서 탭 순서와 탭 id 줄을 찾지 못했습니다.");
  const titlesMatch = /탭 순서\):\s*([^.]+)\./u.exec(line);
  const idsMatch = /탭 id:\s*([0-9a-f,\s-]+)\./u.exec(line);
  if (!titlesMatch || !idsMatch) throw new Error("README 탭 줄 형식이 예상과 다릅니다.");
  const titles = titlesMatch[1]!.split(",").map((value) => value.trim()).filter(Boolean);
  const ids = idsMatch[1]!.split(",").map((value) => value.trim()).filter(Boolean);
  if (titles.length !== ids.length || titles.length === 0) {
    throw new Error(`README 탭 제목(${titles.length})과 id(${ids.length}) 수가 다릅니다.`);
  }
  return titles.map((title, index) => ({ title, tabId: ids[index]! }));
}

function attr(element: Element, name: string): string | null {
  return element.attrs.find((attribute) => attribute.name === name)?.value ?? null;
}

function setAttr(element: Element, name: string, value: string): void {
  const existing = element.attrs.find((attribute) => attribute.name === name);
  if (existing) existing.value = value;
  else element.attrs.push({ name, value });
}

function removeAttrs(element: Element, predicate: (name: string) => boolean): void {
  element.attrs = element.attrs.filter((attribute) => !predicate(attribute.name));
}

function elementsOf(parent: ParentNode): Element[] {
  const result: Element[] = [];
  const visit = (node: ParentNode) => {
    for (const child of defaultTreeAdapter.getChildNodes(node)) {
      if (!defaultTreeAdapter.isElementNode(child)) continue;
      result.push(child);
      visit(child);
    }
  };
  visit(parent);
  return result;
}

function textOf(node: ChildNode | ParentNode): string {
  if (defaultTreeAdapter.isTextNode(node as ChildNode)) {
    return defaultTreeAdapter.getTextNodeContent(node as DefaultTreeAdapterTypes.TextNode);
  }
  return defaultTreeAdapter.getChildNodes(node as ParentNode).map((child) => textOf(child)).join("");
}

function createTextElement(tagName: string, text: string, attrs: Element["attrs"] = []): Element {
  const element = defaultTreeAdapter.createElement(tagName, html.NS.HTML, attrs);
  defaultTreeAdapter.insertText(element, text);
  return element;
}

function replaceNode(node: Element, replacements: ChildNode[]): void {
  const parent = defaultTreeAdapter.getParentNode(node);
  if (!parent) return;
  for (const replacement of replacements) defaultTreeAdapter.insertBefore(parent, replacement, node);
  defaultTreeAdapter.detachNode(node);
}

function unwrap(node: Element): void {
  replaceNode(node, [...defaultTreeAdapter.getChildNodes(node)]);
}

export type GuideTabTransformContext = {
  pageTitle: string;
  /** 다른 탭 id → 포탈 페이지 id */
  tabPageIds: ReadonlyMap<string, string>;
  /** blob id → 포탈 가이드 이미지 id */
  blobAssetIds: ReadonlyMap<string, string>;
  /** 다이어그램 node id → 포탈 가이드 이미지 id(렌더 실패면 없음) */
  diagramAssetIds: ReadonlyMap<string, string>;
  createBlockId: () => string;
  warn: (message: string) => void;
};

/**
 * 탭 HTML 하나를 포탈 가이드 본문으로 바꾼다. sanitizer가 모르는 export 전용 구조(figure·byline·mention·
 * 내부 참조·blob 이미지·체크 목록)를 먼저 포탈 형식으로 옮긴 뒤 sanitize하고 블록 식별자를 붙인다.
 */
export function transformGuideTabHtml(rawHtml: string, context: GuideTabTransformContext): string {
  const contextElement = defaultTreeAdapter.createElement("div", html.NS.HTML, []);
  const fragment = parseFragment(contextElement, rawHtml, {});

  // 맨 앞 제목이 페이지 제목과 같으면 화면 제목과 겹치므로 뺀다.
  const first = defaultTreeAdapter.getChildNodes(fragment).find(defaultTreeAdapter.isElementNode);
  if (first && defaultTreeAdapter.getTagName(first) === "h1" && textOf(first).trim() === context.pageTitle) {
    defaultTreeAdapter.detachNode(first);
  }

  for (const element of elementsOf(fragment)) {
    const tag = defaultTreeAdapter.getTagName(element);
    const atom = attr(element, "data-atom");
    if (atom === "mention" || atom === "date") {
      const parent = defaultTreeAdapter.getParentNode(element);
      defaultTreeAdapter.detachNode(element);
      // byline 문단(날짜 · 작성자)은 구분 기호만 남으면 통째로 지운다.
      if (parent && defaultTreeAdapter.isElementNode(parent as ChildNode) && /^[\s·•|,/-]*$/u.test(textOf(parent))) {
        defaultTreeAdapter.detachNode(parent as Element);
      }
      continue;
    }
    if (tag === "a" && attr(element, "data-ref")?.startsWith("file/")) {
      const tabId = attr(element, "data-ref")!.slice("file/".length);
      const pageId = context.tabPageIds.get(tabId);
      removeAttrs(element, (name) => name.startsWith("data-"));
      if (pageId) setAttr(element, "href", guidePagePath(pageId));
      else {
        context.warn(`알 수 없는 내부 참조 file/${tabId}: 글자만 남김`);
        unwrap(element);
      }
      continue;
    }
    if (tag === "img") {
      const source = attr(element, "src") ?? "";
      if (source.startsWith("blob/")) {
        const assetId = context.blobAssetIds.get(source.slice("blob/".length));
        if (!assetId) {
          context.warn(`이미지 ${source}의 파일을 찾지 못해 뺐습니다.`);
          defaultTreeAdapter.detachNode(element);
          continue;
        }
        setAttr(element, "src", guideAssetPath(assetId));
      }
      continue;
    }
    if (tag === "figure" && attr(element, "data-embed")?.startsWith("node/")) {
      const nodeId = attr(element, "data-embed")!.slice("node/".length);
      const caption = elementsOf(element).find((child) => defaultTreeAdapter.getTagName(child) === "figcaption");
      const captionText = caption ? textOf(caption).replace(/\s+/gu, " ").trim() : "";
      const assetId = context.diagramAssetIds.get(nodeId);
      const replacements: ChildNode[] = [];
      if (assetId) {
        replacements.push(defaultTreeAdapter.createElement("img", html.NS.HTML, [
          { name: "src", value: guideAssetPath(assetId) },
          { name: "alt", value: captionText || "다이어그램" },
        ]));
      } else {
        context.warn(`다이어그램 node/${nodeId}를 렌더하지 못해 설명만 남겼습니다.`);
      }
      if (captionText) replacements.push(createTextElement("p", captionText));
      replaceNode(element, replacements);
      continue;
    }
    if (tag === "li" && attr(element, "data-checked") !== null) {
      setAttr(element, "data-type", "taskItem");
      for (const input of elementsOf(element).filter((child) => defaultTreeAdapter.getTagName(child) === "input")) {
        defaultTreeAdapter.detachNode(input);
      }
      const parent = defaultTreeAdapter.getParentNode(element);
      if (parent && defaultTreeAdapter.isElementNode(parent as ChildNode) && defaultTreeAdapter.getTagName(parent as Element) === "ul") {
        setAttr(parent as Element, "data-type", "taskList");
      }
    }
  }

  // 그림만 든 문단은 편집기의 블록 이미지와 같게 그림만 남긴다.
  for (const element of elementsOf(fragment)) {
    if (defaultTreeAdapter.getTagName(element) !== "p") continue;
    const children = defaultTreeAdapter.getChildNodes(element).filter(
      (child) => !(defaultTreeAdapter.isTextNode(child) && !defaultTreeAdapter.getTextNodeContent(child).trim()),
    );
    if (children.length === 1 && defaultTreeAdapter.isElementNode(children[0]!) && defaultTreeAdapter.getTagName(children[0] as Element) === "img") {
      unwrap(element);
    }
  }

  return prepareGuideHtml(serialize(fragment), context.createBlockId);
}

/**
 * 신뢰하는 고정 entry(React + renderToStaticMarkup)만 묶은 harness. 위젯 코드는 여기에 넣지 않고
 * 문자열로 넘겨 child process 안에서만 실행한다. 한 번 만들어 재사용한다.
 */
let widgetHarness: string | null = null;
function getWidgetHarness(): string {
  if (widgetHarness) return widgetHarness;
  const result = buildSync({
    stdin: {
      contents: [
        'import * as React from "react";',
        'import { renderToStaticMarkup } from "react-dom/server";',
        "globalThis.__renderGuideWidget = (code) => {",
        "  const module = { exports: {} };",
        '  new Function("React", "module", "exports", code)(React, module, module.exports);',
        "  const Component = module.exports.default;",
        '  if (typeof Component !== "function") throw new Error("default export is not a function");',
        "  return renderToStaticMarkup(React.createElement(Component));",
        "};",
      ].join("\n"),
      resolveDir: process.cwd(),
      loader: "js",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  widgetHarness = result.outputFiles[0]!.text;
  return widgetHarness;
}

/**
 * widget JSX를 격리한 child process에서 정적 SVG 문자열로 렌더한다.
 * 보안 경계는 Node permission model(fs 읽기·쓰기·child_process·worker·addon 불허)과 빈 env다.
 * Node 24 permission model은 네트워크를 막지 않는다: child가 읽을 수 있는 파일·비밀값이 없으므로 내보낼 것이 없다.
 */
export async function renderGuideWidgetSvg(source: string): Promise<string> {
  if (Buffer.byteLength(source) > WIDGET_SOURCE_MAX_BYTES) throw new Error("다이어그램 코드가 너무 큽니다.");
  if (!/^\s*export\s+default\s/u.test(source)) throw new Error("다이어그램은 export default 하나여야 합니다.");
  // 문법 변환만 한다(실행하지 않는다).
  const { code } = transformSync(source, {
    loader: "jsx",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    format: "cjs",
  });
  const script = `${getWidgetHarness()}\nprocess.stdout.write(globalThis.__renderGuideWidget(${JSON.stringify(code)}));\n`;

  return new Promise<string>((resolvePromise, rejectPromise) => {
    // fs 읽기 허용 없이 stdin의 script만 실행한다. env는 비워 비밀값을 넘기지 않는다.
    const child = spawn(process.execPath, ["--permission", "-"], {
      env: {} as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error: Error | null, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        rejectPromise(error);
      } else {
        resolvePromise(value!);
      }
    };
    const timer = setTimeout(() => finish(new Error("다이어그램 렌더 시간이 초과되었습니다.")), WIDGET_RENDER_TIMEOUT_MS);
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > WIDGET_OUTPUT_MAX_BYTES) finish(new Error("다이어그램 렌더 결과가 너무 큽니다."));
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 2_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish(error));
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        finish(new Error(`다이어그램 렌더에 실패했습니다(exit ${exitCode}): ${stderr.split("\n").find((line) => /Error/u.test(line))?.trim() ?? ""}`));
        return;
      }
      const svg = Buffer.concat(chunks).toString("utf8");
      if (!/^<svg\b/u.test(svg)) finish(new Error("다이어그램 렌더 결과가 SVG가 아닙니다."));
      else finish(null, svg);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(script);
  });
}

/** 렌더한 SVG의 CSS 변수를 포탈 색으로 바꾸고 export 전용 속성을 지운 뒤, 크기·글꼴을 명시한다. */
export function finalizeGuideDiagramSvg(svg: string): { svg: string; width: number; height: number } {
  // rasterizer가 외부·로컬 파일을 읽지 않도록 참조 요소와 내부(#) 밖 href·url()을 거부한다.
  if (/<(?:image|use|foreignObject|script|style|iframe|a)\b/iu.test(svg) || /\bhref=|url\((?!#)/iu.test(svg)) {
    throw new Error("다이어그램 SVG에 외부 참조 요소가 있어 쓰지 않았습니다.");
  }
  const unknown = new Set<string>();
  let output = svg.replace(/var\((--[a-z0-9-]+)\)/giu, (_match, name: string) => {
    const color = GUIDE_DIAGRAM_COLORS[name];
    if (!color) unknown.add(name);
    return color ?? "#18181b";
  });
  if (unknown.size > 0) throw new Error(`다이어그램 색 변수에 대응하는 포탈 색이 없습니다: ${[...unknown].join(", ")}`);
  output = output.replace(/\sdata-claude-[a-z-]+="[^"]*"/gu, "");
  const rootTag = /^<svg\b[^>]*>/u.exec(output)?.[0] ?? "";
  const viewBox = /\bviewBox="-?\d+(?:\.\d+)? -?\d+(?:\.\d+)? (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/u.exec(rootTag);
  if (!viewBox) throw new Error("다이어그램 SVG 바깥 요소에 viewBox가 없습니다.");
  const width = Number(viewBox[1]);
  const height = Number(viewBox[2]);
  output = output.replace(
    /^<svg\b/u,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="${DIAGRAM_FONT_FAMILY}"`,
  );
  return { svg: output, width, height };
}

export async function rasterizeGuideDiagram(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 192 })
    .flatten({ background: "#ffffff" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function sqlString(value: string | null): string {
  return value === null ? "NULL" : `'${value.replace(/'/gu, "''")}'`;
}

export function createGuideSeedSql(pages: readonly GuideImportPage[], assets: readonly GuideImportAsset[]): string {
  const lines = [
    "-- 공용 가이드 import seed (scripts/guide-import/build.ts로 생성). migration 0016_guide_pages 적용 뒤 실행한다.",
    "-- INSERT OR IGNORE: 같은 id가 이미 있으면 건너뛴다. 가져온 뒤 포탈이 원본이므로 다시 실행해도 포탈에서 고친 내용을 덮어쓰지 않는다.",
    "-- 주의: 포탈에서 지운 페이지는 다시 실행하면 되살아난다. 처음 한 번만 적용한다.",
  ];
  for (const page of pages) {
    lines.push(
      `INSERT OR IGNORE INTO guide_pages (id, title, sort_order, content_html, version, created_by_id, updated_by_id, created_at, updated_at) VALUES (${sqlString(page.id)}, ${sqlString(page.title)}, ${page.sortOrder}, ${sqlString(page.contentHtml)}, 1, NULL, NULL, strftime('%s', 'now'), strftime('%s', 'now'));`,
    );
  }
  for (const asset of assets) {
    lines.push(
      `INSERT OR IGNORE INTO guide_assets (id, object_key, content_type, size_bytes, guide_page_id, uploaded_by_id, created_at) VALUES (${sqlString(asset.id)}, ${sqlString(`guide/${asset.id}`)}, ${sqlString(asset.contentType)}, ${asset.sizeBytes}, ${sqlString(asset.pageId)}, NULL, strftime('%s', 'now'));`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function createApplyScript(assets: readonly GuideImportAsset[]): string {
  const commands = [
    `npx wrangler d1 execute ${GUIDE_IMPORT_D1_DATABASE} --local --file="$DIR/seed.sql"`,
    ...assets.map(
      (asset) =>
        `npx wrangler r2 object put ${GUIDE_IMPORT_R2_BUCKET}/guide/${asset.id} --local --file="$DIR/${asset.objectPath}" --content-type=${asset.contentType}`,
    ),
  ];
  return [
    "#!/bin/sh",
    "# 로컬 D1·R2에 가이드를 넣는 명령을 출력만 한다. 실행하지 않는다.",
    "# 확인한 뒤 저장소 루트에서 직접 실행한다. --remote는 별도 승인 없이 쓰지 않는다.",
    'DIR="$(cd "$(dirname "$0")" && pwd)"',
    "cat <<EOF",
    ...commands,
    "EOF",
    "",
  ].join("\n");
}

async function findTabFile(exportDir: string, title: string): Promise<string> {
  const target = `${title}.html`.normalize("NFC");
  const match = (await readdir(exportDir)).find((name) => name.normalize("NFC") === target);
  if (!match) throw new Error(`탭 파일을 찾지 못했습니다: ${target}`);
  return match;
}

/** export 폴더를 읽어 출력 폴더에 seed·object·적용 안내를 만든다. 원격·실제 bucket·로컬 D1 상태에는 쓰지 않는다. */
export async function buildGuideImport(exportDir: string, outDir: string): Promise<GuideImportResult> {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const readme = await readFile(join(exportDir, "README.md"), "utf8");
  const tabs: GuideImportTab[] = [];
  for (const tab of parseGuideExportReadme(readme)) {
    tabs.push({ ...tab, fileName: await findTabFile(exportDir, tab.title) });
  }
  const tabPageIds = new Map(tabs.map((tab) => [tab.tabId, guideImportPageId(tab.tabId)]));

  const blobAssetFiles = new Map<string, string>();
  for (const line of (await readFile(join(exportDir, "blob-assets.txt"), "utf8")).split("\n")) {
    const [blobId, assetFile] = line.trim().split(/\s+/u);
    if (blobId && assetFile && /^[0-9a-f-]+$/u.test(blobId) && /^[0-9a-f]+$/u.test(assetFile)) {
      blobAssetFiles.set(blobId, assetFile);
    }
  }

  const objectsDir = join(outDir, "objects", "guide");
  await mkdir(objectsDir, { recursive: true });
  const assets: GuideImportAsset[] = [];
  const assetsById = new Map<string, GuideImportAsset>();

  // 다이어그램은 페이지에서 처음 쓰일 때 렌더한다(페이지 연결을 정하기 위해).
  const widgetDir = join(exportDir, "widgets");
  const widgetFiles = new Set((await readdir(widgetDir)).filter((name) => /^[0-9a-f-]+\.jsx$/u.test(name)));

  const pages: GuideImportPage[] = [];
  for (const [sortOrder, tab] of tabs.entries()) {
    const pageId = guideImportPageId(tab.tabId);
    const rawHtml = await readFile(join(exportDir, tab.fileName), "utf8");

    const blobAssetIds = new Map<string, string>();
    for (const match of rawHtml.matchAll(/src="blob\/([0-9a-f-]+)"/gu)) {
      const blobId = match[1]!;
      const assetFile = blobAssetFiles.get(blobId);
      if (!assetFile) continue;
      const id = deriveGuideImportAssetId(`photo:${assetFile}`);
      blobAssetIds.set(blobId, id);
      if (assetsById.has(id)) continue;
      const sourcePath = join(exportDir, "assets", `${assetFile}.jpg`);
      const bytes = await readFile(sourcePath);
      const contentType = sniffImageMimeType(new Uint8Array(bytes.subarray(0, 16)));
      if (contentType !== "image/jpeg" || bytes.byteLength < 1 || bytes.byteLength > GUIDE_ASSET_MAX_BYTES) {
        warn(`사진 ${assetFile}.jpg 형식·크기가 허용 범위 밖이라 뺐습니다.`);
        blobAssetIds.delete(blobId);
        continue;
      }
      await copyFile(sourcePath, join(objectsDir, id));
      const asset: GuideImportAsset = {
        id, kind: "photo", sourceKey: `assets/${assetFile}.jpg`, pageId, contentType, sizeBytes: bytes.byteLength, objectPath: `objects/guide/${id}`,
      };
      assets.push(asset);
      assetsById.set(id, asset);
    }

    const diagramAssetIds = new Map<string, string>();
    for (const match of rawHtml.matchAll(/data-embed="node\/([0-9a-f-]+)"/gu)) {
      const nodeId = match[1]!;
      if (!widgetFiles.has(`${nodeId}.jsx`)) continue;
      const id = deriveGuideImportAssetId(`diagram:${nodeId}`);
      if (!assetsById.has(id)) {
        try {
          const source = await readFile(join(widgetDir, `${nodeId}.jsx`), "utf8");
          const { svg } = finalizeGuideDiagramSvg(await renderGuideWidgetSvg(source));
          const png = await rasterizeGuideDiagram(svg);
          if (png.byteLength > GUIDE_ASSET_MAX_BYTES) throw new Error("PNG가 10MiB를 넘습니다.");
          await writeFile(join(objectsDir, id), png);
          const asset: GuideImportAsset = {
            id, kind: "diagram", sourceKey: `widgets/${nodeId}.jsx`, pageId, contentType: "image/png", sizeBytes: png.byteLength, objectPath: `objects/guide/${id}`,
          };
          assets.push(asset);
          assetsById.set(id, asset);
        } catch (error) {
          warn(`다이어그램 ${nodeId}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }
      diagramAssetIds.set(nodeId, id);
    }

    let blockSequence = 0;
    const blockPrefix = `g${sha256Hex(tab.tabId).slice(0, 6)}`;
    const contentHtml = transformGuideTabHtml(rawHtml, {
      pageTitle: tab.title,
      tabPageIds,
      blobAssetIds,
      diagramAssetIds,
      createBlockId: () => `${blockPrefix}-${(blockSequence += 1).toString(36)}`,
      warn: (message) => warn(`${tab.title}: ${message}`),
    });
    pages.push({ id: pageId, title: tab.title, sortOrder, contentHtml, blockCount: listGuideBlockIds(contentHtml).length });
  }

  await writeFile(join(outDir, "seed.sql"), createGuideSeedSql(pages, assets), "utf8");
  await writeFile(join(outDir, "apply-local.sh"), createApplyScript(assets), { encoding: "utf8", mode: 0o755 });
  await writeFile(
    join(outDir, "manifest.json"),
    `${JSON.stringify({
      pages: pages.map(({ id, title, sortOrder, blockCount }) => ({ id, title, sortOrder, blockCount })),
      assets: assets.map(({ id, kind, sourceKey, pageId, contentType, sizeBytes }) => ({ id, kind, sourceKey, pageId, contentType, sizeBytes })),
      warnings,
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(outDir, "README.md"),
    [
      "# 공용 가이드 import 결과",
      "",
      `- 페이지 ${pages.length}개, 사진 ${assets.filter((asset) => asset.kind === "photo").length}개, 다이어그램 ${assets.filter((asset) => asset.kind === "diagram").length}개`,
      "- `seed.sql`: guide_pages·guide_assets INSERT OR IGNORE(재실행 안전, 포탈 수정본을 덮어쓰지 않음. 지운 페이지는 되살아나므로 한 번만 적용).",
      "- `objects/guide/<id>`: R2 `guide/<id>`에 넣을 이미지 bytes(사진 JPEG, 다이어그램 PNG).",
      "- `apply-local.sh`: 로컬 D1·R2 적용 명령을 출력만 한다. 원격(--remote) 적용은 별도 승인이 필요하다.",
      "",
    ].join("\n"),
    "utf8",
  );
  return { outDir, pages, assets, warnings };
}
