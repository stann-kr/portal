/**
 * @file src/components/admin-portal/AdminPortalClient.tsx
 * @description 어드민 원페이지 포탈 오케스트레이터.
 * 3개 섹션(업무함 / 학생 / 일정)을 navigation으로 전환. 공지·커뮤니티는 /community가 맡는다.
 * 일정 구역(캘린더)은 처음 열 때 mount하고, 서버가 일정 데이터를 주지 않았으면(업무함·학생으로 연 경우) 그때 받는다.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getUnifiedItemKey, replaceUnifiedItemsInRange, upsertUnifiedItems, type UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import type { StudentRosterStat } from "@/lib/actions/students";
import type { LessonGroupSummary } from "@/lib/lesson-group-rules";
import type {
  AdminQueueThread,
  PendingFeedbackAssignment,
} from "@/lib/admin-work-queue";
import { getUnifiedItemsForAllStudents, getUnifiedItemsForStudent, getUnifiedItemsWindowForStudent } from "@/lib/actions/unifiedItems";
import { ALL_STUDENTS_SCOPE, resolveAdminScheduleStudent } from "@/lib/admin-schedule-scope";
import {
  getAllStudentsItemsWindow,
  isWindowCovered,
  type UnifiedItemsWindow,
} from "@/lib/unified-items-query";
import { syncAndGetExternalItems } from "@/lib/actions/calendarSync";
import { getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";
import { PortalShell } from "@/components/ui/portal-shell";
import { useHistoryReturn } from "@/components/app-shell/RouteAutoRefresh";
import { useIdlePreload } from "@/lib/hooks/useIdlePreload";
import type { PortalLocation, PortalSection } from "@/lib/portal-location";

// ── 섹션 컴포넌트
import { CalendarSection } from "@/components/student-portal/CalendarSection";
import { expandGroupLessonItem, mergeGroupLessonItems } from "@/lib/group-lesson-items";
import { StudentManagementSection } from "./StudentManagementSection";
import { StudentFilterDropdown } from "./StudentFilterDropdown";
import { AdminWorkQueueSection } from "./AdminWorkQueueSection";

// ── 타입 ──────────────────────────────────────────

type Section = PortalSection<"admin">;

/**
 * 첫 화면 뒤에 합치는 학생 데이터(바깥 iCal 구독의 다음 레슨). 서버가 기다리지 않고 promise로 넘긴다.
 * `nextLessonDates`: DB 다음 레슨보다 이른 구독 일정만. `lessonNoteIds`: 그 때문에 새로 7일 안에 들어온 학생의 수업 노트 링크.
 */
export type AdminLateRoster = {
  nextLessonDates: Readonly<Record<string, Date>>;
  lessonNoteIds: Readonly<Record<string, string>>;
};

/** 일정 구역의 달력 코드(FullCalendar)를 업무함이 뜬 뒤 한가할 때 미리 받는다. */
const preloadCalendarCode = () => import("@/components/student-portal/FullCalendarGrid");

/** "전체 학생" 기간 응답이 덮는 범위. 상한에 걸려 잘린 응답은 교체 근거가 되지 못한다. */
function toResponseRange(result: { start: string; end: string; truncated: boolean }) {
  return { start: new Date(result.start), end: new Date(result.end), complete: !result.truncated };
}

export interface AdminPortalClientProps {
  initialLocation?: PortalLocation<"admin">;
  initialStudentId?: string;
  /** 처음 고른 학생 일정에서 열 날짜와 항목(학생이 옮긴 레슨 알림). 다른 학생을 고르면 버린다. */
  initialCalendarDeepLink?: { date: string | null; itemKey: string | null };
  /** 서버가 읽은 처음 학생 일정. 없으면(일정 구역이 아닌 곳으로 열었을 때) 일정 구역을 처음 열 때 받는다. */
  initialUnifiedItems?: UnifiedItem[];
  students: StudentRosterStat[];
  /** 그룹레슨 그룹(학생 목록에 묶어 보인다). */
  lessonGroups?: LessonGroupSummary[];
  /** 수강 종료한 학생 수(학생 목록 맨 아래 링크). */
  archivedStudentCount?: number;
  adminId: string;
  qnaThreads: AdminQueueThread[];
  pendingAssignments: PendingFeedbackAssignment[];
  referenceTime: Date;
  /** 업무함 다가오는 레슨 행의 수업 노트 링크용 "학생:KST 날짜" → 노트 id. */
  lessonNoteIds?: Readonly<Record<string, string>>;
  /** 첫 화면 뒤에 합칠 학생 데이터(바깥 iCal 구독의 다음 레슨). */
  lateRoster?: Promise<AdminLateRoster>;
  /** "전체 학생"으로 시작할 때 서버가 읽은 기간(ISO)과 상한에 닿았는지. 없으면 기준 시각의 기본 기간으로 본다. */
  initialAllStudentsWindow?: { start: string; end: string; truncated: boolean };
}

