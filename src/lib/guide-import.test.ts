import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { listGuideBlockIds, extractGuideAssetIds } from "./guide-content";
import { buildGuideImport, finalizeGuideDiagramSvg, renderGuideWidgetSvg, transformGuideTabHtml } from "./guide-import";
import { sanitizeHtml } from "./sanitize-html";

const EXPORT_DIR = join(process.cwd(), ".docs/goals/assignments-guide-calendar/guide-export");
const EXPECTED_TITLES = ["개요", "장비 소개", "장비 기능과 레이아웃", "음원 관리", "레코드박스", "음악 이론", "연습과 녹음 리뷰"];

function migratedDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const directory = join(process.cwd(), "drizzle");
  for (const file of readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort()) {
    sqlite.exec(readFileSync(join(directory, file), "utf8"));
  }
  return sqlite;
}

test("탭 변환은 byline·mention을 지우고 내부 참조·blob 이미지·다이어그램·체크 목록을 포털 형식으로 바꾼다", () => {
  const warnings: string[] = [];
  let sequence = 0;
  const output = transformGuideTabHtml(
    '<h1 id="x">개요</h1><p><time data-atom="date" datetime="2026-10-26">2026-10-26</time> · <span data-atom="mention" data-principal="u_abc">@u_abc</span></p>' +
      '<p><a data-atom="ref" data-ref="file/tab-2">다음</a> <a data-ref="file/missing">없음</a></p>' +
      '<p><img src="blob/b1" alt="CDJ"></p><figure data-embed="node/n1"><figcaption>번호 그림</figcaption></figure>' +
      '<ul><li data-checked="false"><p><input type="checkbox" disabled> 켜기</p></li></ul><p onclick="x">본문<script>alert(1)</script></p>',
    {
      pageTitle: "개요",
      tabPageIds: new Map([["tab-2", "guide-tab-2"]]),
      blobAssetIds: new Map([["b1", "0f8fad5b-d9cb-469f-a165-70867728950e"]]),
      diagramAssetIds: new Map([["n1", "7c9e6679-7425-40de-944b-e07fc1f90ae7"]]),
      createBlockId: () => `t${(sequence += 1)}`,
      warn: (message) => warnings.push(message),
    },
  );
  assert.doesNotMatch(output, /<h1|@u_|2026-10-26|data-atom|data-ref|data-principal|<input|<script|onclick|<figure|blob\//u);
  assert.match(output, /<a href="\/dashboard\/guide\/guide-tab-2">다음<\/a> 없음/u);
  assert.match(output, /<img src="\/api\/guide-assets\/0f8fad5b-d9cb-469f-a165-70867728950e" alt="CDJ" data-block-id="t\d+">/u);
  assert.match(output, /<img src="\/api\/guide-assets\/7c9e6679-7425-40de-944b-e07fc1f90ae7" alt="번호 그림" data-block-id="t\d+"><p data-block-id="t\d+">번호 그림<\/p>/u);
  assert.match(output, /<ul data-type="taskList"><li data-checked="false" data-type="taskItem"/u);
  assert.equal(sanitizeHtml(output), output);
  assert.equal(warnings.length, 1);
});

test("다이어그램 코드가 Function 생성자로 process를 얻어도 파일·자식 process·비밀 env에 닿지 못한다", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "portal-widget-boundary-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const secretPath = join(directory, "secret.txt");
  writeFileSync(secretPath, "top-secret");
  const writePath = join(directory, "written.txt");
  process.env.GUIDE_WIDGET_TEST_SECRET = "env-secret";
  context.after(() => delete process.env.GUIDE_WIDGET_TEST_SECRET);

  // Sol 교차 검증 재현 코드: 금지어 검사를 문자열 분할로 우회해 host process를 얻는다.
  const bypass = `export default () => {
    const p = React.createElement["con"+"structor"]("return pro"+"cess")();
    const kind = React.createElement["con"+"structor"]("return typeof pro"+"cess")();
    const attempt = (run) => { try { run(); return "ok"; } catch (error) { return String(error && error.code); } };
    const fs = p.getBuiltinModule("fs");
    const results = [
      kind,
      attempt(() => fs.writeFileSync(${JSON.stringify(writePath)}, "x")),
      attempt(() => fs.readFileSync(${JSON.stringify(secretPath)}, "utf8")),
      attempt(() => p.getBuiltinModule("child_process").execSync("true")),
      String(p.env.GUIDE_WIDGET_TEST_SECRET),
    ];
    return <svg viewBox="0 0 10 10"><text>{results.join("|")}</text></svg>;
  };`;
  const svg = await renderGuideWidgetSvg(bypass);
  assert.equal(svg, "<svg viewBox=\"0 0 10 10\"><text>object|ERR_ACCESS_DENIED|ERR_ACCESS_DENIED|ERR_ACCESS_DENIED|undefined</text></svg>");
  assert.equal(existsSync(writePath), false);
  assert.doesNotMatch(svg, /top-secret|env-secret/u);
});

