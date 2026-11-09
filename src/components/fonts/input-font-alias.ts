/**
 * @file src/components/fonts/input-font-alias.ts
 * @description 입력 영역 전용 글꼴 별칭. 본문 IBM Plex Sans KR은 새로고침 때 글꼴이 바뀌어 보이지 않도록
 * `font-display: block`이다. 그런데 한글은 unicode-range 조각을 처음 칠 때 받으므로, 입력칸까지 block이면 그 조각을
 * 받는 동안 입력 글자가 투명해져 깜빡인다. next/font로 같은 글꼴을 한 번 더 선언하면 family 이름이 같아(Turbopack 빌드)
 * 두 선언이 섞이고 본문까지 swap이 된다. 그래서 이미 선언된 @font-face의 같은 파일·같은 조각을 다른 이름
 * (`INPUT_FONT_FAMILY`)·swap으로 다시 등록한다. 파일 URL이 같아 HTTP cache를 같이 쓰고, 쓰이는 조각만 받는다.
 */

export const INPUT_FONT_FAMILY = "Portal Input Sans";
export const BODY_FONT_FAMILY = "IBM Plex Sans KR";

export type FontFaceSource = {
  family: string;
  src: string;
  style: string;
  weight: string;
  unicodeRange: string;
  /** src의 상대 주소를 풀 기준(그 stylesheet의 주소) */
  baseHref: string;
};

/** `url(../media/a.woff2) format("woff2")`의 상대 주소를 절대 주소로 바꾼다. */
export function absolutizeFontSrc(src: string, baseHref: string): string {
  return src.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (_match, _quote: string, path: string) => {
    try {
      return `url("${new URL(path, baseHref).href}")`;
    } catch {
      return `url("${path}")`;
    }
  });
}

/** 본문 글꼴 선언에서 입력 별칭으로 등록할 FontFace 생성 인자를 만든다. 다른 글꼴과 빈 src는 건너뛴다. */
export function inputAliasDescriptors(sources: readonly FontFaceSource[]) {
  return sources
    .filter((face) => face.family.replace(/["']/g, "").trim() === BODY_FONT_FAMILY && face.src.trim() !== "")
    .map((face) => ({
      src: absolutizeFontSrc(face.src, face.baseHref),
      descriptors: {
        style: face.style || "normal",
        weight: face.weight || "400",
        unicodeRange: face.unicodeRange || "U+0-10FFFF",
        display: "swap" as const,
      },
    }));
}

/** 문서의 같은 출처 stylesheet에서 @font-face 선언을 읽는다. 읽을 수 없는 sheet(다른 출처)는 건너뛴다. */
export function readFontFaceSources(doc: Document): FontFaceSource[] {
  const out: FontFaceSource[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const baseHref = sheet.href ?? doc.baseURI;
    for (const rule of Array.from(rules)) {
      const isFontFace = typeof CSSFontFaceRule !== "undefined" ? rule instanceof CSSFontFaceRule : rule.cssText.startsWith("@font-face");
      if (!isFontFace) continue;
      const style = (rule as CSSFontFaceRule).style;
      out.push({
        family: style.getPropertyValue("font-family"),
        src: style.getPropertyValue("src"),
        style: style.getPropertyValue("font-style"),
        weight: style.getPropertyValue("font-weight"),
        unicodeRange: style.getPropertyValue("unicode-range"),
        baseHref,
      });
    }
  }
  return out;
}

let registered = false;

/** 한 번만 입력 별칭을 document.fonts에 등록한다. 지원하지 않는 브라우저면 입력칸은 기기 글꼴을 쓴다. */
export function registerInputFontAlias(doc: Document = document): number {
  if (registered || typeof FontFace === "undefined" || !doc.fonts) return 0;
  const descriptors = inputAliasDescriptors(readFontFaceSources(doc));
  if (descriptors.length === 0) return 0;
  registered = true;
  for (const { src, descriptors: options } of descriptors) {
    try {
      doc.fonts.add(new FontFace(INPUT_FONT_FAMILY, src, options));
    } catch {
      // 한 조각이 잘못돼도 나머지는 등록한다.
    }
  }
  return descriptors.length;
}
