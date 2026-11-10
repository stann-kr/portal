import { SectionRouteSkeleton } from "@/components/ui/section-route-skeleton";

/** `?section=`·`?view=`에 맞는 모양(업무함·학생·일정 / 홈·캘린더·과제)을 고른다. */
export default function Loading() {
  return <SectionRouteSkeleton />;
}
