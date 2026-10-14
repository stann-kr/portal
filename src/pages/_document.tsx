import { Html, Head, Main, NextScript } from "next/document";

/**
 * Pages Router 기본 Document.
 * App Router와 공존 시 필수 — 없으면 Next.js 15에서 /_error 정적 생성 시
 * <Html> HtmlContext 미설정 오류 발생.
 */
export default function Document() {
  return (
    <Html lang="ko">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