test("다이어그램 렌더는 무한 루프·과대 출력·SVG 아닌 출력을 거부하고, 정상 코드는 포털 색으로 바꾼다", async () => {
  await assert.rejects(renderGuideWidgetSvg("export default () => { for (;;) {} };"), /시간이 초과/u);
  await assert.rejects(renderGuideWidgetSvg('export default () => <svg>{"x".repeat(3 * 1024 * 1024)}</svg>;'), /너무 큽니다|실패/u);
  await assert.rejects(renderGuideWidgetSvg("export default () => <div>x</div>;"), /SVG가 아닙니다/u);
  await assert.rejects(renderGuideWidgetSvg("const x = 1;"), /export default/u);
  const svg = await renderGuideWidgetSvg(
    "export default () => <svg viewBox='10 0 200 100' data-claude-x='1'><text fill='var(--cds-text-primary)'>가</text></svg>;",
  );
  const finalized = finalizeGuideDiagramSvg(svg);
  assert.equal(finalized.width, 200);
  assert.equal(finalized.height, 100);
  assert.doesNotMatch(finalized.svg, /var\(|data-claude/u);
  assert.match(finalized.svg, /fill="#18181b"/u);
  assert.throws(() => finalizeGuideDiagramSvg("<svg viewBox=\"0 0 1 1\"><rect fill=\"var(--cds-unknown)\"/></svg>"), /--cds-unknown/u);
  assert.throws(() => finalizeGuideDiagramSvg('<svg viewBox="0 0 1 1"><image href="file:///etc/hosts"/></svg>'), /외부 참조/u);
  assert.throws(() => finalizeGuideDiagramSvg('<svg viewBox="0 0 1 1"><rect fill="url(https://evil.test/x)"/></svg>'), /외부 참조/u);
});

test("export 전체를 seed로 만들고, 마이그레이션한 DB에 두 번 적용해도 7페이지·이미지 참조·블록 식별자가 유지된다", { skip: !existsSync(EXPORT_DIR) }, async (context) => {
  const outDir = await mkdtemp(join(tmpdir(), "portal-guide-import-"));
  context.after(() => rm(outDir, { recursive: true, force: true }));
  const result = await buildGuideImport(EXPORT_DIR, outDir);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.assets.filter((asset) => asset.kind === "photo").length, 23);
  assert.equal(result.assets.filter((asset) => asset.kind === "diagram").length, 6);
  for (const asset of result.assets) {
    const bytes = readFileSync(join(outDir, asset.objectPath));
    assert.equal(bytes.byteLength, asset.sizeBytes);
  }
  assert.match(readFileSync(join(outDir, "apply-local.sh"), "utf8"), /wrangler d1 execute portal-db --local[\s\S]*wrangler r2 object put portal-storage\/guide\//u);
  const commands = readFileSync(join(outDir, "apply-local.sh"), "utf8").split("\n").filter((line) => line.startsWith("npx wrangler"));
  assert.equal(commands.length, 30);
  assert.ok(commands.every((line) => line.includes(" --local ") && !line.includes("--remote")));

  const sqlite = migratedDatabase();
  context.after(() => sqlite.close());
  const seed = readFileSync(join(outDir, "seed.sql"), "utf8");
  sqlite.exec(seed);
  sqlite.prepare("UPDATE guide_pages SET content_html = ?, version = 2 WHERE id = ?").run("<p>포털에서 고침</p>", result.pages[0]!.id);
  sqlite.exec(seed);

  const pages = sqlite.prepare("SELECT id, title, sort_order, content_html, version FROM guide_pages ORDER BY sort_order").all() as Array<{
    id: string; title: string; sort_order: number; content_html: string; version: number;
  }>;
  assert.deepEqual(pages.map((page) => page.title), EXPECTED_TITLES);
  assert.equal(pages[0]!.content_html, "<p>포털에서 고침</p>", "재실행이 포털 수정본을 덮어쓰지 않는다");

  const assetRows = sqlite.prepare("SELECT id, guide_page_id FROM guide_assets").all() as Array<{ id: string; guide_page_id: string }>;
  assert.equal(assetRows.length, 29);
  const assetPage = new Map(assetRows.map((row) => [row.id, row.guide_page_id]));
  for (const page of pages.slice(1)) {
    const html = page.content_html;
    assert.doesNotMatch(html, /@u_|data-atom|data-principal|<time|2026-10-26|blob\/|data-embed|var\(--|<script/u);
    const ids = listGuideBlockIds(html);
    assert.ok(ids.length > 0);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(sanitizeHtml(html), html);
    for (const assetId of extractGuideAssetIds(html)) assert.equal(assetPage.get(assetId), page.id);
  }
  const referenced = new Set(result.pages.flatMap((page) => extractGuideAssetIds(page.contentHtml)));
  assert.equal(referenced.size, 29, "모든 이미지가 본문에서 쓰인다");
  const overview = result.pages[0]!.contentHtml;
  assert.doesNotMatch(overview, /@u_|2026-10-26|data-ref/u);
  assert.match(overview, /href="\/dashboard\/guide\/guide-d5fe63f2-6e5b"/u);
});
