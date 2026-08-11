/** 명시적으로 false인 production version에서만 self-delete를 닫는다. */
export function isAccountDeletionEnabled(
  value = process.env.ACCOUNT_DELETION_ENABLED,
): boolean {
  return value !== "false";
}
