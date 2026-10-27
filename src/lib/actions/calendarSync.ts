"use server";

/**
 * Google·iCloud 양방향 동기화 action 계약(2026-10-27 주 agent 정의).
 * 엔진 담당이 본문을 채우고 화면·OAuth route 담당은 이 시그니처만 사용한다.
 * 모든 관리자 action은 requireAdmin, 학생 대상은 requireStudentTarget/본인 검증을 한다.
 */

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { createDbContext, type DrizzleDb } from "@/db/client";
import {
  calendarConnections,
  calendarMappings,
  profiles,
  type CalendarConnectionStatus,
  type ExternalCalendarProvider,
} from "@/db/schema";
import { requireAdmin, requireAuth, requireStudentTarget } from "@/lib/auth-guard";
import {
  createCalendarClientForConnection,
  discoverICloudAccount,
  isCalendarEncryptionConfigured,
  requireCalendarEncryptionKey,
} from "@/lib/calendar-sync/client-factory";
import {
  encryptConnectionCredentials,
  decryptConnectionCredentials,
  type ConnectionCredentials,
} from "@/lib/calendar-sync/credentials";
import {
  CALENDAR_SYNC_MESSAGES,
  CalendarSyncConfigError,
  calendarSyncErrorMessage,
} from "@/lib/calendar-sync/engine";
import { exchangeGoogleCode, fetchGoogleAccountLabel, revokeGoogleToken } from "@/lib/calendar-sync/google";
import { getGoogleCalendarOAuthConfig } from "@/lib/calendar-sync/oauth-config";
import { loadRemoteSeriesItems } from "@/lib/calendar-sync/remote-series-items";
import {
  CALENDAR_SYNC_READ_BUDGET_MS,
  syncCalendarMapping,
  syncStudentCalendarMappings,
} from "@/lib/calendar-sync/sync-runner";
import { CalendarAuthError } from "@/lib/calendar-sync/types";
import { fetchExternalItemsForUser } from "@/lib/external-items";
import { getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";
import {
  resolveUnifiedItemsQuery,
  selectUnifiedItemsWithinQuery,
  type UnifiedItemsQueryInput,
} from "@/lib/unified-items-query";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

export type CalendarSyncAvailability = {
  /** EXTERNAL_CALENDAR_ENCRYPTION_KEY가 있어 자격 증명을 저장할 수 있다. 없으면 두 provider 모두 꺼짐. */
  encryptionConfigured: boolean;
  /** GOOGLE_CALENDAR_CLIENT_ID·GOOGLE_CALENDAR_CLIENT_SECRET이 모두 있다. */
  googleConfigured: boolean;
};

export type CalendarMappingSummary = {
  id: string;
  studentId: string;
  studentName: string;
  remoteCalendarId: string;
  remoteCalendarName: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type CalendarConnectionSummary = {
  id: string;
  provider: ExternalCalendarProvider;
  accountLabel: string;
  status: CalendarConnectionStatus;
  lastError: string | null;
  mappings: CalendarMappingSummary[];
};

export type CalendarSyncOverview = {
  availability: CalendarSyncAvailability;
  connections: CalendarConnectionSummary[];
  students: { id: string; name: string }[];
};

export type RemoteCalendarOption = { id: string; name: string; readOnly: boolean };

export type CalendarSyncFormState = { error?: string; success?: string };

export type StudentCalendarSyncStatus = {
  mappings: {
    provider: ExternalCalendarProvider;
    remoteCalendarName: string;
    lastSyncedAt: string | null;
    lastError: string | null;
  }[];
};

export type SyncedExternalItems = {
  /** 읽기 전용 외부 항목(iCal 구독 + 원격 반복 일정). */
  items: UnifiedItem[];
  /** 동기화가 포털 레슨·일정을 만들거나 바꾸거나 지웠다. 화면은 내부 항목을 다시 불러온다. */
  localChanged: boolean;
};

const SETTINGS_PATH = "/dashboard/admin/calendar-sync";
const MAX_APPLE_ID_LENGTH = 320;
const MAX_APP_PASSWORD_LENGTH = 64;
const MAX_LABEL_LENGTH = 200;
const MESSAGES = {
  connectionMissing: "연결 계정을 찾을 수 없습니다. 화면을 새로고침해 주세요.",
  mappingMissing: "캘린더 매핑을 찾을 수 없습니다. 화면을 새로고침해 주세요.",
  studentMissing: "학생을 찾을 수 없습니다.",
  needsReauth: "계정 인증이 만료되었습니다. 계정을 다시 연결해 주세요.",
  iCloudInput: "Apple ID와 앱 전용 암호를 입력해 주세요.",
  iCloudRejected: "Apple ID 또는 앱 전용 암호가 맞지 않습니다. appleid.apple.com에서 만든 앱 전용 암호인지 확인해 주세요.",
  iCloudFailed: "iCloud에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  googleFailed: "Google 계정을 연결하지 못했습니다. 다시 시도해 주세요.",
  googleNoRefresh: "Google이 장기 사용 권한을 주지 않았습니다. 연결을 다시 시도해 주세요.",
  googleScope: "Google 캘린더 권한이 허용되지 않았습니다. 권한을 모두 허용하고 다시 연결해 주세요.",
  calendarListFailed: "원격 캘린더 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  mappingInput: "연결 계정, 학생, 캘린더를 모두 골라 주세요.",
  calendarNotFound: "고른 캘린더를 연결 계정에서 찾을 수 없습니다. 목록을 다시 불러와 주세요.",
  calendarReadOnly: "읽기 전용 캘린더에는 연결할 수 없습니다. 쓰기 권한이 있는 캘린더를 골라 주세요.",
  studentAlreadyMapped: "이 학생은 이미 이 계정의 캘린더에 연결되어 있습니다. 기존 연결을 해제한 뒤 다시 지정해 주세요.",
  calendarAlreadyMapped: "이 캘린더는 이미 다른 학생에게 연결되어 있습니다. 학생마다 다른 캘린더를 골라 주세요.",
  mappingConflict: "같은 연결이 이미 있습니다. 화면을 새로고침해 주세요.",
  syncBusy: "다른 동기화가 진행 중입니다. 잠시 후 다시 시도해 주세요.",
} as const;

function readDb(): DrizzleDb {
  return createDbContext().db as unknown as DrizzleDb;
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function isGoogleConfigured(): boolean {
  return getGoogleCalendarOAuthConfig() !== null;
}

async function findOwnedConnection(ownerId: string, connectionId: string) {
  if (typeof connectionId !== "string" || !connectionId) return null;
  const [row] = await readDb()
    .select()
    .from(calendarConnections)
    .where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

async function findOwnedMapping(ownerId: string, mappingId: string) {
  if (typeof mappingId !== "string" || !mappingId) return null;
  const [row] = await readDb()
    .select({ id: calendarMappings.id, connectionId: calendarMappings.connectionId, status: calendarConnections.status })
    .from(calendarMappings)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .where(and(eq(calendarMappings.id, mappingId), eq(calendarConnections.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

async function markConnectionNeedsReauth(connectionId: string, message: string): Promise<void> {
  await readDb()
    .update(calendarConnections)
    .set({ status: "NEEDS_REAUTH", lastError: message, updatedAt: new Date() })
    .where(eq(calendarConnections.id, connectionId))
    .catch(() => undefined);
}

/** 같은 관리자·provider 연결이 있으면 그 id를 재사용해 자격 증명을 바꾸고(매핑 유지) 없으면 새로 만든다. */
async function upsertConnection<P extends ExternalCalendarProvider>(input: {
  ownerId: string;
  provider: P;
  accountLabel: string;
  credentials: ConnectionCredentials<P>;
  key: Uint8Array;
}): Promise<void> {
  const db = readDb();
  const [existing] = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.ownerId, input.ownerId), eq(calendarConnections.provider, input.provider)))
    .limit(1);
  const id = existing?.id ?? crypto.randomUUID();
  const encrypted = await encryptConnectionCredentials({
    connectionId: id,
    provider: input.provider,
    credentials: input.credentials,
    key: input.key,
  });
  const accountLabel = input.accountLabel.slice(0, MAX_LABEL_LENGTH);
  if (existing) {
    await db
      .update(calendarConnections)
      .set({ ...encrypted, accountLabel, status: "ACTIVE", lastError: null, updatedAt: new Date() })
      .where(eq(calendarConnections.id, id));
    return;
  }
  await db.insert(calendarConnections).values({
    id,
    ownerId: input.ownerId,
    provider: input.provider,
    accountLabel,
    ...encrypted,
    status: "ACTIVE",
  });
}

// ─── 관리자 설정 ────────────────────────────────────────

/** 관리자 설정 화면 데이터. */
export async function getCalendarSyncOverview(): Promise<CalendarSyncOverview> {
  const session = await requireAdmin();
  const db = readDb();
  const [connectionRows, mappingRows, studentRows] = await Promise.all([
    db
      .select({
        id: calendarConnections.id,
        provider: calendarConnections.provider,
        accountLabel: calendarConnections.accountLabel,
        status: calendarConnections.status,
        lastError: calendarConnections.lastError,
      })
      .from(calendarConnections)
      .where(eq(calendarConnections.ownerId, session.user.id))
      .orderBy(asc(calendarConnections.provider)),
    db
      .select({
        id: calendarMappings.id,
        connectionId: calendarMappings.connectionId,
        studentId: calendarMappings.studentId,
        studentDisplayName: profiles.displayName,
        studentEmail: profiles.email,
        remoteCalendarId: calendarMappings.remoteCalendarId,
        remoteCalendarName: calendarMappings.remoteCalendarName,
        lastSyncedAt: calendarMappings.lastSyncedAt,
        lastError: calendarMappings.lastError,
      })
      .from(calendarMappings)
      .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
      .innerJoin(profiles, eq(profiles.id, calendarMappings.studentId))
      .where(eq(calendarConnections.ownerId, session.user.id))
      .orderBy(asc(profiles.displayName), asc(profiles.email)),
    db
      .select({ id: profiles.id, displayName: profiles.displayName, email: profiles.email })
      .from(profiles)
      .where(eq(profiles.role, "student"))
      .orderBy(asc(profiles.displayName), asc(profiles.email)),
  ]);
  return {
    availability: { encryptionConfigured: isCalendarEncryptionConfigured(), googleConfigured: isGoogleConfigured() },
    connections: connectionRows.map((connection) => ({
      ...connection,
      mappings: mappingRows
        .filter((mapping) => mapping.connectionId === connection.id)
        .map((mapping) => ({
          id: mapping.id,
          studentId: mapping.studentId,
          studentName: getUnifiedItemSpaceLabel({ displayName: mapping.studentDisplayName, email: mapping.studentEmail }),
          remoteCalendarId: mapping.remoteCalendarId,
          remoteCalendarName: mapping.remoteCalendarName,
          lastSyncedAt: iso(mapping.lastSyncedAt),
          lastError: mapping.lastError,
        })),
    })),
    students: studentRows.map((student) => ({ id: student.id, name: getUnifiedItemSpaceLabel(student) })),
  };
}

/** 연결 계정에서 고를 수 있는 캘린더 목록. */
export async function listRemoteCalendars(
  connectionId: string,
): Promise<{ calendars: RemoteCalendarOption[] } | { error: string }> {
  const session = await requireAdmin();
  const connection = await findOwnedConnection(session.user.id, connectionId);
  if (!connection) return { error: MESSAGES.connectionMissing };
  if (connection.status !== "ACTIVE") return { error: MESSAGES.needsReauth };
  try {
    const client = await createCalendarClientForConnection(createDbContext(), connection);
    const calendars = await client.listCalendars();
    return { calendars: calendars.map((calendar) => ({ id: calendar.id, name: calendar.name, readOnly: calendar.readOnly })) };
  } catch (error) {
    if (error instanceof CalendarAuthError) {
      await markConnectionNeedsReauth(connection.id, CALENDAR_SYNC_MESSAGES.auth);
      revalidatePath(SETTINGS_PATH);
      return { error: MESSAGES.needsReauth };
    }
    if (error instanceof CalendarSyncConfigError) return { error: error.message };
    return { error: MESSAGES.calendarListFailed };
  }
}

/** form fields: appleId, appPassword. 연결 확인(discovery) 뒤 암호화 저장. 암호 원문은 돌려주지 않는다. */
export async function connectICloudCalendar(
  previous: CalendarSyncFormState,
  formData: FormData,
): Promise<CalendarSyncFormState> {
  void previous;
  const session = await requireAdmin();
  if (!isCalendarEncryptionConfigured()) return { error: CALENDAR_SYNC_MESSAGES.encryptionMissing };
  const appleId = formString(formData, "appleId");
  const appPassword = formString(formData, "appPassword");
  if (!appleId || !appPassword || appleId.length > MAX_APPLE_ID_LENGTH || appPassword.length > MAX_APP_PASSWORD_LENGTH) {
    return { error: MESSAGES.iCloudInput };
  }
  let calendarHomeUrl: string;
  try {
    ({ calendarHomeUrl } = await discoverICloudAccount({ appleId, appPassword }));
  } catch (error) {
    return { error: error instanceof CalendarAuthError ? MESSAGES.iCloudRejected : MESSAGES.iCloudFailed };
  }
  try {
    await upsertConnection({
      ownerId: session.user.id,
      provider: "ICLOUD",
      accountLabel: appleId,
      credentials: { appleId, appPassword, calendarHomeUrl },
      key: requireCalendarEncryptionKey(),
    });
  } catch (error) {
    return { error: error instanceof CalendarSyncConfigError ? error.message : MESSAGES.iCloudFailed };
  }
  revalidatePath(SETTINGS_PATH);
  return { success: "iCloud 계정을 연결했습니다. 학생마다 캘린더를 지정해 주세요." };
}

/** OAuth callback route가 부른다. state·PKCE 검증은 route가 끝낸 뒤 code와 verifier만 넘긴다. */
export async function completeGoogleCalendarConnection(input: {
  code: string;
  codeVerifier: string;
}): Promise<CalendarSyncFormState> {
  const session = await requireAdmin();
  const config = getGoogleCalendarOAuthConfig();
  if (!config) return { error: CALENDAR_SYNC_MESSAGES.googleNotConfigured };
  if (!isCalendarEncryptionConfigured()) return { error: CALENDAR_SYNC_MESSAGES.encryptionMissing };
  const code = typeof input?.code === "string" ? input.code : "";
  const codeVerifier = typeof input?.codeVerifier === "string" ? input.codeVerifier : "";
  if (!code || !codeVerifier) return { error: MESSAGES.googleFailed };
  try {
    const tokens = await exchangeGoogleCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      code,
      codeVerifier,
    });
    if (!tokens.refreshToken) return { error: MESSAGES.googleNoRefresh };
    const label = await fetchGoogleAccountLabel({ accessToken: tokens.accessToken }).catch(() => null);
    await upsertConnection({
      ownerId: session.user.id,
      provider: "GOOGLE",
      accountLabel: label?.trim() || "Google 계정",
      credentials: {
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.expiresAt.getTime(),
      },
      key: requireCalendarEncryptionKey(),
    });
  } catch (error) {
    if (error instanceof CalendarAuthError && error.reason === "insufficient_scope") return { error: MESSAGES.googleScope };
    if (error instanceof CalendarSyncConfigError) return { error: error.message };
    return { error: MESSAGES.googleFailed };
  }
  revalidatePath(SETTINGS_PATH);
  return { success: "Google 계정을 연결했습니다. 학생마다 캘린더를 지정해 주세요." };
}

/** 연결 해제: Google token은 가능하면 revoke, 매핑·연결 기록 삭제. 포털 레슨·일정은 남긴다. */
export async function disconnectCalendarConnection(
  connectionId: string,
): Promise<CalendarSyncFormState> {
  const session = await requireAdmin();
  const connection = await findOwnedConnection(session.user.id, connectionId);
  if (!connection) return { error: MESSAGES.connectionMissing };
  if (connection.provider === "GOOGLE") {
    try {
      const credentials = await decryptConnectionCredentials({
        connectionId: connection.id,
        provider: "GOOGLE",
        encryptedCredentials: connection.encryptedCredentials,
        credentialsIv: connection.credentialsIv,
        key: requireCalendarEncryptionKey(),
      });
      await revokeGoogleToken({ token: credentials.refreshToken });
    } catch {
      // 폐기 실패(이미 무효·네트워크)는 연결 해제를 막지 않는다. Google 계정 설정에서도 접근을 끊을 수 있다.
    }
  }
  await readDb()
    .delete(calendarConnections)
    .where(and(eq(calendarConnections.id, connection.id), eq(calendarConnections.ownerId, session.user.id)));
  revalidatePath(SETTINGS_PATH);
  return { success: "연결을 해제했습니다. 포털의 레슨·일정은 그대로 남습니다." };
}

/** form fields: connectionId, studentId, remoteCalendarId. 저장 뒤 첫 전체 동기화를 실행한다. */
export async function saveCalendarMapping(
  previous: CalendarSyncFormState,
  formData: FormData,
): Promise<CalendarSyncFormState> {
  void previous;
  const session = await requireAdmin();
  const connectionId = formString(formData, "connectionId");
  const studentId = formString(formData, "studentId");
  const remoteCalendarId = formString(formData, "remoteCalendarId");
  if (!connectionId || !studentId || !remoteCalendarId) return { error: MESSAGES.mappingInput };
  try {
    await requireStudentTarget(studentId);
  } catch {
    return { error: MESSAGES.studentMissing };
  }
  const connection = await findOwnedConnection(session.user.id, connectionId);
  if (!connection) return { error: MESSAGES.connectionMissing };
  if (connection.status !== "ACTIVE") return { error: MESSAGES.needsReauth };

  const db = readDb();
  const existing = await db
    .select({ studentId: calendarMappings.studentId, remoteCalendarId: calendarMappings.remoteCalendarId })
    .from(calendarMappings)
    .where(eq(calendarMappings.connectionId, connection.id));
  if (existing.some((mapping) => mapping.studentId === studentId)) return { error: MESSAGES.studentAlreadyMapped };
  if (existing.some((mapping) => mapping.remoteCalendarId === remoteCalendarId)) return { error: MESSAGES.calendarAlreadyMapped };

  const ctx = createDbContext();
  let calendarName: string;
  try {
    const client = await createCalendarClientForConnection(ctx, connection);
    const calendar = (await client.listCalendars()).find((candidate) => candidate.id === remoteCalendarId);
    if (!calendar) return { error: MESSAGES.calendarNotFound };
    if (calendar.readOnly) return { error: MESSAGES.calendarReadOnly };
    calendarName = calendar.name.trim().slice(0, MAX_LABEL_LENGTH) || "캘린더";
  } catch (error) {
    if (error instanceof CalendarAuthError) {
      await markConnectionNeedsReauth(connection.id, CALENDAR_SYNC_MESSAGES.auth);
      revalidatePath(SETTINGS_PATH);
      return { error: MESSAGES.needsReauth };
    }
    if (error instanceof CalendarSyncConfigError) return { error: error.message };
    return { error: MESSAGES.calendarListFailed };
  }

  const mappingId = crypto.randomUUID();
  try {
    await db.insert(calendarMappings).values({
      id: mappingId,
      connectionId: connection.id,
      studentId,
      remoteCalendarId,
      remoteCalendarName: calendarName,
    });
  } catch {
    return { error: MESSAGES.mappingConflict };
  }

  const result = await syncCalendarMapping(ctx, mappingId, { force: true }).catch(() => null);
  revalidatePath(SETTINGS_PATH);
  if (!result || result.status === "failed") {
    return { success: `캘린더를 연결했습니다. 첫 동기화는 실패했습니다: ${result?.error ?? CALENDAR_SYNC_MESSAGES.provider}` };
  }
  return { success: "캘린더를 연결하고 첫 동기화를 마쳤습니다." };
}

export async function removeCalendarMapping(mappingId: string): Promise<CalendarSyncFormState> {
  const session = await requireAdmin();
  const mapping = await findOwnedMapping(session.user.id, mappingId);
  if (!mapping) return { error: MESSAGES.mappingMissing };
  await readDb().delete(calendarMappings).where(eq(calendarMappings.id, mapping.id));
  revalidatePath(SETTINGS_PATH);
  return { success: "캘린더 연결을 해제했습니다. 포털과 원격 캘린더의 일정은 그대로 남습니다." };
}

export async function syncCalendarMappingNow(mappingId: string): Promise<CalendarSyncFormState> {
  const session = await requireAdmin();
  const mapping = await findOwnedMapping(session.user.id, mappingId);
  if (!mapping) return { error: MESSAGES.mappingMissing };
  if (mapping.status !== "ACTIVE") return { error: MESSAGES.needsReauth };
  let result;
  try {
    result = await syncCalendarMapping(createDbContext(), mapping.id, { force: true });
  } catch (error) {
    return { error: calendarSyncErrorMessage(error) };
  }
  revalidatePath(SETTINGS_PATH);
  if (result.status === "failed") return { error: result.error };
  if (result.status === "skipped") return { error: result.reason === "inactive" ? MESSAGES.needsReauth : MESSAGES.syncBusy };
  if (result.localChanged) revalidatePath("/dashboard/student");
  return { success: result.partial ? "동기화했습니다. 남은 항목은 다음 동기화에서 이어서 반영합니다." : "동기화를 마쳤습니다." };
}

// ─── 학생·캘린더 화면 ────────────────────────────────────

/** 학생 본인은 studentId를 무시하고 자기 자신, 관리자는 지정한 학생(검증)·미지정이면 자기 자신. */
async function resolveCalendarTarget(studentId: string | undefined): Promise<string> {
  const session = await requireAuth();
  if (session.user.role === "admin" && typeof studentId === "string" && studentId) {
    await requireStudentTarget(studentId);
    return studentId;
  }
  return session.user.id;
}

/** 학생 본인(studentId 생략) 또는 관리자가 대상 학생의 동기화 상태를 본다. */
export async function getStudentCalendarSyncStatus(
  studentId?: string,
): Promise<StudentCalendarSyncStatus> {
  const targetId = await resolveCalendarTarget(studentId);
  const rows = await readDb()
    .select({
      provider: calendarConnections.provider,
      connectionStatus: calendarConnections.status,
      remoteCalendarName: calendarMappings.remoteCalendarName,
      lastSyncedAt: calendarMappings.lastSyncedAt,
      lastError: calendarMappings.lastError,
    })
    .from(calendarMappings)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .where(eq(calendarMappings.studentId, targetId))
    .orderBy(asc(calendarConnections.provider));
  return {
    mappings: rows.map((row) => ({
      provider: row.provider,
      remoteCalendarName: row.remoteCalendarName,
      lastSyncedAt: iso(row.lastSyncedAt),
      lastError: row.connectionStatus === "ACTIVE" ? row.lastError : row.lastError ?? CALENDAR_SYNC_MESSAGES.auth,
    })),
  };
}

/**
 * 캘린더 화면이 hydration 뒤 부른다. 증분 동기화(60초 throttle, lease)를 한 뒤 읽기 전용 외부 항목을 돌려준다.
 * studentId 생략 = 학생 본인, 지정 = 관리자의 대상 학생.
 */
export async function syncAndGetExternalItems(input: {
  studentId?: string;
  query?: UnifiedItemsQueryInput;
}): Promise<SyncedExternalItems> {
  const targetId = await resolveCalendarTarget(input?.studentId);
  const query = resolveUnifiedItemsQuery(input?.query);
  const ctx = createDbContext();

  let localChanged = false;
  try {
    ({ localChanged } = await syncStudentCalendarMappings(ctx, targetId, {
      deadline: Date.now() + CALENDAR_SYNC_READ_BUDGET_MS,
    }));
  } catch {
    // 원격 실패는 화면 표시를 막지 않는다.
  }

  const [subscriptionItems, seriesItems] = await Promise.all([
    fetchExternalItemsForUser(targetId, input?.query).catch(() => [] as UnifiedItem[]),
    (async () => {
      if (!query.types.includes("EVENT")) return [] as UnifiedItem[];
      const db = ctx.db as unknown as DrizzleDb;
      const [profile] = await db
        .select({ displayName: profiles.displayName, email: profiles.email })
        .from(profiles)
        .where(eq(profiles.id, targetId))
        .limit(1);
      if (!profile) return [] as UnifiedItem[];
      const items = await loadRemoteSeriesItems(db, {
        studentId: targetId,
        spaceLabel: getUnifiedItemSpaceLabel(profile),
        window: { start: query.start, end: query.end },
      });
      return selectUnifiedItemsWithinQuery(items, query);
    })().catch(() => [] as UnifiedItem[]),
  ]);
  return { items: [...subscriptionItems, ...seriesItems], localChanged };
}
