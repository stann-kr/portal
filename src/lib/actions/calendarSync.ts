"use server";

/**
 * Google·iCloud 양방향 동기화 action 계약(2026-10-27 주 agent 정의).
 * 엔진 담당이 본문을 채우고 화면·OAuth route 담당은 이 시그니처만 사용한다.
 * 모든 관리자 action은 requireAdmin, 학생 대상은 requireStudentTarget/본인 검증을 한다.
 */

import type { CalendarConnectionStatus, ExternalCalendarProvider } from "@/db/schema";
import type { UnifiedItemsQueryInput } from "@/lib/unified-items-query";
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

const NOT_IMPLEMENTED = "calendar sync action is not implemented yet";

/** 관리자 설정 화면 데이터. */
export async function getCalendarSyncOverview(): Promise<CalendarSyncOverview> {
  throw new Error(NOT_IMPLEMENTED);
}

/** 연결 계정에서 고를 수 있는 캘린더 목록. */
export async function listRemoteCalendars(
  connectionId: string,
): Promise<{ calendars: RemoteCalendarOption[] } | { error: string }> {
  void connectionId;
  throw new Error(NOT_IMPLEMENTED);
}

/** form fields: appleId, appPassword. 연결 확인(discovery) 뒤 암호화 저장. 암호 원문은 돌려주지 않는다. */
export async function connectICloudCalendar(
  previous: CalendarSyncFormState,
  formData: FormData,
): Promise<CalendarSyncFormState> {
  void previous;
  void formData;
  throw new Error(NOT_IMPLEMENTED);
}

/** OAuth callback route가 부른다. state·PKCE 검증은 route가 끝낸 뒤 code와 verifier만 넘긴다. */
export async function completeGoogleCalendarConnection(input: {
  code: string;
  codeVerifier: string;
}): Promise<CalendarSyncFormState> {
  void input;
  throw new Error(NOT_IMPLEMENTED);
}

/** 연결 해제: Google token은 가능하면 revoke, 매핑·연결 기록 삭제. 포털 레슨·일정은 남긴다. */
export async function disconnectCalendarConnection(
  connectionId: string,
): Promise<CalendarSyncFormState> {
  void connectionId;
  throw new Error(NOT_IMPLEMENTED);
}

/** form fields: connectionId, studentId, remoteCalendarId. 저장 뒤 첫 전체 동기화를 실행한다. */
export async function saveCalendarMapping(
  previous: CalendarSyncFormState,
  formData: FormData,
): Promise<CalendarSyncFormState> {
  void previous;
  void formData;
  throw new Error(NOT_IMPLEMENTED);
}

export async function removeCalendarMapping(mappingId: string): Promise<CalendarSyncFormState> {
  void mappingId;
  throw new Error(NOT_IMPLEMENTED);
}

export async function syncCalendarMappingNow(mappingId: string): Promise<CalendarSyncFormState> {
  void mappingId;
  throw new Error(NOT_IMPLEMENTED);
}

/** 학생 본인(studentId 생략) 또는 관리자가 대상 학생의 동기화 상태를 본다. */
export async function getStudentCalendarSyncStatus(
  studentId?: string,
): Promise<StudentCalendarSyncStatus> {
  void studentId;
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * 캘린더 화면이 hydration 뒤 부른다. 증분 동기화(60초 throttle, lease)를 한 뒤 읽기 전용 외부 항목을 돌려준다.
 * studentId 생략 = 학생 본인, 지정 = 관리자의 대상 학생.
 */
export async function syncAndGetExternalItems(input: {
  studentId?: string;
  query?: UnifiedItemsQueryInput;
}): Promise<SyncedExternalItems> {
  void input;
  throw new Error(NOT_IMPLEMENTED);
}
