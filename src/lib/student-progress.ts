export type CurriculumProgressModule = {
  weekNum: number | null;
  title: string;
  isCompleted: boolean | null;
};

/** 캔버스 진도 표기: "WEEK 04 · 제목". */
export function formatModuleProgressLabel(weekNum: number | null, title: string): string {
  return `WEEK ${String(weekNum ?? 0).padStart(2, "0")} · ${title}`;
}

/** 0개와 전부 완료를 구분하는 roster 진행 문구 계약. */
export function getCurrentModuleLabel(modules: readonly CurriculumProgressModule[]): string {
  if (modules.length === 0) return "진도 미지정";
  const next = [...modules]
    .filter((module) => !module.isCompleted)
    .sort((a, b) => (a.weekNum ?? 0) - (b.weekNum ?? 0))[0];
  return next ? formatModuleProgressLabel(next.weekNum, next.title) : "모든 과정 완료";
}
