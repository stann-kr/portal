import { BookOpenText } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";

/**
 * 가이드가 열리지 않은 학생이 주소로 직접 들어왔을 때의 안내(캔버스 GuideAccess 보드 "닫힘 · 주소로 직접 들어왔을 때").
 * 목차 없이 이 안내만 그린다. 어떤 페이지가 있는지는 드러내지 않는다.
 */
export function GuideClosedNotice() {
  return (
    <div className="px-5 pb-8 pt-4 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <MobileTopBar title="가이드" />
      <div className="flex max-w-[720px] flex-col gap-6 md:mx-auto">
        <h1 className="text-display font-semibold tracking-display">가이드</h1>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <BookOpenText className="size-6 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
          <p className="text-body font-medium text-foreground">아직 열린 가이드가 없습니다</p>
          <p className="text-ui leading-[21px] text-muted-foreground">수업이 진행되면 Stann이 가이드를 열어 드립니다.</p>
        </div>
      </div>
    </div>
  );
}
