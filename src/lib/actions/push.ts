/**
 * @file src/lib/actions/push.ts
 * @description 이 기기의 웹 푸시 구독 등록·해제·테스트 서버 액션. 모두 본인 계정의 구독만 다룬다.
 */
"use server";

import { createDb } from "@/db/client";
import { requireAuth } from "@/lib/auth-guard";
import { readPushConfig } from "@/lib/push/config";
import { PUSH_CATEGORIES, pushMessages, type PushCategory } from "@/lib/push/messages";
import { sendWebPush } from "@/lib/push/send";
import {
  deletePushSubscription,
  findOwnPushTarget,
  readMutedPushCategories,
  readPushSubscriptionState,
  recordPushOutcome,
  setPushCategoryEnabled,
  upsertPushSubscription,
} from "@/lib/push/store";
import { parsePushSubscriptionInput } from "@/lib/push/subscription-input";

export type PushSetupState = {
  /** 서버에 발신 키가 없으면 null(알림 기능 꺼짐). 브라우저 구독의 applicationServerKey로 쓴다. */
  publicKey: string | null;
  /** 이 기기(endpoint)가 지금 계정으로 등록되어 있다. */
  registered: boolean;
  /** 이 계정에 등록된 기기 수. */
  deviceCount: number;
  /** 이 계정이 끈 알림 종류(모든 기기에 적용). */
  mutedCategories: PushCategory[];
};

function readEndpoint(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 ? value : null;
}

export async function getPushSetup(endpoint: string | null): Promise<PushSetupState> {
  const session = await requireAuth();
  const config = readPushConfig();
  if (!config) return { publicKey: null, registered: false, deviceCount: 0, mutedCategories: [] };
  const db = createDb();
  const [state, mutedCategories] = await Promise.all([
    readPushSubscriptionState(db, session.user.id, readEndpoint(endpoint)),
    readMutedPushCategories(db, session.user.id),
  ]);
  return { publicKey: config.publicKey, ...state, mutedCategories };
}

export type PushMutationResult = { ok: true } | { ok: false; error: string };

const SAVE_FAILED = "알림을 켜지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

export async function savePushSubscription(subscription: unknown): Promise<PushMutationResult> {
  const session = await requireAuth();
  if (!readPushConfig()) return { ok: false, error: "지금은 알림을 켤 수 없습니다. Stann에게 알려 주세요." };
  const target = parsePushSubscriptionInput(subscription);
  if (!target) return { ok: false, error: SAVE_FAILED };
  try {
    await upsertPushSubscription(createDb(), session.user.id, target);
    return { ok: true };
  } catch {
    return { ok: false, error: SAVE_FAILED };
  }
}

export async function removePushSubscription(endpoint: string): Promise<PushMutationResult> {
  const session = await requireAuth();
  const value = readEndpoint(endpoint);
  if (!value) return { ok: true };
  try {
    await deletePushSubscription(createDb(), session.user.id, value);
    return { ok: true };
  } catch {
    return { ok: false, error: "알림을 끄지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
}

export type TestPushResult = { ok: true } | { ok: false; error: string; unregistered?: boolean };

/** 이 기기로만 테스트 알림을 바로 보낸다(응답 뒤가 아니라 결과를 화면에 알려 주기 위해 기다린다). */
export async function sendTestPush(endpoint: string): Promise<TestPushResult> {
  const session = await requireAuth();
  const config = readPushConfig();
  const value = readEndpoint(endpoint);
  if (!config || !value) return { ok: false, error: "테스트 알림을 보내지 못했습니다." };
  const db = createDb();
  const target = await findOwnPushTarget(db, session.user.id, value);
  if (!target) return { ok: false, error: "이 기기가 등록되어 있지 않습니다. 알림을 다시 켜 주세요.", unregistered: true };
  const outcome = await sendWebPush(target, pushMessages.test(), config);
  await recordPushOutcome(db, target.id, outcome).catch(() => undefined);
  if (outcome === "sent") return { ok: true };
  if (outcome === "gone") return { ok: false, error: "이 기기의 알림 연결이 끊겼습니다. 알림을 다시 켜 주세요.", unregistered: true };
  return { ok: false, error: "테스트 알림을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
}

/** 본인 계정의 알림 종류 하나를 켜거나 끈다. 정해진 종류만 받는다. */
export async function setPushCategory(category: string, enabled: boolean): Promise<PushMutationResult> {
  const session = await requireAuth();
  if (!(PUSH_CATEGORIES as readonly string[]).includes(category) || typeof enabled !== "boolean") {
    return { ok: false, error: "알 수 없는 알림 종류입니다." };
  }
  try {
    await setPushCategoryEnabled(createDb(), session.user.id, category as PushCategory, enabled);
    return { ok: true };
  } catch {
    return { ok: false, error: "설정을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
}
