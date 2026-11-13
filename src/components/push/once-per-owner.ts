/**
 * 계정마다 한 번만 true를 돌려준다. 같은 계정으로 다시 부르면 false, 계정이 바뀌면 다시 true다.
 * 앱 안에서 로그아웃·로그인하면 module 상태가 남으므로, "한 번만"을 module 전역 boolean으로 두면
 * 다음 계정에서는 실행되지 않는다.
 */
export function createOncePerOwner(): (ownerId: string) => boolean {
  let lastOwnerId: string | null = null;
  return (ownerId) => {
    if (lastOwnerId === ownerId) return false;
    lastOwnerId = ownerId;
    return true;
  };
}
