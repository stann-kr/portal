/**
 * @file src/lib/request-time.ts
 * @description 서버 컴포넌트가 한 요청 안에서 같은 기준 시각을 쓰게 하는 유틸.
 * 렌더 중 Date.now()를 직접 부르면 컴포넌트마다 시각이 달라질 수 있어 요청 단위로 한 번만 읽는다.
 */

import { cache } from "react";

export const getRequestNow = cache((): number => Date.now());