// ── 구역 정의 ────────────────────────────────────

/** 사이드바가 이동을 맡고, 여기서는 주소로 열 수 있는 구역만 정한다. */
const SECTIONS: readonly { id: Section }[] = [
  { id: "work" },
  { id: "students" },
  { id: "schedule" },
];

// ── 컴포넌트 ─────────────────────────────────────

export function AdminPortalClient({
  initialLocation,
  initialUnifiedItems,
  students: serverStudents,
  lessonGroups = [],
  archivedStudentCount = 0,
  initialStudentId = serverStudents.length > 0 ? ALL_STUDENTS_SCOPE : "",
  initialCalendarDeepLink,
  adminId,
  qnaThreads,
  pendingAssignments,
  referenceTime,
  lessonNoteIds: serverLessonNoteIds,
  lateRoster,
  initialAllStudentsWindow,
}: AdminPortalClientProps) {
  // 바깥 iCal 구독의 다음 레슨은 첫 화면 뒤에 도착한다. 새 props(다시 받기)가 와도 앞 값은 새 값이 올 때까지 둔다.
  const [late, setLate] = useState<AdminLateRoster | null>(null);
  useEffect(() => {
    if (!lateRoster) return;
    let cancelled = false;
    void lateRoster.then((value) => {
      if (!cancelled) setLate(value);
    }, () => undefined);
    return () => {
      cancelled = true;
    };
  }, [lateRoster]);
  const students = useMemo(() => {
    if (!late) return serverStudents;
    return serverStudents.map((student) => {
      const subscribed = late.nextLessonDates[student.id];
      if (!subscribed) return student;
      const next = new Date(subscribed);
      // 서버 값이 그사이 더 이른 레슨으로 바뀌었으면(다시 받기) 그대로 둔다.
      return student.nextLessonDate && student.nextLessonDate.getTime() <= next.getTime()
        ? student
        : { ...student, nextLessonDate: next };
    });
  }, [late, serverStudents]);
  const lessonNoteIds = useMemo(
    () => (late && Object.keys(late.lessonNoteIds).length > 0
      ? { ...late.lessonNoteIds, ...serverLessonNoteIds }
      : serverLessonNoteIds),
    [late, serverLessonNoteIds],
  );
  const calendarPreloaded = initialUnifiedItems !== undefined;
  // 일정 구역은 처음 열 때 mount하고, 한 번 연 뒤에는 날짜·보기를 지키려고 숨겨 둔다.
  const [scheduleMounted, setScheduleMounted] = useState(initialLocation?.section === "schedule");
  useIdlePreload(preloadCalendarCode);
  // 캘린더 학생 필터 상태
  const [selectedStudentId, setSelectedStudentId] = useState<string>(
    initialStudentId
  );
  const [calendarItems, setCalendarItems] = useState<UnifiedItem[]>(initialUnifiedItems ?? []);
  const [calendarDeepLink, setCalendarDeepLink] = useState(initialCalendarDeepLink ?? null);
  const [calendarLoadedStudentId, setCalendarLoadedStudentId] = useState(
    calendarPreloaded ? initialStudentId : "",
  );
  const [isLoadingCalendar, startCalendarTransition] = useTransition();
  const [calendarError, setCalendarError] = useState<string | null>(null);
  // "전체 학생"에서 더 읽은 기간의 오류. 학생 일정 첫 읽기 오류(calendarError)와 따로 지운다.
  const [rangeError, setRangeError] = useState<string | null>(null);
  const visibleRangeRef = useRef<{ start: Date; end: Date } | null>(null);
  const calendarRequestRef = useRef(0);
  const calendarLoadedStudentIdRef = useRef(calendarPreloaded ? initialStudentId : "");
  // 일정 데이터를 한 번이라도 읽기 시작했는지(서버가 줬거나 학생을 골랐다). 일정 구역을 처음 열 때 한 번만 읽는다.
  const calendarLoadStartedRef = useRef(calendarPreloaded);
  // "전체 학생"이 이미 읽은 기간들. 달력이 이 밖으로 넘어가면 그 달 기준 기간을 더 읽어 합친다.
  const allWindowsRef = useRef<UnifiedItemsWindow[]>(
    calendarPreloaded && initialStudentId === ALL_STUDENTS_SCOPE
      ? [initialAllStudentsWindow
        ? { start: new Date(initialAllStudentsWindow.start), end: new Date(initialAllStudentsWindow.end) }
        : getAllStudentsItemsWindow(referenceTime)]
      : [],
  );
  const allWindowLoadsRef = useRef(new Set<string>());
  const [allStudentsTruncated, setAllStudentsTruncated] = useState(
    initialStudentId === ALL_STUDENTS_SCOPE && initialAllStudentsWindow?.truncated === true,
  );
  const [loadingMoreRange, setLoadingMoreRange] = useState(false);
  const studentIds = useMemo(() => students.map((student) => student.id), [students]);

  // "전체 학생": 달력이 아직 읽지 않은 기간을 보이면 그 기간을 덮는 범위를 더 읽어 합친다.
  // 보이는 기간은 늘 기억해 두어, 전체 학생을 (다시) 읽은 뒤 그 기간을 이어 읽고 기간 오류의 "다시 시도"도 그 기간을 읽는다.
  const loadAllStudentsRange = useCallback((start: Date, end: Date) => {
    visibleRangeRef.current = { start, end };
    if (calendarLoadedStudentIdRef.current !== ALL_STUDENTS_SCOPE) return;
    if (isWindowCovered(allWindowsRef.current, start, end)) {
      setRangeError(null);
      return;
    }
    const range = getAllStudentsItemsWindow(start);
    // 보이는 기간이 이 범위 끝을 넘으면(긴 격자) 끝 쪽을 기준으로 한 번 더 읽는다.
    const windows = range.end.getTime() >= end.getTime() ? [range] : [range, getAllStudentsItemsWindow(end)];
    const requestId = calendarRequestRef.current;
    const visibleCovered = () => {
      const visible = visibleRangeRef.current;
      return !visible || isWindowCovered(allWindowsRef.current, visible.start, visible.end);
    };
    for (const next of windows) {
      const key = next.start.toISOString();
      if (allWindowLoadsRef.current.has(key) || isWindowCovered(allWindowsRef.current, next.start, next.end)) continue;
      allWindowLoadsRef.current.add(key);
      setLoadingMoreRange(true);
      void getUnifiedItemsForAllStudents({ start: next.start.toISOString(), end: next.end.toISOString() })
        .then((result) => {
          if (calendarRequestRef.current !== requestId) return;
          allWindowsRef.current = [...allWindowsRef.current, { start: new Date(result.start), end: new Date(result.end) }];
          if (result.truncated) setAllStudentsTruncated(true);
          // 이 기간에 이미 있던(겹친 기간·바로 추가한) 항목 중 응답에 없는 것은 지워졌거나 옮겨진 것이다.
          setCalendarItems((current) => replaceUnifiedItemsInRange(current, result.items, toResponseRange(result)));
          if (visibleCovered()) setRangeError(null);
        })
        .catch(() => {
          // 이미 다른(읽은) 기간으로 옮겼으면 알리지 않는다. 실패한 기간으로 돌아오면 다시 읽는다.
          if (calendarRequestRef.current === requestId && !visibleCovered()) {
            setRangeError("이 기간의 전체 학생 일정을 불러오지 못했습니다. 다시 시도해 주세요.");
          }
        })
        .finally(() => {
          allWindowLoadsRef.current.delete(key);
          if (calendarRequestRef.current === requestId && allWindowLoadsRef.current.size === 0) setLoadingMoreRange(false);
        });
    }
  }, []);

  const selectStudent = useCallback((studentId: string, historyMode: "push" | "replace" | "none") => {
    const isAll = studentId === ALL_STUDENTS_SCOPE;
    if (isAll ? students.length === 0 : !students.some((student) => student.id === studentId)) return;
    const requestId = ++calendarRequestRef.current;
    calendarLoadStartedRef.current = true;
    setSelectedStudentId(studentId);
    setCalendarDeepLink(null);
    setCalendarItems([]);
    setCalendarLoadedStudentId("");
    calendarLoadedStudentIdRef.current = "";
    setCalendarError(null);
    setRangeError(null);
    allWindowsRef.current = [];
    allWindowLoadsRef.current.clear();
    setAllStudentsTruncated(false);
    setLoadingMoreRange(false);

    if (historyMode !== "none") {
      const url = new URL(window.location.href);
      url.searchParams.set("section", "schedule");
      url.searchParams.set("student", studentId);
      // 딥링크 날짜·항목은 처음 학생 것이라 다른 학생 주소에 남기지 않는다.
      url.searchParams.delete("date");
      url.searchParams.delete("item");
      window.history[historyMode === "push" ? "pushState" : "replaceState"](
        {},
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }

    startCalendarTransition(async () => {
      try {
        if (isAll) {
          const result = await getUnifiedItemsForAllStudents();
          if (calendarRequestRef.current !== requestId) return;
          allWindowsRef.current = [{ start: new Date(result.start), end: new Date(result.end) }];
          setAllStudentsTruncated(result.truncated);
          setCalendarItems(result.items);
          setCalendarLoadedStudentId(studentId);
          calendarLoadedStudentIdRef.current = studentId;
          const visible = visibleRangeRef.current;
          if (visible) loadAllStudentsRange(visible.start, visible.end);
          return;
        }
        const items = await getUnifiedItemsForStudent(studentId);
        if (calendarRequestRef.current === requestId) {
          setCalendarItems(items);
          setCalendarLoadedStudentId(studentId);
          calendarLoadedStudentIdRef.current = studentId;
        }
      } catch {
        if (calendarRequestRef.current === requestId) {
          setCalendarError("학생 일정을 불러오지 못했습니다. 다시 시도해 주세요.");
        }
      }
    });
  }, [students, loadAllStudentsRange]);

  // 내부 일정이 준비된 뒤에만 외부 provider·캘린더 동기화를 별도 요청해 느린 feed가 첫 표시를 막지 않는다.
  // "전체 학생"은 포탈 일정만 보이므로(외부 캘린더 제외) 동기화하지 않는다.
  useEffect(() => {
    if (!calendarLoadedStudentId || calendarLoadedStudentId !== selectedStudentId) return;
    if (calendarLoadedStudentId === ALL_STUDENTS_SCOPE) return;
    const requestId = calendarRequestRef.current;
    let cancelled = false;
    const studentId = calendarLoadedStudentId;
    const isCurrent = () => !cancelled && calendarRequestRef.current === requestId;
    void (async () => {
      // 동기화(throttle·lease) 뒤 읽기 전용 외부 항목을 받고, 동기화가 포탈 레슨·일정을 바꿨으면 내부 항목도 다시 받는다.
      const { items: externalItems, localChanged } = await syncAndGetExternalItems({ studentId });
      if (!isCurrent()) return;
      if (!localChanged) {
        setCalendarItems((current) => upsertUnifiedItems(current, externalItems));
        return;
      }
      // 읽은 기간만 교체한다(history 복귀와 같은 규칙). 그사이 바로 추가한 항목·기간 밖 항목은 남는다.
      const internal = await getUnifiedItemsWindowForStudent(studentId);
      if (isCurrent()) {
        setCalendarItems((current) => upsertUnifiedItems(
          replaceUnifiedItemsInRange(current, internal.items, toResponseRange(internal)),
          externalItems,
        ));
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [calendarLoadedStudentId, selectedStudentId]);

  // 노트 자동 저장·생성은 revalidatePath를 부르지 않고, 뒤로/앞으로·bfcache 복원은 옛 서버 props로 mount한다.
  // 캘린더 항목은 props를 state로 옮겨 쓰므로 router.refresh()로는 바뀌지 않는다 → 내부 항목만 다시 받아 덮는다
  // (외부 캘린더 항목은 그대로 둔다. 다른 탭·기기에서 지운 항목은 같은 탭의 revalidate로 알 수 없으므로 읽은 기간 안에서 지운다).
  const refetchInternalCalendarItems = useCallback(() => {
    const studentId = calendarLoadedStudentIdRef.current;
    if (!studentId) return;
    const requestId = calendarRequestRef.current;
    if (studentId === ALL_STUDENTS_SCOPE) {
      for (const loaded of allWindowsRef.current) {
        void getUnifiedItemsForAllStudents({ start: loaded.start.toISOString(), end: loaded.end.toISOString() })
          .then((result) => {
            if (calendarRequestRef.current !== requestId || calendarLoadedStudentIdRef.current !== studentId) return;
            // 읽은 기간을 다시 받으면 그 기간 항목을 응답으로 교체한다(다른 곳에서 지우거나 기간 밖으로 옮긴 항목 제거).
            setCalendarItems((current) => replaceUnifiedItemsInRange(current, result.items, toResponseRange(result)));
          })
          .catch(() => undefined);
      }
      return;
    }
    void getUnifiedItemsWindowForStudent(studentId)
      .then((result) => {
        if (calendarRequestRef.current !== requestId || calendarLoadedStudentIdRef.current !== studentId) return;
        // 전체 학생과 같은 규칙: 읽은 기간 안에서 응답에 없는 포탈 항목은 지운다(잘린 응답은 병합만, 외부 캘린더 항목은 그대로).
        setCalendarItems((current) => replaceUnifiedItemsInRange(current, result.items, toResponseRange(result)));
      })
      .catch(() => undefined);
  }, []);
  useHistoryReturn(refetchInternalCalendarItems);

  // URL의 학생 선택을 복원하고, 뒤로/앞으로 이동도 같은 데이터 문맥으로 맞춘다.
  useEffect(() => {
    const restoreStudent = () => {
      const fromUrl = new URLSearchParams(window.location.search).get("student");
      // 있는 학생 id는 그 학생, 없거나 `all`·지워진 학생이면 전체 학생(기본).
      const nextStudentId = resolveAdminScheduleStudent(fromUrl, studentIds);
      if (!nextStudentId) return;

      if (fromUrl !== nextStudentId) {
        const url = new URL(window.location.href);
        url.searchParams.set("student", nextStudentId);
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }

      if (nextStudentId !== selectedStudentId) selectStudent(nextStudentId, "none");
    };

    restoreStudent();
    window.addEventListener("popstate", restoreStudent);
    return () => window.removeEventListener("popstate", restoreStudent);
  }, [selectStudent, selectedStudentId, studentIds]);

  // 일정 구역을 처음 열 때: mount하고, 서버가 일정 데이터를 주지 않았으면 고른 학생(기본 전체 학생) 일정을 받는다.
  // 이미 받았거나 받는 중·오류 상태면 다시 부르지 않는다(오류는 "다시 시도"가 맡는다).
  const activateSchedule = useCallback(() => {
    setScheduleMounted(true);
    if (calendarLoadStartedRef.current) return;
    calendarLoadStartedRef.current = true;
    if (calendarLoadedStudentIdRef.current || !selectedStudentId) return;
    selectStudent(selectedStudentId, "none");
  }, [selectStudent, selectedStudentId]);

  const handleStudentChange = (studentId: string) => selectStudent(studentId, "push");
  // 레슨 예약·변경·삭제는 현재 학생 캘린더에 즉시 반영한다. 다른 학생으로 바뀐 뒤 늦은 결과는 무시한다.
  // 합쳐 보인 그룹레슨은 멤버별 레슨으로 풀어 반영한다(src/lib/group-lesson-items.ts).
  const upsertCalendarItem = useCallback((item: UnifiedItem) => {
    const loaded = calendarLoadedStudentIdRef.current;
    const accepted = expandGroupLessonItem(item).filter((member) =>
      member.space.studentId === loaded || (loaded === ALL_STUDENTS_SCOPE && studentIds.includes(member.space.studentId)));
    if (accepted.length > 0) setCalendarItems((current) => upsertUnifiedItems(current, accepted));
  }, [studentIds]);
  const removeCalendarItem = useCallback((item: UnifiedItem) => {
    const keys = new Set(expandGroupLessonItem(item).map(getUnifiedItemKey));
    setCalendarItems((current) => current.filter((candidate) => !keys.has(getUnifiedItemKey(candidate))));
  }, []);
  const displayedCalendarItems = useMemo(
    () => mergeGroupLessonItems(calendarItems, lessonGroups),
    [calendarItems, lessonGroups],
  );
  const isAllStudents = selectedStudentId === ALL_STUDENTS_SCOPE;
  const selectedStudent = students.find((student) => student.id === selectedStudentId);
  const selectedSpaceLabel = isAllStudents
    ? "전체 학생"
    : selectedStudent
      ? getUnifiedItemSpaceLabel(selectedStudent)
      : "";
  const studentChoices = useMemo(
    () => students.map((student) => ({ id: student.id, label: getUnifiedItemSpaceLabel(student) })),
    [students],
  );
  const groupChoices = useMemo(() => lessonGroups.flatMap((group) => {
    const members = studentChoices.filter((student) => group.memberIds.includes(student.id));
    return members.length >= 2 ? [{ id: group.id, label: group.name, members }] : [];
  }), [lessonGroups, studentChoices]);
  const allStudentsNotice = isAllStudents && !isLoadingCalendar ? (
    <p role="status">
      전체 학생의 포탈 일정입니다(외부 캘린더 제외).
      {loadingMoreRange ? " 이 기간 일정을 더 불러오는 중입니다." : null}
      {allStudentsTruncated ? " 항목이 많아 일부만 보입니다. 학생을 골라 보면 모두 볼 수 있습니다." : null}
    </p>
  ) : null;

  return (
    <PortalShell
      items={SECTIONS}
      initialItem={initialLocation?.section ?? "work"}
      storageKey="adminPortal:section"
      urlParamKey="section"
      ariaLabel="Stann 포탈"
    >
      {(activeSection, changeSection) => (
        <>
          {activeSection === "work" && (
            <AdminWorkQueueSection
              students={students}
              threads={qnaThreads}
              pendingAssignments={pendingAssignments}
              referenceTime={referenceTime}
              lessonNoteIds={lessonNoteIds}
              lessonGroups={lessonGroups}
              onOpenSchedule={() => changeSection("schedule")}
              pushOwnerId={adminId}
            />
          )}

          <ScheduleActivation active={activeSection === "schedule"} onActivate={activateSchedule} />
          {scheduleMounted || activeSection === "schedule" ? (
          <div hidden={activeSection !== "schedule"} className="h-full">
            <CalendarSection
              initialLocation={initialLocation}
              key={selectedStudentId}
              isActive={activeSection === "schedule"}
              initialCalendarDate={calendarDeepLink?.date ?? null}
              initialCalendarItemKey={calendarDeepLink?.itemKey ?? null}
              unifiedItems={isLoadingCalendar ? [] : displayedCalendarItems}
              curriculumModules={[]}
              assignments={[]}
              studentId={isAllStudents ? "" : selectedStudentId}
              studentChoices={isAllStudents ? studentChoices : undefined}
              groupChoices={groupChoices}
              onVisibleRangeChange={isAllStudents ? loadAllStudentsRange : undefined}
              allNotesHref="/dashboard/admin/notes"
              scopeNotice={allStudentsNotice}
              actorId={adminId}
              spaceLabel={selectedSpaceLabel}
              workspaceRole="admin"
              canCreateQna={false}
              onAddItem={upsertCalendarItem}
              onRemoveItem={removeCalendarItem}
              loading={isLoadingCalendar || (!calendarLoadedStudentId && !calendarError && !!selectedStudentId)}
              loadError={calendarError ?? rangeError}
              onRetry={() => {
                const visible = visibleRangeRef.current;
                if (!calendarError && rangeError && visible) {
                  setRangeError(null);
                  loadAllStudentsRange(visible.start, visible.end);
                  return;
                }
                if (selectedStudentId) selectStudent(selectedStudentId, "none");
              }}
              headerSlot={
                students.length > 0 ? (
                  <StudentFilterDropdown
                    students={students.map((s) => ({
                      id: s.id,
                      email: s.email,
                      displayName: s.displayName,
                    }))}
                    selectedStudentId={selectedStudentId}
                    allStudentsValue={ALL_STUDENTS_SCOPE}
                    onStudentChange={handleStudentChange}
                    loading={isLoadingCalendar}
                  />
                ) : undefined
              }
            />
          </div>
          ) : null}

          {activeSection === "students" && (
            <StudentManagementSection
              students={students}
              lessonGroups={lessonGroups}
              archivedCount={archivedStudentCount}
            />
          )}
        </>
      )}
    </PortalShell>
  );
}

/** 일정 구역이 열리면(처음 열기·뒤로/앞으로·저장된 구역 복원) 한 번 알린다. */
function ScheduleActivation({ active, onActivate }: { active: boolean; onActivate: () => void }) {
  useEffect(() => {
    if (active) onActivate();
  }, [active, onActivate]);
  return null;
}
