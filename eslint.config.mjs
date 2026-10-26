import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Next.js 16(eslint-config-next 16)이 새로 켠 React Compiler 기준 규칙이다.
    // 기존 코드 53곳(2026-10-26)이 걸려 업그레이드 범위에서는 경고로 남기고,
    // 컴포넌트별 정리는 후속 작업에서 하나씩 error로 되돌린다.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
    },
  },
  globalIgnores([
    "**/.worktrees/**",
    ".next/**",
    ".open-next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
