import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTaskItemsHtml } from "./task-item-html";
import { sanitizeHtml } from "./sanitize-html";

test("label 없는 체크 항목에 편집기와 같은 칸 구조를 보충한다", () => {
  const html =
    '<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><p>켜기</p></li>' +
    '<li data-checked="true" data-type="taskItem"><p>끄기</p><p>둘째 문단</p></li></ul>';
  assert.equal(
    normalizeTaskItemsHtml(html),
    '<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><span></span></label><div><p>켜기</p></div></li>' +
      '<li data-checked="true" data-type="taskItem"><label><span></span></label><div><p>끄기</p><p>둘째 문단</p></div></li></ul>',
  );
});

test("편집기가 만든 체크 항목과 체크 항목이 없는 글은 그대로 둔다", () => {
  const editorHtml = sanitizeHtml(
    '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>한 것</p></div></li></ul>',
  );
  assert.equal(normalizeTaskItemsHtml(editorHtml), editorHtml);
  const plain = "<ul><li><p>보통 목록</p></li></ul><p>본문</p>";
  assert.equal(normalizeTaskItemsHtml(plain), plain);
});

test("체크 항목 안에 든 하위 목록도 하나의 내용 칸에 함께 넣는다", () => {
  const html =
    '<ul data-type="taskList"><li data-checked="false" data-type="taskItem">글자만<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><p>안쪽</p></li></ul></li></ul>';
  assert.equal(
    normalizeTaskItemsHtml(html),
    '<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><span></span></label><div>글자만<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><span></span></label><div><p>안쪽</p></div></li></ul></div></li></ul>',
  );
});

test("보충한 결과는 다시 정화해도 그대로라 읽기 화면에 정화 밖의 표식을 더하지 않는다", () => {
  const html = sanitizeHtml(
    '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><p>가져온 항목</p></li></ul>',
  );
  const normalized = normalizeTaskItemsHtml(html);
  assert.notEqual(normalized, html);
  assert.equal(sanitizeHtml(normalized), normalized);
});
