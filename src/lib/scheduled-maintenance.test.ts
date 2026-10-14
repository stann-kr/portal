import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  runScheduledMaintenance,
  serializeScheduledMaintenanceReport,
  type ScheduledMaintenanceOperations,
} from "./scheduled-maintenance";

const NOW = new Date("2026-08-10T00:00:00.000Z");

function operations(
  overrides: Partial<ScheduledMaintenanceOperations> = {},
): ScheduledMaintenanceOperations {
  return {
    async processAccount() {
      return { processed: 1, skipped: 0, failed: 0 };
    },
    async enqueueExpiredMedia() {},
    async processMedia() {
      return { completed: 2, failed: 0 };
    },
    async reconcileMedia() {
      return {
        inspected: 3,
        deleted: 1,
        preserved: 2,
        invalid: 0,
        failed: 0,
        cycleCompleted: true,
        budgetExhausted: false,
      };
    },
    async readBacklog() {
      return {
        accountDue: 0,
        mediaPending: 0,
        mediaDue: 0,
        mediaRetrying: 0,
      };
    },
    ...overrides,
  };
}

test("scheduled maintenance는 account→enqueue→delete→metrics를 순차 실행한다", async () => {
  const order: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const step = async <T>(name: string, value: T): Promise<T> => {
    order.push(name);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    return value;
  };
  const report = await runScheduledMaintenance(
    operations({
      processAccount: () =>
        step("account", { processed: 1, skipped: 0, failed: 0 }),
      enqueueExpiredMedia: () => step("enqueue", undefined),
      processMedia: () => step("delete", { completed: 2, failed: 0 }),
      reconcileMedia: () =>
        step("reconcile", {
          inspected: 3,
          deleted: 1,
          preserved: 2,
          invalid: 0,
          failed: 0,
          cycleCompleted: true,
          budgetExhausted: false,
        }),
      readBacklog: () =>
        step("metrics", {
          accountDue: 0,
          mediaPending: 0,
          mediaDue: 0,
          mediaRetrying: 0,
        }),
    }),
    { now: NOW, scheduledAt: NOW, clock: () => 0 },
  );

  assert.deepEqual(order, ["account", "enqueue", "delete", "reconcile", "metrics"]);
  assert.equal(maxInFlight, 1);
  assert.equal(report.outcome, "ok");
  assert.equal(report.account.processed, 1);
  assert.equal(report.media.completed, 2);
});

test("한 lane 실패가 뒤 lane을 막지 않고 민감한 error 내용은 report에 넣지 않는다", async () => {
  const sensitive = [
    "student@example.com",
    "media/qna-attachment/00000000-0000-4000-8000-000000000001",
    "a".repeat(64),
  ];
  const calls: string[] = [];
  const report = await runScheduledMaintenance(
    operations({
      async processAccount() {
        calls.push("account");
        throw new Error(sensitive.join(" "));
      },
      async enqueueExpiredMedia() {
        calls.push("enqueue");
        throw new Error(sensitive.join(" "));
      },
      async processMedia() {
        calls.push("delete");
        return { completed: 1, failed: 0 };
      },
      async reconcileMedia() {
        calls.push("reconcile");
        return {
          inspected: 0,
          deleted: 0,
          preserved: 0,
          invalid: 0,
          failed: 0,
          cycleCompleted: true,
          budgetExhausted: false,
        };
      },
      async readBacklog() {
        calls.push("metrics");
        return {
          accountDue: 1,
          mediaPending: 2,
          mediaDue: 1,
          mediaRetrying: 1,
        };
      },
    }),
    { now: NOW, scheduledAt: NOW, clock: () => 0 },
  );

  assert.deepEqual(calls, ["account", "enqueue", "delete", "reconcile", "metrics"]);
  assert.equal(report.outcome, "partial_failure");
  const serialized = serializeScheduledMaintenanceReport(report);
  for (const marker of sensitive) assert.doesNotMatch(serialized, new RegExp(marker, "u"));
  assert.deepEqual(Object.keys(report).sort(), [
    "account",
    "budgetExhausted",
    "durationMs",
    "event",
    "media",
    "metricsStatus",
    "outcome",
    "scheduledAt",
    "version",
  ]);
});

test("soft budget은 진행 중 unit을 취소하지 않고 다음 unit claim을 멈춘다", async () => {
  let elapsed = 0;
  const calls: string[] = [];
  const report = await runScheduledMaintenance(
    operations({
      async processAccount() {
        calls.push("account");
        elapsed = 30_000;
        return { processed: 1, skipped: 0, failed: 0 };
      },
      async enqueueExpiredMedia() {
        calls.push("enqueue");
      },
      async processMedia() {
        calls.push("delete");
        return { completed: 0, failed: 0 };
      },
      async readBacklog() {
        calls.push("metrics");
        return {
          accountDue: 0,
          mediaPending: 0,
          mediaDue: 0,
          mediaRetrying: 0,
        };
      },
    }),
    { now: NOW, scheduledAt: NOW, clock: () => elapsed },
  );

  assert.deepEqual(calls, ["account"]);
  assert.equal(report.outcome, "budget_exhausted");
  assert.equal(report.budgetExhausted, true);
  assert.equal(report.media.enqueueStatus, "skipped_budget");
});

test("durable retry와 남은 backlog는 invocation 실패가 아니라 retry outcome이다", async () => {
  const report = await runScheduledMaintenance(
    operations({
      async processMedia() {
        return { completed: 0, failed: 1 };
      },
      async readBacklog() {
        return {
          accountDue: 0,
          mediaPending: 3,
          mediaDue: 0,
          mediaRetrying: 1,
        };
      },
    }),
    { now: NOW, scheduledAt: NOW, clock: () => 0 },
  );
  assert.equal(report.outcome, "retry");
  assert.equal(report.media.pendingAfter, 3);
  assert.equal(report.media.retryingAfter, 1);
});

test("아직 실행 시각이 오지 않은 outbox는 metric에 남기되 경고 outcome을 만들지 않는다", async () => {
  const report = await runScheduledMaintenance(
    operations({
      async readBacklog() {
        return {
          accountDue: 0,
          mediaPending: 3,
          mediaDue: 0,
          mediaRetrying: 0,
        };
      },
    }),
    { now: NOW, scheduledAt: NOW, clock: () => 0 },
  );

  assert.equal(report.outcome, "ok");
  assert.equal(report.media.pendingAfter, 3);
});

test("scheduled target config는 custom entry를 쓰되 Cron과 route를 활성화하지 않는다", () => {
  const config = readFileSync("wrangler.scheduled.toml", "utf8");
  assert.match(config, /^main = "worker\.ts"$/mu);
  assert.match(config, /^binding = "DB"$/mu);
  assert.match(config, /^binding = "BUCKET"$/mu);
  assert.doesNotMatch(config, /^\[triggers\]$/mu);
  assert.doesNotMatch(config, /^\[\[routes\]\]$/mu);
});
