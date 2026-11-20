/**
 * @file src/components/calendar/LessonRecipientChoice.tsx
 * @description 학생 한 명 화면의 레슨 예약 "받는 학생"(캔버스 UxReview1120Lessons ⑥). 그룹 멤버일 때만 보이고 기본은 이 학생만이다.
 * 그룹 전체를 고르면 서버가 이 학생의 지금 소속 그룹으로 멤버마다 같은 시각 레슨을 하나씩 만든다(src/lib/actions/lessons.ts).
 */
"use client";

import { ChoiceGroup } from "@/components/ui/choice-group";
import type { MemberGroupLessonTag } from "@/lib/group-lesson-items";
import type { QuickCreateGroupChoice } from "./CalendarQuickCreate";

/** 학생이 속한 그룹(멤버 2명 이상). 없으면 null. */
export function findStudentLessonGroup(
  groups: readonly QuickCreateGroupChoice[] | undefined,
  studentId: string,
): QuickCreateGroupChoice | null {
  return groups?.find((group) => group.members.length >= 2 && group.members.some((member) => member.id === studentId)) ?? null;
}

/** 그룹 전체로 예약한 이 학생의 레슨 항목에 붙일 그룹 표시. */
export function memberGroupLessonTagFor(group: QuickCreateGroupChoice, studentId: string): MemberGroupLessonTag {
  return { groupName: group.label, partnerNames: group.members.filter((member) => member.id !== studentId).map((member) => member.label) };
}

export function LessonRecipientChoice({
  studentId,
  studentLabel,
  group,
  withGroup,
  onChange,
  disabled = false,
}: {
  studentId: string;
  studentLabel: string;
  group: QuickCreateGroupChoice;
  withGroup: boolean;
  onChange: (withGroup: boolean) => void;
  disabled?: boolean;
}) {
  const partnerNames = group.members.filter((member) => member.id !== studentId).map((member) => member.label);
  return (
    <div className="flex flex-col gap-1.5">
      <ChoiceGroup
        label="받는 학생"
        variant="segment"
        options={[
          { value: "self", label: `${studentLabel}만` },
          { value: "group", label: `${group.label} 전체 (${group.members.length}명)` },
        ]}
        value={withGroup ? "group" : "self"}
        onChange={(value) => onChange(value === "group")}
        disabled={disabled}
      />
      {withGroup ? (
        <p className="text-xs/[18px] text-secondary-foreground">{[studentLabel, ...partnerNames].join(" · ")}에게 레슨이 하나씩 들어갑니다.</p>
      ) : null}
    </div>
  );
}
