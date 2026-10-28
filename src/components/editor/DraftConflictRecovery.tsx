import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 저장 충돌(States 보드): 내 초안을 화면에 둔 채 서버 최신본 사용 또는 현재 초안으로 계속을 고르게 한다. */
export function DraftConflictRecovery({
  documentLabel,
  onUseServer,
  onKeepDraft,
}: {
  documentLabel: string;
  onUseServer: () => void;
  onKeepDraft: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3.5 rounded-lg border border-warning-border bg-warning-muted p-4"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.8} aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold leading-5 text-foreground">더 최신 서버 {documentLabel}이 있습니다.</p>
          <p className="text-ui text-secondary-foreground">
            현재 초안은 화면에 유지했습니다. 서버본을 사용하거나, 서버본의 변경을 덮어쓸 수 있음을 확인하고 현재 초안으로 계속해 주세요.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-[26px]">
        <Button type="button" variant="outline" onClick={onUseServer}>
          서버 최신본 사용
        </Button>
        <Button type="button" onClick={onKeepDraft}>
          현재 초안으로 계속
        </Button>
      </div>
    </div>
  );
}
