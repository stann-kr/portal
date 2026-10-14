export const ACCOUNT_DELETION_CONFIRMATION = "계정 삭제";

export function accountDeletionLoginMessage(
  accountDeleted: string | undefined,
  deviceCleanup: string | undefined,
): string | null {
  if (accountDeleted !== "1") return null;
  if (deviceCleanup === "pending") {
    return "포털 계정 데이터는 삭제했습니다. 이 기기 데이터 정리는 연결과 저장소 접근이 가능해지면 다시 시도합니다.";
  }
  if (deviceCleanup === "manual") {
    return "포털 계정 데이터는 삭제했습니다. 브라우저 저장소가 차단되어 이 기기 데이터는 자동 정리할 수 없습니다. 브라우저 설정에서 이 사이트의 저장 데이터를 직접 삭제해 주세요.";
  }
  return "포털 계정 데이터와 이 기기에 확인된 계정 데이터를 삭제했습니다.";
}
