import type { AppProps } from "next/app";

/**
 * Pages Router 기본 App.
 * App Router와 공존 시 Pages Router 렌더링 컨텍스트 설정에 필요.
 */
export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
