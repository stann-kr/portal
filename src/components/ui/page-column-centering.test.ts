import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * 사용자 결정(2026-11-09): 데스크톱(md+)에서 화면의 맨 위 본문 열은 사이드바 오른쪽 영역 가운데에 놓인다(Notion처럼).
 * 각 화면의 최상위 최대 폭 컨테이너가 `md:mx-auto`를 갖는지 확인한다. 휴대폰 여백은 그대로 둔다.
 */
const root = process.cwd();
const pageColumns: Array<[file: string, container: string]> = [
  ["src/app/(app)/dashboard/guide/page.tsx", "flex max-w-[720px] flex-col gap-6 md:mx-auto"],
  ["src/components/guide/GuideShell.tsx", "flex max-w-[1120px] flex-col gap-5 md:flex-row md:gap-12 md:mx-auto"],
  ["src/app/(app)/dashboard/student/assignments/[id]/page.tsx", "flex max-w-[880px] flex-col items-start gap-2 md:mx-auto"],
  ["src/app/(app)/dashboard/student/assignments/analysis/[taskId]/page.tsx", "flex max-w-[880px] flex-col items-start gap-2 md:mx-auto"],
  ["src/app/(app)/dashboard/student/digging/page.tsx", "flex max-w-[1120px] flex-col gap-8 md:gap-12 md:mx-auto"],
  ["src/app/(app)/dashboard/student/notes/page.tsx", "md:pt-14 md:mx-auto"],
  ["src/app/(app)/dashboard/admin/operations/page.tsx", "flex max-w-[760px] flex-col gap-6 md:gap-8 md:mx-auto"],
  ["src/app/(app)/dashboard/admin/calendar-sync/page.tsx", "flex max-w-[760px] flex-col gap-6 md:gap-8 md:mx-auto"],
  ["src/app/(app)/dashboard/admin/students/new/page.tsx", "flex max-w-[560px] flex-col gap-7 md:mx-auto"],
  ["src/app/(app)/dashboard/admin/students/[id]/page.tsx", "flex max-w-[1080px] flex-col md:gap-7 md:mx-auto"],
  ["src/app/(app)/dashboard/admin/students/[id]/notes/page.tsx", "flex max-w-[1080px] flex-col gap-5 md:gap-6 md:mx-auto"],
  ["src/app/(app)/dashboard/admin/categories/page.tsx", "flex max-w-[1040px] flex-col gap-6 md:gap-7 md:mx-auto"],
  ["src/app/(app)/dashboard/qna/page.tsx", "flex max-w-[880px] flex-col md:gap-6 md:mx-auto"],
  ["src/app/(app)/dashboard/qna/[threadId]/page.tsx", "flex max-w-[760px] flex-1 flex-col md:block md:mx-auto"],
  ["src/app/(app)/community/CommunityClient.tsx", "flex max-w-[880px] flex-col md:gap-6 md:mx-auto"],
  ["src/app/(app)/community/[postId]/page.tsx", "flex max-w-[760px] flex-1 flex-col md:block md:mx-auto"],
  ["src/app/(app)/community/[postId]/page.tsx", "flex max-w-[760px] flex-col items-start gap-3 md:mx-auto"],
  ["src/components/ui/route-loading-state.tsx", "flex max-w-[760px] flex-col gap-3.5 md:mx-auto"],
  ["src/components/admin-portal/StudentManagementSection.tsx", "flex max-w-[1080px] flex-col gap-1 md:gap-6 md:mx-auto"],
  ["src/components/admin-portal/AdminWorkQueueSection.tsx", "flex max-w-[1040px] flex-col gap-7 md:gap-10 md:mx-auto"],
  ["src/components/student-portal/TodaySection.tsx", "flex max-w-[1040px] flex-col gap-7 md:gap-10 md:mx-auto"],
  ["src/components/student-portal/CurriculumView.tsx", "flex max-w-[760px] flex-col gap-6 md:gap-8 md:mx-auto"],
  ["src/components/student-portal/AssignmentView.tsx", "max-w-[880px] md:mx-auto"],
  ["src/components/student-portal/AllItemsView.tsx", "w-full max-w-[1080px] table-fixed border-collapse text-body md:table md:mx-auto"],
  ["src/components/student-portal/DailyListView.tsx", "flex max-w-[880px] flex-col gap-3 md:mx-auto"],
  ["src/components/student-portal/CalendarSection.tsx", "md:mx-auto md:mt-0 md:max-w-[640px]"],
  ["src/components/notes/DocumentRecordFrame.tsx", "\"md:mx-auto\""],
  ["src/components/qna/NewQnaForm.tsx", "flex max-w-[760px] flex-col gap-5 md:gap-7 md:mx-auto"],
  ["src/components/community/NewPostForm.tsx", "flex max-w-[760px] flex-col gap-5 md:gap-7 md:mx-auto"],
];

test("화면 맨 위 본문 열은 데스크톱에서 가운데 정렬된다", () => {
  for (const [file, container] of pageColumns) {
    const source = readFileSync(join(root, file), "utf8");
    assert.ok(source.includes(container), `${file}: "${container}" 없음`);
  }
});

test("가운데 정렬은 데스크톱 전용이라 휴대폰 여백을 바꾸지 않는다", () => {
  for (const [file] of pageColumns) {
    const source = readFileSync(join(root, file), "utf8");
    assert.doesNotMatch(source, /className="[^"]*(?<![\w:-])mx-auto[^"]*max-w-\[(?:760|880|1040|1080|1120)px\]/u, file);
  }
});
