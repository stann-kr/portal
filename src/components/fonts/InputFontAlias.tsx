"use client";

/**
 * @file src/components/fonts/InputFontAlias.tsx
 * @description 루트 layout에 한 번 둔다. 첫 렌더 뒤 입력 영역 전용 글꼴 별칭을 등록한다(input-font-alias.ts).
 */
import { useEffect } from "react";
import { registerInputFontAlias } from "./input-font-alias";

export function InputFontAlias() {
  useEffect(() => {
    registerInputFontAlias();
  }, []);
  return null;
}
