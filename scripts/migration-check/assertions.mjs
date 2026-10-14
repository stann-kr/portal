

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function stringifyRows(rows) {
  return JSON.stringify(rows);
}

export function assertRowsEqual(label, actual, expected) {
  if (stringifyRows(actual) !== stringifyRows(expected)) {
    const differenceIndex = Array.from(
      { length: Math.max(actual.length, expected.length) },
      (_, index) => index,
    ).find((index) => stringifyRows(actual[index]) !== stringifyRows(expected[index]));

    throw new Error(
      `${label} 불일치 (index ${differenceIndex}, actual ${actual.length}개, expected ${expected.length}개)` +
        `\nactual=${JSON.stringify(actual[differenceIndex], null, 2)}` +
        `\nexpected=${JSON.stringify(expected[differenceIndex], null, 2)}`,
    );
  }
}

export function assertSqlFails(database, sql, label, expectedMessage) {
  let failure = null;
  try {
    database.exec(sql);
  } catch (error) {
    failure = error;
  }

  assert(failure, `${label}: 실패해야 하는 SQL이 성공했습니다.`);
  if (expectedMessage) {
    const message = failure instanceof Error ? failure.message : String(failure);
    assert(
      message.includes(expectedMessage),
      `${label}: 예상 오류 ${expectedMessage}를 찾지 못했습니다. actual=${message}`,
    );
  }
}
