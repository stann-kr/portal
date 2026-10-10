import { access, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const repositoryRoot = process.cwd();
const sourceRoot = join(repositoryRoot, "src");
const failures = [];

async function collectFiles(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(path, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [path] : [];
  }));
  return nested.flat();
}

function repoPath(path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

function findLine(text, index) {
  return text.slice(0, index).split("\n").length;
}

const tsxFiles = await collectFiles(sourceRoot, ".tsx");
// Tailwind 4 silently drops color utilities without a matching theme token.
const globalStyles = await readFile(join(sourceRoot, "app", "globals.css"), "utf8");
const definedColorTokens = new Set([...globalStyles.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map((match) => match[1]));
const foregroundUtilityPattern = /(?<![\w-])(?:bg|text|border|ring|fill|stroke|outline|decoration|divide|placeholder|caret)-([a-z]+(?:-[a-z]+)*-foreground)(?![\w-])/gu;
const mainOwners = [];
const forbiddenPatterns = [
  { label: "hardcoded hex color", pattern: /#[0-9a-f]{3,8}\b/giu },
  { label: "raw semantic Tailwind color", pattern: /\b(?:text|bg|border|ring)-(?:red|green|blue|yellow|orange|purple|pink|gray|slate|zinc|neutral|stone)-[0-9]{2,3}(?:\/\d{1,3})?\b/gu },
  { label: "unbounded overlay shadow", pattern: /\bshadow-2xl\b/gu },
];

for (const file of tsxFiles) {
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(/<main\b/gu)) {
    mainOwners.push(`${repoPath(file)}:${findLine(text, match.index ?? 0)}`);
  }
  for (const match of text.matchAll(foregroundUtilityPattern)) {
    if (!definedColorTokens.has(match[1])) {
      failures.push(`${repoPath(file)}:${findLine(text, match.index ?? 0)} undefined color token: ${match[0]}`);
    }
  }
  for (const { label, pattern } of forbiddenPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      failures.push(`${repoPath(file)}:${findLine(text, match.index ?? 0)} ${label}: ${match[0]}`);
    }
  }
}

// Worker SSR runs in UTC: display dates must go through the explicit KST formatter.
const dateFormatOwners = new Set(["src/lib/kst-format.ts", "src/lib/date-input.ts"]);
const rawDateFormatPattern = /\.toLocale(?:Date|Time)String\(|\.toLocaleString\(\s*["']ko-KR["']|new Intl\.DateTimeFormat\(|from ["']date-fns["']/gu;
const sourceFiles = [...tsxFiles, ...await collectFiles(sourceRoot, ".ts")]
  .filter((file) => !/\.test\.tsx?$|\/src\/test\//u.test(file.replaceAll("\\", "/")));
for (const file of sourceFiles) {
  if (dateFormatOwners.has(repoPath(file))) continue;
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(rawDateFormatPattern)) {
    failures.push(`${repoPath(file)}:${findLine(text, match.index ?? 0)} raw date formatting (use formatKst): ${match[0]}`);
  }
}

// Screen readers and browser tabs identify a route by its title (WCAG 2.4.2).
// Pages that render UI declare one themselves or through their segment layout.
const metadataExportPattern = /export\s+(?:const\s+metadata\b|(?:async\s+)?function\s+generateMetadata\b)/u;
for (const file of tsxFiles.filter((path) => /\/src\/app\/.*\/?page\.tsx$/u.test(path.replaceAll("\\", "/")))) {
  const text = await readFile(file, "utf8");
  if (!/return\s*[(<]/u.test(text) || metadataExportPattern.test(text)) continue;
  const layoutPath = join(file, "..", "layout.tsx");
  const layoutText = await readFile(layoutPath, "utf8").catch(() => "");
  if (!metadataExportPattern.test(layoutText)) {
    failures.push(`${repoPath(file)} page title missing: export metadata from the page or its segment layout`);
  }
}

if (mainOwners.length !== 1 || !mainOwners[0]?.startsWith("src/app/layout.tsx:")) {
  failures.push(`main landmark owner must be src/app/layout.tsx only; found ${mainOwners.join(", ") || "none"}`);
}

const requiredRouteStates = [
  "src/app/dashboard/loading.tsx",
  "src/app/dashboard/error.tsx",
  "src/app/community/loading.tsx",
  "src/app/community/error.tsx",
];
for (const requiredPath of requiredRouteStates) {
  try {
    await access(join(repositoryRoot, requiredPath));
  } catch {
    failures.push(`required route state missing: ${requiredPath}`);
  }
}

if (failures.length > 0) {
  console.error("UI contract check: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`UI contract check: PASS (${tsxFiles.length} TSX files, one main owner, route states and page titles present)`);
}
