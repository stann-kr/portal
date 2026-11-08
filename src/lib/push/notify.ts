import { createDb, type DrizzleDb } from "@/db/client";
import { runAfterResponse } from "@/lib/after-response";
import { readPushConfig } from "./config";
import type { PushMessage } from "./messages";
import { sendWebPush, type PushSendOutcome } from "./send";
import { listPushTargets, recordPushOutcome, type PushAudience, type StoredPushTarget } from "./store";
import type { VapidKeys } from "./web-push-crypto";

export type { PushAudience } from "./store";

export type PushDeliveryDeps = {
  readConfig: () => VapidKeys | null;
  listTargets: (audience: PushAudience, excludeProfileId?: string) => Promise<StoredPushTarget[]>;
  send: (target: StoredPushTarget, message: PushMessage, keys: VapidKeys) => Promise<PushSendOutcome>;
  record: (id: string, outcome: PushSendOutcome) => Promise<void>;
};

export type PushDeliverySummary = { sent: number; gone: number; failed: number };

function defaultDeps(): PushDeliveryDeps {
  let db: DrizzleDb | null = null;
  const database = () => (db ??= createDb());
  return {
    readConfig: () => readPushConfig(),
    listTargets: (audience, excludeProfileId) => listPushTargets(database(), audience, excludeProfileId),
    send: (target, message, keys) => sendWebPush(target, message, keys),
    record: (id, outcome) => recordPushOutcome(database(), id, outcome),
  };
}

/**
 * 받는 사람의 모든 기기로 보낸다. 키가 없으면(기능 꺼짐) DB를 읽지 않고 끝낸다.
 * 기기 하나의 실패가 다른 기기·저장 결과에 영향을 주지 않는다.
 */
export async function deliverPush(
  audience: PushAudience,
  message: PushMessage,
  options: { excludeProfileId?: string } = {},
  deps: PushDeliveryDeps = defaultDeps(),
): Promise<PushDeliverySummary> {
  const summary: PushDeliverySummary = { sent: 0, gone: 0, failed: 0 };
  const keys = deps.readConfig();
  if (!keys) return summary;
  const targets = await deps.listTargets(audience, options.excludeProfileId);
  await Promise.all(targets.map(async (target) => {
    const outcome = await deps.send(target, message, keys).catch((): PushSendOutcome => "failed");
    summary[outcome] += 1;
    await deps.record(target.id, outcome).catch(() => undefined);
  }));
  return summary;
}

/**
 * 저장이 끝난 action에서 부른다. 응답을 보낸 뒤 발송하며, 실패는 log만 남기고 action 결과를 바꾸지 않는다.
 * 보낸 사람 본인(excludeProfileId)은 받지 않는다.
 */
export async function notifyPush(
  audience: PushAudience,
  message: PushMessage,
  options: { excludeProfileId?: string } = {},
): Promise<void> {
  await runAfterResponse(async () => {
    try {
      const summary = await deliverPush(audience, message, options);
      if (summary.sent + summary.gone + summary.failed === 0) return;
      const tag = message.tag?.split(":")[0] ?? "message";
      const line = JSON.stringify({ event: "push_delivery", kind: tag, ...summary });
      if (summary.failed > 0) console.warn(line);
      else console.log(line);
    } catch {
      console.error(JSON.stringify({ event: "push_delivery", outcome: "error" }));
    }
  }).catch(() => undefined);
}
