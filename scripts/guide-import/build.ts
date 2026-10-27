/**
 * 공용 가이드 export → 포털 seed 생성 CLI.
 * 사용: npx tsx scripts/guide-import/build.ts [exportDir] [outDir]
 * 기본 exportDir: .docs/goals/assignments-guide-calendar/guide-export
 * 기본 outDir: .wrangler/guide-import (git 무시 경로, D1·R2 로컬 상태와 별개 폴더)
 * 원격·실제 bucket·로컬 D1 상태에는 쓰지 않는다. 적용 명령은 outDir/apply-local.sh가 출력만 한다.
 */
import { resolve } from "node:path";
import { buildGuideImport } from "@/lib/guide-import";

const exportDir = resolve(process.argv[2] ?? ".docs/goals/assignments-guide-calendar/guide-export");
const outDir = resolve(process.argv[3] ?? ".wrangler/guide-import");

async function main(): Promise<void> {
  const result = await buildGuideImport(exportDir, outDir);
  const photos = result.assets.filter((asset) => asset.kind === "photo").length;
  const diagrams = result.assets.filter((asset) => asset.kind === "diagram").length;
  console.log(`가이드 import: 페이지 ${result.pages.length}개, 사진 ${photos}개, 다이어그램 ${diagrams}개`);
  for (const page of result.pages) console.log(`  ${page.sortOrder}. ${page.title} (${page.id}) 블록 ${page.blockCount}개`);
  for (const warning of result.warnings) console.warn(`경고: ${warning}`);
  console.log(`출력: ${result.outDir}`);
  console.log(`적용 명령 확인: sh ${resolve(outDir, "apply-local.sh")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
