/**
 * @file src/lib/actions/guideAccess.ts
 * @description 학생별 가이드 열람 권한을 Stann이 정하는 server action(학생 상세 · 개요의 "가이드" 구획).
 * 모든 action은 관리자 확인과 대상이 학생인지 확인을 먼저 한다. 판정 규칙은 src/lib/guide-access.ts에 있다.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDbContext } from "@/db/client";
import { requireStudentTarget } from "@/lib/auth-guard";
import {
  isGuideAccessSetting,
  readStudentGuideAccess,
  writeGuideAccessPage,
  writeGuideAccessSetting,
  type GuideAccessSetting,
} from "@/lib/guide-access";
import { parseGuidePageId } from "@/lib/guide-content";
import { listGuidePageSummaries } from "@/lib/guide-store";

/** 학생 상세에 보일 값: 지금 설정, 고른 페이지, 가이드 목차 순서의 전체 페이지. */
export type StudentGuideAccessView = {
  setting: GuideAccessSetting;
  pageIds: string[];
  pages: { id: string; title: string }[];
};

export type GuideAccessWriteResult = { ok: true } | { ok: false; error: string };

function revalidateGuideAccess(studentId: string): void {
  revalidatePath("/dashboard/guide", "layout");
  revalidatePath(`/dashboard/admin/students/${studentId}`);
}

export async function getStudentGuideAccess(studentId: string): Promise<StudentGuideAccessView> {
  const student = await requireStudentTarget(studentId);
  const context = createDbContext();
  const [access, pages] = await Promise.all([
    readStudentGuideAccess(context, student.id),
    listGuidePageSummaries(context),
  ]);
  const existing = new Set(pages.map((page) => page.id));
  return {
    setting: access.setting,
    pageIds: access.pageIds.filter((id) => existing.has(id)),
    pages: pages.map((page) => ({ id: page.id, title: page.title })),
  };
}

/** 닫힘·전체·선택을 저장한다. */
export async function setStudentGuideAccessSetting(
  studentId: string,
  setting: GuideAccessSetting,
): Promise<GuideAccessWriteResult> {
  const student = await requireStudentTarget(studentId);
  if (!isGuideAccessSetting(setting)) return { ok: false, error: "열람 설정을 다시 골라 주세요." };
  await writeGuideAccessSetting(createDbContext(), { studentId: student.id, setting, now: new Date() });
  revalidateGuideAccess(student.id);
  return { ok: true };
}

/** "선택"에서 페이지 하나를 열거나 닫는다. */
export async function setStudentGuideAccessPage(
  studentId: string,
  pageId: string,
  open: boolean,
): Promise<GuideAccessWriteResult> {
  const student = await requireStudentTarget(studentId);
  const id = parseGuidePageId(pageId);
  if (!id || typeof open !== "boolean") return { ok: false, error: "페이지를 다시 골라 주세요." };
  const context = createDbContext();
  if (open && !(await listGuidePageSummaries(context)).some((page) => page.id === id)) {
    return { ok: false, error: "가이드 페이지를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다." };
  }
  await writeGuideAccessPage(context, { studentId: student.id, pageId: id, open, now: new Date() });
  revalidateGuideAccess(student.id);
  return { ok: true };
}
