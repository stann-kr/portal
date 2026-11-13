/**
 * 학생별 가이드 열람 권한. 가이드를 읽는 모든 경로(목차·본문·질문 위치·이미지·질문 만들기·메뉴)가 이 판정 하나를 쓴다.
 * 관리자는 항상 전체를 본다. 학생은 guide_access 행이 없으면 닫힘, ALL이면 전체, SELECTED면 guide_access_pages의 페이지만 본다.
 * 관리자 권한 검사는 호출하는 server action이 먼저 한다.
 */
import { and, eq } from "drizzle-orm";
import type { DbContext } from "@/db/client";
import { guideAccess, guideAccessPages, type GuideAccessMode } from "@/db/schema";
import { asDocumentReadDb } from "@/lib/document-lifecycle-atomic";

/** 관리자가 고르는 세 칸: 닫힘·전체·선택. */
export type GuideAccessSetting = "CLOSED" | GuideAccessMode;
export const GUIDE_ACCESS_SETTINGS: readonly GuideAccessSetting[] = ["CLOSED", "ALL", "SELECTED"];

/** 학생 한 명의 설정. pageIds는 "선택"에서 고른 페이지이며 닫힘·전체일 때도 남아 있다. */
export type StudentGuideAccess = { setting: GuideAccessSetting; pageIds: string[] };

/** 보는 사람 기준의 열람 범위. */
export type GuideViewerAccess =
  | { kind: "all" }
  | { kind: "selected"; pageIds: ReadonlySet<string> }
  | { kind: "closed" };

export type GuideViewer = { id: string; isAdmin: boolean };

export function isGuideAccessSetting(value: unknown): value is GuideAccessSetting {
  return typeof value === "string" && (GUIDE_ACCESS_SETTINGS as readonly string[]).includes(value);
}

export async function readStudentGuideAccess(context: DbContext, studentId: string): Promise<StudentGuideAccess> {
  const db = asDocumentReadDb(context);
  const [[row], pages] = await Promise.all([
    db.select({ mode: guideAccess.mode }).from(guideAccess).where(eq(guideAccess.studentId, studentId)).limit(1),
    db.select({ pageId: guideAccessPages.guidePageId }).from(guideAccessPages).where(eq(guideAccessPages.studentId, studentId)),
  ]);
  return { setting: row?.mode ?? "CLOSED", pageIds: pages.map((page) => page.pageId) };
}

/** 보는 사람이 볼 수 있는 범위. "선택"인데 고른 페이지가 없으면 닫힘과 같다. */
export async function resolveGuideViewerAccess(context: DbContext, viewer: GuideViewer): Promise<GuideViewerAccess> {
  if (viewer.isAdmin) return { kind: "all" };
  const access = await readStudentGuideAccess(context, viewer.id);
  if (access.setting === "ALL") return { kind: "all" };
  if (access.setting === "SELECTED" && access.pageIds.length > 0) {
    return { kind: "selected", pageIds: new Set(access.pageIds) };
  }
  return { kind: "closed" };
}

export function canViewGuidePage(access: GuideViewerAccess, pageId: string): boolean {
  return access.kind === "all" || (access.kind === "selected" && access.pageIds.has(pageId));
}

/** 닫힘·전체·선택을 저장한다. 닫힘은 행을 지우고, 고른 페이지 목록은 건드리지 않는다. */
export async function writeGuideAccessSetting(
  context: DbContext,
  input: { studentId: string; setting: GuideAccessSetting; now: Date },
): Promise<void> {
  const db = asDocumentReadDb(context);
  if (input.setting === "CLOSED") {
    await db.delete(guideAccess).where(eq(guideAccess.studentId, input.studentId));
    return;
  }
  await db
    .insert(guideAccess)
    .values({ studentId: input.studentId, mode: input.setting, updatedAt: input.now })
    .onConflictDoUpdate({ target: guideAccess.studentId, set: { mode: input.setting, updatedAt: input.now } });
}

/** "선택"에서 페이지 하나를 열거나 닫는다. 같은 요청을 다시 보내도 결과가 같다. */
export async function writeGuideAccessPage(
  context: DbContext,
  input: { studentId: string; pageId: string; open: boolean; now: Date },
): Promise<void> {
  const db = asDocumentReadDb(context);
  if (input.open) {
    await db
      .insert(guideAccessPages)
      .values({ studentId: input.studentId, guidePageId: input.pageId, createdAt: input.now })
      .onConflictDoNothing();
    return;
  }
  await db
    .delete(guideAccessPages)
    .where(and(eq(guideAccessPages.studentId, input.studentId), eq(guideAccessPages.guidePageId, input.pageId)));
}

/** 가이드 페이지 하나를 기준으로 본 학생 한 명. openCount는 "선택"에서 고른(지금 있는) 페이지 수다. */
export type GuidePageViewer = {
  studentId: string;
  name: string;
  setting: GuideAccessSetting;
  canView: boolean;
  openCount: number;
};

/**
 * 페이지 하나의 열람 학생 목록(관리자 전용 화면용, 권한 검사는 호출하는 action이 한다).
 * 학생 순서는 학생 목록과 같게 이름순이다. 판정은 resolveGuideViewerAccess와 같다.
 */
export async function listGuidePageViewers(
  context: DbContext,
  input: {
    pageId: string;
    existingPageIds: ReadonlySet<string>;
    students: readonly { id: string; displayName: string | null; email: string }[];
  },
): Promise<GuidePageViewer[]> {
  const db = asDocumentReadDb(context);
  const [modes, pages] = await Promise.all([
    db.select({ studentId: guideAccess.studentId, mode: guideAccess.mode }).from(guideAccess),
    db.select({ studentId: guideAccessPages.studentId, pageId: guideAccessPages.guidePageId }).from(guideAccessPages),
  ]);
  const modeByStudent = new Map(modes.map((row) => [row.studentId, row.mode]));
  const pagesByStudent = new Map<string, Set<string>>();
  for (const row of pages) {
    if (!input.existingPageIds.has(row.pageId)) continue;
    const set = pagesByStudent.get(row.studentId) ?? new Set<string>();
    set.add(row.pageId);
    pagesByStudent.set(row.studentId, set);
  }
  return input.students
    .map((student) => {
      const setting: GuideAccessSetting = modeByStudent.get(student.id) ?? "CLOSED";
      const selected = pagesByStudent.get(student.id) ?? new Set<string>();
      return {
        studentId: student.id,
        name: student.displayName?.trim() || student.email,
        setting,
        canView: setting === "ALL" || (setting === "SELECTED" && selected.has(input.pageId)),
        openCount: selected.size,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko-KR") || a.studentId.localeCompare(b.studentId));
}
