/**
 * 실시간 공동 편집(Yjs) 연결 규약. 브라우저 provider, worker 경로와 문서 room이 함께 쓴다.
 *
 * 메시지는 y-protocols와 같은 varUint 타입 머리를 쓴다.
 * - 0 sync: y-protocols/sync step1·step2·update
 * - 1 awareness: 커서·선택·이름
 * - 2 control: room이 보내는 JSON 알림(hello·reset·error)
 */
export const COLLAB_MESSAGE_SYNC = 0;
export const COLLAB_MESSAGE_AWARENESS = 1;
export const COLLAB_MESSAGE_CONTROL = 2;

/** worker가 가로채는 WebSocket 경로. 그 밖의 `/api/collab/*`는 Next route가 처리한다. */
export const COLLAB_WS_PATH_PREFIX = "/api/collab/ws/";
export const COLLAB_TOKEN_PATH = "/api/collab/token";
/** 브라우저는 `[COLLAB_SUBPROTOCOL, token]`을 WebSocket protocol로 보내고 room은 첫 값만 돌려준다. */
export const COLLAB_SUBPROTOCOL = "portal-collab";

/** 연결 토큰은 연결 순간에만 쓰므로 짧게 둔다. 재연결마다 새로 받는다. */
export const COLLAB_TOKEN_TTL_SECONDS = 60;
/** 오래 열린 연결도 이 시간이 지나면 room이 닫아 권한을 다시 확인하게 한다. */
export const COLLAB_SOCKET_MAX_AGE_MS = 60 * 60 * 1000;

/** 한 메시지 상한. 붙여 넣은 이미지(base64)까지 고려하되 room 저장 상한보다 작게 둔다. */
export const COLLAB_MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
/** room 전체 상태 상한. 저장 HTML 상한(800 KiB)보다 Yjs 상태가 크므로 여유를 둔다. */
export const COLLAB_MAX_ROOM_BYTES = 8 * 1024 * 1024;

/** room이 클라이언트를 닫을 때 쓰는 이유 코드(4000~4999는 애플리케이션 정의). */
export const COLLAB_CLOSE_RESET = 4001;
export const COLLAB_CLOSE_EXPIRED = 4002;
export const COLLAB_CLOSE_TOO_LARGE = 4003;
export const COLLAB_CLOSE_UNAUTHORIZED = 4004;

export type CollabMode = "read" | "write";

export type CollabControlMessage =
  | { t: "hello"; epoch: number; mode: CollabMode }
  | { t: "reset"; epoch: number }
  | { t: "error"; code: "read-only" | "too-large" | "bad-message" };

/** worker가 검증한 토큰 내용을 room에 넘기는 내부 헤더. 클라이언트가 보낸 같은 이름의 헤더는 버린다. */
export const COLLAB_INTERNAL_HEADER_USER = "x-portal-collab-user";
export const COLLAB_INTERNAL_HEADER_MODE = "x-portal-collab-mode";
export const COLLAB_INTERNAL_HEADER_KEY = "x-portal-collab-key";

/** room 내부 경로. 외부 요청은 worker가 항상 `/connect`로 바꿔 넘기므로 `/reset`에 닿지 못한다. */
export const COLLAB_ROOM_CONNECT_URL = "https://collab-room/connect";
export const COLLAB_ROOM_RESET_URL = "https://collab-room/reset";
export const COLLAB_ROOM_EPOCH_URL = "https://collab-room/epoch";
/** 저장 요청에 싣는 room epoch. 서버가 지금 room epoch와 다르면(복원·휴지통 뒤) 저장을 거부한다. */
export const COLLAB_EPOCH_FIELD = "collabEpoch";
