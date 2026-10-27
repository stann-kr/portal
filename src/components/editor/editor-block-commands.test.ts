import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_SLASH_COMMAND_MAX_QUERY_LENGTH,
  filterEditorBlockCommands,
  findSlashCommandMatch,
  type EditorBlockCommand,
} from "./editor-block-commands";

type SlashMatcherEditor = Parameters<typeof findSlashCommandMatch>[0];

function createSlashMatcherEditor({
  parentOffset,
  selectionFrom,
  textBetween,
}: {
  parentOffset: number;
  selectionFrom: number;
  textBetween: (from: number, to: number) => string;
}): SlashMatcherEditor {
  return {
    state: {
      selection: {
        empty: true,
        from: selectionFrom,
        $from: {
          parentOffset,
          parent: {
            isTextblock: true,
            type: { name: "paragraph" },
            textBetween,
          },
        },
      },
    },
  } as unknown as SlashMatcherEditor;
}

test("슬래시 명령은 한글·영문 별칭으로 검색된다", () => {
  assert.deepEqual(filterEditorBlockCommands("체크").map((item) => item.id), ["task-list"]);
  assert.deepEqual(filterEditorBlockCommands("h2").map((item) => item.id), ["heading-2"]);
});

test("이미지·동영상·링크 명령은 편집기 밖 패널을 열 수 있는 편집기에서만 보인다", () => {
  const ids = (withContext: boolean) => filterEditorBlockCommands("", { withContext }).map((item) => item.id);
  for (const id of ["image-upload", "image-url", "youtube", "link"]) {
    assert.equal(ids(false).includes(id), false, `${id}는 context 없이 숨긴다`);
    assert.equal(ids(true).includes(id), true, `${id}는 문서 페이지 편집기에서 보인다`);
  }
  assert.deepEqual(filterEditorBlockCommands("유튜브", { withContext: true }).map((item) => item.id), ["youtube"]);
  assert.deepEqual(filterEditorBlockCommands("가운데").map((item) => item.id), ["align-center"]);
  const opened: string[] = [];
  const context = { pickImages: () => opened.push("pick"), openInsertPanel: (kind: string) => opened.push(kind) };
  const editor = {} as Parameters<EditorBlockCommand["run"]>[0];
  for (const id of ["image-upload", "image-url", "youtube", "link"]) {
    filterEditorBlockCommands("", { withContext: true }).find((item) => item.id === id)!.run(editor, context);
  }
  assert.deepEqual(opened, ["pick", "image", "youtube", "link"]);
});

test("빈 검색어는 모든 블록 명령을 유지한다", () => {
  const commands = filterEditorBlockCommands("");
  assert.ok(commands.length >= 10);
  assert.equal(new Set(commands.map((item) => item.id)).size, commands.length);
});

test("긴 문단에서도 슬래시 명령은 직전 경계 문자를 포함한 고정 범위만 읽는다", () => {
  const parentOffset = 1_000_000;
  const selectionFrom = 1_000_100;
  const query = "가".repeat(EDITOR_SLASH_COMMAND_MAX_QUERY_LENGTH);
  let observedRange: { from: number; to: number } | null = null;
  const editor = createSlashMatcherEditor({
    parentOffset,
    selectionFrom,
    textBetween: (from, to) => {
      observedRange = { from, to };
      return ` /${query}`;
    },
  });

  assert.deepEqual(findSlashCommandMatch(editor), {
    from: selectionFrom - query.length - 1,
    to: selectionFrom,
    query,
  });
  assert.deepEqual(observedRange, {
    from: parentOffset - EDITOR_SLASH_COMMAND_MAX_QUERY_LENGTH - 2,
    to: parentOffset,
  });
});

test("최대 길이를 넘는 슬래시 검색어는 경계가 잘려도 명령으로 오인하지 않는다", () => {
  const parentOffset = 1_000_000;
  let observedRange: { from: number; to: number } | null = null;
  const overlongQuery = "a".repeat(EDITOR_SLASH_COMMAND_MAX_QUERY_LENGTH + 1);
  const editor = createSlashMatcherEditor({
    parentOffset,
    selectionFrom: parentOffset + 100,
    textBetween: (from, to) => {
      observedRange = { from, to };
      // 실제 공백은 scan 범위 바로 앞에 있고, 범위 안에는 `/`부터만 들어오는 경계다.
      return `/${overlongQuery}`;
    },
  });

  assert.equal(findSlashCommandMatch(editor), null);
  assert.deepEqual(observedRange, {
    from: parentOffset - EDITOR_SLASH_COMMAND_MAX_QUERY_LENGTH - 2,
    to: parentOffset,
  });
});

test("허용 길이의 슬래시 앞 문자가 공백이 아니면 scan 시작 경계에서도 매치하지 않는다", () => {
  const query = "a".repeat(EDITOR_SLASH_COMMAND_MAX_QUERY_LENGTH);
  const editor = createSlashMatcherEditor({
    parentOffset: 10_000,
    selectionFrom: 10_100,
    textBetween: () => `x/${query}`,
  });

  assert.equal(findSlashCommandMatch(editor), null);
});
