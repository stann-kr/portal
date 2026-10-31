import type { CollabWorkerEnv } from "./worker-route";
import { resetCollabRoom } from "./worker-route";

/**
 * Next route·server action에서 같은 Worker의 공동 편집 binding을 읽는다.
 * next dev·테스트처럼 Cloudflare context가 없으면 null(혼자 모드)이다.
 */
export function readCollabWorkerEnv(): CollabWorkerEnv | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const env = getCloudflareContext()?.env as CollabWorkerEnv | undefined;
    return env?.DOC_ROOMS ? env : null;
  } catch {
    return null;
  }
}

/**
 * 복원·휴지통 이동·영구 삭제가 D1에 반영된 뒤 room을 비운다. 열린 편집기는 reset을 받고 새 head로 다시 시작한다.
 * 권한 확인은 앞선 원자 쓰기가 끝냈으므로 성공한 경우에만 부른다. 실패하면 한 번 더 시도하고 log만 남긴다
 * (D1 변경은 이미 끝났다. 남은 room 내용이 다시 저장되더라도 revision 이력에서 복원할 수 있다).
 */
export async function resetCollabRoomAfterMutation(key: string): Promise<void> {
  const env = readCollabWorkerEnv();
  if (!env) return;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (await resetCollabRoom(env, key)) return;
    } catch {
      // 다시 시도한다.
    }
  }
  console.error(JSON.stringify({ event: "collab_room_reset", outcome: "failed", kind: key.split(":")[0] }));
}
