import type { NextConfig } from "next";

/**
 * @file next.config.ts
 * @description Next.js 설정 파일.
 * OpenNext(@opennextjs/cloudflare)로 전환하여 로컬 개발 환경에서도
 * Cloudflare D1 바인딩은 wrangler dev가 자동으로 처리합니다.
 *
 * 참고: @cloudflare/next-on-pages는 제거되었으므로 setupDevPlatform() 호출 불필요.
 * 로컬 D1 접근은 `.wrangler/state/v3/d1`의 SQLite 파일을 통해 이루어집니다.
 */

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "bcryptjs"],
  // ESLint flat config(eslint.config.mjs) 설정 문제로 빌드 시 임시 비활성화
  // 별도 `npm run lint` 스크립트로 로컬에서 수동 실행
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
