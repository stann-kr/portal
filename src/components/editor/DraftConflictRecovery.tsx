import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      className="space-y-3 rounded-lg border border-warning/30 bg-warning-muted p-3 text-sm"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">더 최신 서버 {documentLabel}이 있습니다.</p>
          <p className="text-muted-foreground">
            현재 초안은 화면에 유지했습니다. 서버본을 사용하거나, 서버본의 변경을 덮어쓸 수 있음을 확인하고 현재 초안으로 계속해 주세요.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onUseServer}>
          서버 최신본 사용
        </Button>
        <Button type="button" size="sm" onClick={onKeepDraft}>
          현재 초안으로 계속
        </Button>
      </div>
    </div>
  );
}
