/**
 * @file src/components/admin-portal/AdminPortalClient.tsx
 * @description 어드민 원페이지 포털 오케스트레이터.
 * 3개 섹션(업무함 / 학생 / 일정)을 navigation으로 전환. 공지·커뮤니티는 /community가 맡는다.
 */
"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { getUnifiedItemKey, upsertUnifiedItems, type UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import type { StudentRosterStat } from "@/lib/actions/students";
import type {
  AdminQueueThread,
  PendingFeedbackAssignment,
} from "@/lib/admin-work-queue";
import {
  getExternalUnifiedItemsForStudent,
  getUnifiedItemsForStudent,
} from "@/lib/actions/unifiedItems";
import { getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";
import { PortalShell } from "@/components/ui/portal-shell";
import type { PortalLocation, PortalSection } from "@/lib/portal-location";

// ── 섹션 컴포넌트
import { CalendarSection } from "@/components/student-portal/CalendarSection";
import { StudentManagementSection } from "./StudentManagementSection";
import { StudentFilterDropdown } from "./StudentFilterDropdown";
import { AdminWorkQueueSection } from "./AdminWorkQueueSection";

// ── 타입 ──────────────────────────────────────────

type Section = PortalSection<"admin">;

export interface AdminPortalClientProps {
  initialLocation?: PortalLocation<"admin">;
  initialStudentId?: string;
  initialUnifiedItems: UnifiedItem[];
  students: StudentRosterStat[];
  adminId: string;
  qnaThreads: AdminQueueThread[];
  pendingAssignments: PendingFeedbackAssignment[];
  referenceTime: Date;
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
  students,
  initialStudentId = students[0]?.id ?? "",
  adminId,
  qnaThreads,
  pendingAssignments,
  referenceTime,
}: AdminPortalClientProps) {
  // 캘린더 학생 필터 상태
  const [selectedStudentId, setSelectedStudentId] = useState<string>(
    initialStudentId
  );
  const [calendarItems, setCalendarItems] = useState<UnifiedItem[]>(initialUnifiedItems);
  const [calendarLoadedStudentId, setCalendarLoadedStudentId] = useState(
    initialStudentId,
  );
  const [isLoadingCalendar, startCalendarTransition] = useTransition();
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const calendarRequestRef = useRef(0);
  const calendarLoadedStudentIdRef = useRef(initialStudentId);

  const selectStudent = useCallback((studentId: string, historyMode: "push" | "replace" | "none") => {
    if (!students.some((student) => student.id === studentId)) return;
    const requestId = ++calendarRequestRef.current;
    setSelectedStudentId(studentId);
    setCalendarItems([]);
    setCalendarLoadedStudentId("");
    calendarLoadedStudentIdRef.current = "";
    setCalendarError(null);

    if (historyMode !== "none") {
      const url = new URL(window.location.href);
      url.searchParams.set("section", "schedule");
      url.searchParams.set("student", studentId);
      window.history[historyMode === "push" ? "pushState" : "replaceState"](
        {},
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }

    startCalendarTransition(async () => {
      try {
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
  }, [students]);

  // 내부 일정이 준비된 뒤에만 외부 provider를 별도 요청해 느린 feed가 첫 표시를 막지 않는다.
  useEffect(() => {
    if (!calendarLoadedStudentId || calendarLoadedStudentId !== selectedStudentId) return;
    const requestId = calendarRequestRef.current;
    let cancelled = false;
    void getExternalUnifiedItemsForStudent(calendarLoadedStudentId).then((externalItems) => {
      if (!cancelled && calendarRequestRef.current === requestId) {
        setCalendarItems((current) => upsertUnifiedItems(current, externalItems));
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [calendarLoadedStudentId, selectedStudentId]);

  // URL의 학생 선택을 복원하고, 뒤로/앞으로 이동도 같은 데이터 문맥으로 맞춘다.
  useEffect(() => {
    const restoreStudent = () => {
      const fromUrl = new URLSearchParams(window.location.search).get("student");
      const restored = students.find((student) => student.id === fromUrl)?.id;
      const fallback = students[0]?.id ?? "";
      const nextStudentId = restored ?? fallback;
      if (!nextStudentId) return;

      if (!restored) {
        const url = new URL(window.location.href);
        url.searchParams.set("student", nextStudentId);
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }

      if (nextStudentId !== selectedStudentId) selectStudent(nextStudentId, "none");
    };

    restoreStudent();
    window.addEventListener("popstate", restoreStudent);
    return () => window.removeEventListener("popstate", restoreStudent);
  }, [selectStudent, selectedStudentId, students]);

  const handleStudentChange = (studentId: string) => selectStudent(studentId, "push");
  // 레슨 예약·변경·삭제는 현재 학생 캘린더에 즉시 반영한다. 다른 학생으로 바뀐 뒤 늦은 결과는 무시한다.
  const upsertCalendarItem = useCallback((item: UnifiedItem) => {
    setCalendarItems((current) => item.space.studentId === calendarLoadedStudentIdRef.current
      ? upsertUnifiedItems(current, [item])
      : current);
  }, []);
  const removeCalendarItem = useCallback((item: UnifiedItem) => {
    const key = getUnifiedItemKey(item);
    setCalendarItems((current) => current.filter((candidate) => getUnifiedItemKey(candidate) !== key));
  }, []);
  const selectedStudent = students.find((student) => student.id === selectedStudentId);
  const selectedSpaceLabel = selectedStudent
    ? getUnifiedItemSpaceLabel(selectedStudent)
    : "";

  return (
    <PortalShell
      items={SECTIONS}
      initialItem={initialLocation?.section ?? "work"}
      storageKey="adminPortal:section"
      urlParamKey="section"
      ariaLabel="관리자 포털"
    >
      {(activeSection, changeSection) => (
        <>
          {activeSection === "work" && (
            <AdminWorkQueueSection
              students={students}
              threads={qnaThreads}
              pendingAssignments={pendingAssignments}
              referenceTime={referenceTime}
              onOpenSchedule={() => changeSection("schedule")}
            />
          )}

          <div hidden={activeSection !== "schedule"} className="h-full">
            <CalendarSection
              initialLocation={initialLocation}
              key={selectedStudentId}
              isActive={activeSection === "schedule"}
              unifiedItems={isLoadingCalendar ? [] : calendarItems}
              curriculumModules={[]}
              assignments={[]}
              studentId={selectedStudentId}
              actorId={adminId}
              spaceLabel={selectedSpaceLabel}
              workspaceRole="admin"
              canCreateQna={false}
              onAddItem={upsertCalendarItem}
              onRemoveItem={removeCalendarItem}
              loading={isLoadingCalendar}
              loadError={calendarError}
              onRetry={() => selectedStudentId && selectStudent(selectedStudentId, "none")}
              headerSlot={
                students.length > 0 ? (
                  <StudentFilterDropdown
                    students={students.map((s) => ({
                      id: s.id,
                      email: s.email,
                      displayName: s.displayName,
                    }))}
                    selectedStudentId={selectedStudentId}
                    onStudentChange={handleStudentChange}
                    loading={isLoadingCalendar}
                  />
                ) : undefined
              }
            />
          </div>

          {activeSection === "students" && (
            <StudentManagementSection
              students={students}
            />
          )}
        </>
      )}
    </PortalShell>
  );
}
