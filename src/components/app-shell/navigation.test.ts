import assert from "node:assert/strict";
import test from "node:test";
import { APP_NAV_ITEMS, resolveActiveNavItem, resolveMobileTopBar } from "./navigation";

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

test("커리큘럼이 숨겨져 있으면 학생 메뉴에 없고 예전 커리큘럼 주소는 캘린더로 표시한다", () => {
  assert.equal(APP_NAV_ITEMS.student.some((item) => item.id === "curriculum"), false);
  const curriculumUrl = at("/dashboard/student?section=workspace&view=curriculum");
  assert.equal(resolveActiveNavItem("student", curriculumUrl), "calendar");
  assert.equal(resolveMobileTopBar("student", curriculumUrl).title, "캘린더");
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
  assert.deepEqual(resolveMobileTopBar("student", at("/dashboard/student?section=workspace&view=daily")).action, {
    href: "/dashboard/student?section=workspace&view=daily&create=today",
    label: "새로 만들기",
  });
  assert.equal(
    resolveMobileTopBar("student", at("/dashboard/student?section=today")).action?.href,
    "/dashboard/student?section=workspace&create=today",
  );
  assert.equal(
    resolveMobileTopBar("admin", at("/dashboard/admin?section=schedule&student=s2&create=lesson")).action?.href,
    "/dashboard/admin?section=schedule&student=s2&create=lesson",
  );
  assert.deepEqual(resolveMobileTopBar("student", at("/dashboard/notes/n1")).back, { href: "/dashboard/student/notes", label: "노트 목록으로" });
  assert.equal(resolveMobileTopBar("student", at("/dashboard/qna/new")).title, "새 질문 작성");
  assert.equal(resolveMobileTopBar("admin", at("/dashboard/qna")).action, undefined);
  assert.equal(resolveMobileTopBar("admin", at("/dashboard/admin?section=students")).action?.href, "/dashboard/admin/students/new");
  assert.equal(resolveMobileTopBar("admin", at("/dashboard/admin/students/s1")).back?.label, "학생 목록으로");
});

test("가이드는 학생·관리자 메뉴에 같은 주소로 있고 페이지·편집 화면도 가이드 메뉴로 표시한다", () => {
  for (const role of ["student", "admin"] as const) {
    const guide = APP_NAV_ITEMS[role].find((item) => item.id === "guide");
    assert.equal(guide?.label, "가이드");
    assert.equal(guide?.href, "/dashboard/guide");
    assert.equal(resolveActiveNavItem(role, at("/dashboard/guide")), "guide");
    assert.equal(resolveActiveNavItem(role, at("/dashboard/guide/guide-1")), "guide");
    assert.equal(resolveMobileTopBar(role, at("/dashboard/guide/guide-1")).title, "가이드");
  }
  assert.equal(resolveActiveNavItem("student", at("/dashboard/guidebook")), null);
  assert.deepEqual(resolveMobileTopBar("admin", at("/dashboard/guide/guide-1/edit")), {
    title: "가이드 편집",
    back: { href: "/dashboard/guide/guide-1", label: "가이드로 돌아가기" },
  });
});
