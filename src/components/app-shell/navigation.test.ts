import assert from "node:assert/strict";
import test from "node:test";
import { resolveActiveNavItem, resolveMobileTopBar } from "./navigation";

const at = (url: string) => {
  const parsed = new URL(url, "http://portal.test");
  return { pathname: parsed.pathname, searchParams: parsed.searchParams };
};

test("학생 사이드바는 워크스페이스 보기와 상세 화면을 상위 메뉴로 표시한다", () => {
  assert.equal(resolveActiveNavItem("student", at("/dashboard/student")), "today");
  assert.equal(resolveActiveNavItem("student", at("/dashboard/student?section=workspace&view=daily")), "calendar");
  assert.equal(resolveActiveNavItem("student", at("/dashboard/student?section=workspace&view=assignments")), "assignments");
  assert.equal(resolveActiveNavItem("student", at("/dashboard/notes/n1")), "notes");
  assert.equal(resolveActiveNavItem("student", at("/dashboard/qna/t1/history")), "qna");
  assert.equal(resolveActiveNavItem("student", at("/community/p1")), "community");
});

test("관리자 사이드바는 학생별 화면을 학생 메뉴로, 분류 관리를 운영 도구로 표시한다", () => {
  assert.equal(resolveActiveNavItem("admin", at("/dashboard/admin?section=schedule")), "schedule");
  assert.equal(resolveActiveNavItem("admin", at("/dashboard/admin/students/s1?tab=notes")), "students");
  assert.equal(resolveActiveNavItem("admin", at("/dashboard/admin/categories")), "operations");
});

test("좁은 화면 위쪽 막대는 목록 화면에 메뉴와 주 행동, 상세 화면에 뒤로 가기를 둔다", () => {
  assert.deepEqual(resolveMobileTopBar("student", at("/dashboard/student/notes")), {
    title: "노트",
    action: { href: "/dashboard/student/notes/new", label: "새 노트" },
  });
  assert.equal(resolveMobileTopBar("student", at("/dashboard/student?section=workspace&view=daily")).action?.label, "새로 만들기");
  assert.deepEqual(resolveMobileTopBar("student", at("/dashboard/notes/n1")).back, { href: "/dashboard/student/notes", label: "노트 목록으로" });
  assert.equal(resolveMobileTopBar("student", at("/dashboard/qna/new")).title, "새 질문 작성");
  assert.equal(resolveMobileTopBar("admin", at("/dashboard/qna")).action, undefined);
  assert.equal(resolveMobileTopBar("admin", at("/dashboard/admin?section=students")).action?.href, "/dashboard/admin/students/new");
  assert.equal(resolveMobileTopBar("admin", at("/dashboard/admin/students/s1")).back?.label, "학생 목록으로");
});
