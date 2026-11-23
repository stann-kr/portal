import assert from "node:assert/strict";
import test from "node:test";
import { resolveNoteParent } from "./NoteDocumentChrome";

test("노트를 연 화면(returnTo)에 맞춰 위치 줄 이름과 뒤로 이름을 정한다", () => {
  const names = (returnTo: string) => {
    const parent = resolveNoteParent(returnTo);
    return [parent.label, parent.backLabel, parent.href];
  };
  // 관리자 홈은 구역마다 다르다. 일정에서 연 노트를 "업무함"이라 부르지 않는다.
  assert.deepEqual(names("/dashboard/admin?section=schedule&view=calendar&student=s1"), ["일정", "일정으로", "/dashboard/admin?section=schedule&view=calendar&student=s1"]);
  assert.deepEqual(names("/dashboard/admin?section=students").slice(0, 2), ["학생", "학생 목록으로"]);
  assert.deepEqual(names("/dashboard/admin?section=work").slice(0, 2), ["업무함", "업무함으로"]);
  assert.deepEqual(names("/dashboard/admin").slice(0, 2), ["업무함", "업무함으로"]);
  // 가이드에서 담은 노트는 담은 문단 자리로 돌아간다.
  assert.deepEqual(names("/dashboard/guide/p1#b-7"), ["가이드", "가이드로", "/dashboard/guide/p1#b-7"]);
  assert.deepEqual(names("/dashboard/admin/students/s1?tab=notes").slice(0, 2), ["학생 상세", "학생 상세로"]);
  assert.deepEqual(names("/dashboard/student?section=workspace").slice(0, 2), ["캘린더", "캘린더로"]);
  // 새 노트·과제 내기 대상 고르기의 뒤로 이름도 연 화면을 따른다.
  assert.deepEqual(names("/dashboard/admin/assignments").slice(0, 2), ["과제", "과제로"]);
  assert.deepEqual(names("/dashboard/admin/notes?student=s1").slice(0, 2), ["노트", "노트 목록으로"]);
});
