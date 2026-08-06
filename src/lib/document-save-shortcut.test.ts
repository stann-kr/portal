import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_SAVE_SHORTCUT_IGNORED_SELECTOR,
  DOCUMENT_SAVE_SHORTCUT_LOCK_MS,
  createDocumentSaveShortcutController,
  type DocumentSaveShortcutEvent,
} from "./hooks/useDocumentSaveShortcut";

type TestEvent = {
  event: DocumentSaveShortcutEvent;
  isDefaultPrevented: () => boolean;
};

type ScheduledUnlock = {
  callback: () => void;
  cancelled: boolean;
  delayMs: number;
};

function createTestEvent(
  overrides: Partial<DocumentSaveShortcutEvent> = {},
): TestEvent {
  let defaultPrevented = false;
  const event: DocumentSaveShortcutEvent = {
    altKey: false,
    ctrlKey: true,
    key: "s",
    metaKey: false,
    nativeEvent: { isComposing: false },
    preventDefault: () => {
      defaultPrevented = true;
    },
    repeat: false,
    target: null,
    ...overrides,
  };

  return {
    event,
    isDefaultPrevented: () => defaultPrevented,
  };
}

function createUnlockScheduler(scheduled: ScheduledUnlock[]) {
  return (callback: () => void, delayMs: number) => {
    const entry: ScheduledUnlock = { callback, cancelled: false, delayMs };
    scheduled.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
      },
    };
  };
}

test("Cmd/Ctrl+S만 가로채고 유효한 단축키는 onSave를 호출한다", () => {
  let saveCount = 0;
  const scheduled: ScheduledUnlock[] = [];
  const controller = createDocumentSaveShortcutController({
    isDisabled: () => false,
    onSave: () => {
      saveCount += 1;
    },
    scheduleUnlock: createUnlockScheduler(scheduled),
  });

  const plainS = createTestEvent({ ctrlKey: false });
  controller.handleKeyDown(plainS.event);
  assert.equal(plainS.isDefaultPrevented(), false);

  const otherShortcut = createTestEvent({ key: "p" });
  controller.handleKeyDown(otherShortcut.event);
  assert.equal(otherShortcut.isDefaultPrevented(), false);

  const commandUppercaseS = createTestEvent({
    ctrlKey: false,
    key: "S",
    metaKey: true,
  });
  controller.handleKeyDown(commandUppercaseS.event);

  assert.equal(commandUppercaseS.isDefaultPrevented(), true);
  assert.equal(saveCount, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.delayMs, DOCUMENT_SAVE_SHORTCUT_LOCK_MS);
});

test("저장 불가 조건에서도 Save Page는 막고 onSave는 호출하지 않는다", () => {
  const cases: Array<{
    disabled?: boolean;
    event: Partial<DocumentSaveShortcutEvent>;
    name: string;
  }> = [
    { name: "disabled", disabled: true, event: {} },
    { name: "repeat", event: { repeat: true } },
    { name: "synthetic composing", event: { isComposing: true } },
    {
      name: "native composing",
      event: { nativeEvent: { isComposing: true } },
    },
    { name: "Alt modifier", event: { altKey: true } },
    {
      name: "editor insert panel target",
      event: {
        target: {
          closest: (selector: string) => {
            assert.equal(selector, DOCUMENT_SAVE_SHORTCUT_IGNORED_SELECTOR);
            return {};
          },
        },
      },
    },
  ];

  for (const currentCase of cases) {
    let saveCount = 0;
    const scheduled: ScheduledUnlock[] = [];
    const controller = createDocumentSaveShortcutController({
      isDisabled: () => currentCase.disabled ?? false,
      onSave: () => {
        saveCount += 1;
      },
      scheduleUnlock: createUnlockScheduler(scheduled),
    });
    const shortcut = createTestEvent(currentCase.event);

    controller.handleKeyDown(shortcut.event);

    assert.equal(
      shortcut.isDefaultPrevented(),
      true,
      `${currentCase.name}: browser Save Page 차단`,
    );
    assert.equal(saveCount, 0, `${currentCase.name}: onSave 미호출`);
    assert.equal(scheduled.length, 0, `${currentCase.name}: lock 미획득`);
  }
});

test("첫 저장 전에 1초 lock을 획득해 이중 제출과 재진입을 막는다", () => {
  let saveCount = 0;
  const scheduled: ScheduledUnlock[] = [];
  const controller = createDocumentSaveShortcutController({
    isDisabled: () => false,
    onSave: () => {
      saveCount += 1;
      controller.handleKeyDown(createTestEvent().event);
    },
    scheduleUnlock: createUnlockScheduler(scheduled),
  });

  const first = createTestEvent();
  controller.handleKeyDown(first.event);
  const immediateRetry = createTestEvent();
  controller.handleKeyDown(immediateRetry.event);

  assert.equal(first.isDefaultPrevented(), true);
  assert.equal(immediateRetry.isDefaultPrevented(), true);
  assert.equal(saveCount, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.delayMs, 1_000);

  scheduled[0]?.callback();
  controller.handleKeyDown(createTestEvent().event);
  assert.equal(saveCount, 2);
});

test("dispose는 남은 unlock timer를 취소한다", () => {
  const scheduled: ScheduledUnlock[] = [];
  const controller = createDocumentSaveShortcutController({
    isDisabled: () => false,
    onSave: () => undefined,
    scheduleUnlock: createUnlockScheduler(scheduled),
  });

  controller.handleKeyDown(createTestEvent().event);
  controller.dispose();

  assert.equal(scheduled[0]?.cancelled, true);
});
