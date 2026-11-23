/**
 * @file src/lib/digging-day.ts
 * @description 디깅한 날(KST YYYY-MM-DD) 표시. 서버 화면(관리자 디깅·수강 종료 학생)과 클라이언트 화면이 함께 쓰므로
 * "use client" 파일 밖에 둔다(서버 컴포넌트는 클라이언트 파일의 함수를 부를 수 없다).
 */
import { formatKst, formatKstDot } from "@/lib/kst-format";

function kstMidnight(dugOn: string): Date {
  return new Date(`${dugOn}T00:00:00+09:00`);
}

/** "2026년 11월 23일 (월)" */
export function formatDiggingDay(dugOn: string): string {
  const date = kstMidnight(dugOn);
  return `${formatKst(date, { year: "numeric", month: "long", day: "numeric" })} (${formatKst(date, { weekday: "short" })})`;
}

/** 짧은 표시: "11.23 (월)". */
export function formatDugOn(dugOn: string, referenceTime?: Date): string {
  return formatKstDot(kstMidnight(dugOn), { weekday: true, referenceTime });
}
