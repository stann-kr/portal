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
/**
 * 연결 권한 lease. 토큰을 발급할 때(세션·문서 권한 확인 시점)부터 이 시간까지만 연결이 유효하다.
 * 클라이언트는 `COLLAB_RENEW_INTERVAL_MS`마다 새 토큰으로 `renew`해 lease를 넘겨받는다.
 * 권한이 사라지면 새 토큰을 받지 못해 lease가 끝나는 즉시 room이 닫는다.
 */
export const COLLAB_LEASE_SECONDS = 150;
export const COLLAB_RENEW_INTERVAL_MS = 60 * 1000;

/** 한 메시지 상한. 붙여 넣은 이미지(base64)까지 고려하되 room 저장 상한보다 작게 둔다. */
export const COLLAB_MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
/** room 전체 상태 상한. 저장 HTML 상한(800 KiB)보다 Yjs 상태가 크므로 여유를 둔다. */
export const COLLAB_MAX_ROOM_BYTES = 8 * 1024 * 1024;

/** room이 클라이언트를 닫을 때 쓰는 이유 코드(4000~4999는 애플리케이션 정의). */
export const COLLAB_CLOSE_RESET = 4001;
export const COLLAB_CLOSE_EXPIRED = 4002;
export const COLLAB_CLOSE_TOO_LARGE = 4003;
export const COLLAB_CLOSE_UNAUTHORIZED = 4004;
/** 토큰의 문서 세대가 room보다 옛것이다. 새 토큰으로 다시 연결한다. */
export const COLLAB_CLOSE_STALE = 4005;
/** freeze(복원 준비)에 제때 응답하지 않아 닫았다. 이 기기의 미확인 입력은 기기에 남는다. */
export const COLLAB_CLOSE_FREEZE_TIMEOUT = 4006;
/** room이 복원을 준비하는 중이라 새 연결을 받지 않는다. 잠시 뒤 다시 연결한다. */
export const COLLAB_CLOSE_BUSY = 4007;
/** 문서가 휴지통으로 가거나 지워졌다. 다시 연결해도 토큰이 거부된다. */
export const COLLAB_CLOSE_GONE = 4008;

export type CollabMode = "read" | "write";

/** room → 클라이언트 control. */
export type CollabControlMessage =
  | { t: "hello"; epoch: number; mode: CollabMode; frozen?: boolean; seq?: number }
  | { t: "reset"; epoch: number }
  | { t: "error"; code: "read-only" | "too-large" | "bad-message" | "stale" | "busy" }
  /** 이 소켓이 보낸 update 중 room이 저장한 누적 개수. */
  | { t: "ack"; n: number }
  /** 복원 준비: 편집을 잠시 멈추고 `frozen`으로 답한다. */
  | { t: "freeze"; id: string }
  | { t: "thaw"; id: string }
  /** 저장 담당에게: 지금 내용을 저장(checkpoint)하거나 작업본이 게시본과 같은지 확인(clean)해 답한다. */
  | { t: "flush"; id: string; mode: CollabPrepareMode }
  /** 권한이 읽기로 바뀌었다. */
  | { t: "mode"; mode: CollabMode }
  /** 알림 room: 대상이 바뀌었다(seq는 room이 매긴 순번). */
  | { t: "changed"; seq: number };

/** 클라이언트 → room control. */
export type CollabClientControlMessage =
  | { t: "frozen"; id: string }
  | { t: "flushed"; id: string; ok: boolean; revision?: number; sv?: string; dirty?: boolean }
  /** 저장 성공(또는 이미 저장된 내용과 같음). sv는 저장한 내용의 state vector(base64). */
  | { t: "saved"; sv: string }
  | { t: "renew"; token: string };

/** checkpoint: 노트처럼 저장하면 되는 문서. clean: 게시물 작업본처럼 저장하면 안 되고 미게시 변경이 없어야 한다. */
export type CollabPrepareMode = "checkpoint" | "clean";

export type CollabPrepareResult =
  | { ok: true; checkpoint: number | null }
  | { ok: false; reason: "busy" | "unsaved" | "unpublished" | "no-saver" | "flush-failed" | "timeout" };

/** worker가 검증한 토큰 내용을 room에 넘기는 내부 헤더. 클라이언트가 보낸 같은 이름의 헤더는 버린다. */
export const COLLAB_INTERNAL_HEADER_USER = "x-portal-collab-user";
export const COLLAB_INTERNAL_HEADER_MODE = "x-portal-collab-mode";
export const COLLAB_INTERNAL_HEADER_KEY = "x-portal-collab-key";
/** 토큰 발급 때 D1에서 읽은 문서 세대(lifecycle 표지). 노트·게시물만. */
export const COLLAB_INTERNAL_HEADER_LIFECYCLE = "x-portal-collab-lifecycle";
/** lease 끝(초)과 발급 시각(ms). */
export const COLLAB_INTERNAL_HEADER_LEASE = "x-portal-collab-lease";
export const COLLAB_INTERNAL_HEADER_ISSUED = "x-portal-collab-issued";

/** room 내부 경로. 외부 요청은 worker가 항상 `/connect`로 바꿔 넘기므로 `/reset`에 닿지 못한다. */
export const COLLAB_ROOM_CONNECT_URL = "https://collab-room/connect";
export const COLLAB_ROOM_RESET_URL = "https://collab-room/reset";
export const COLLAB_ROOM_EPOCH_URL = "https://collab-room/epoch";
/** 복원 commit 뒤 room을 그 세대로 넘긴다(같거나 작으면 no-op). body `{ target }`. */
export const COLLAB_ROOM_ADVANCE_URL = "https://collab-room/advance";
/** 복원 전 준비(freeze → checkpoint). body `{ id, mode }`. 응답 `CollabPrepareResult`. */
export const COLLAB_ROOM_PREPARE_URL = "https://collab-room/prepare";
export const COLLAB_ROOM_THAW_URL = "https://collab-room/thaw";
/** 연결을 모두 닫는다. body `{ keep }`: true면 상태를 보존(휴지통), false면 비운다(영구 삭제). */
export const COLLAB_ROOM_CLOSE_URL = "https://collab-room/close";
/** room 밖에서 바뀐 칸(캘린더 날짜 이동)을 room에 반영한다. body `{ field, value }`. */
export const COLLAB_ROOM_SET_META_URL = "https://collab-room/set-meta";
/** 알림 room에 변경을 알린다. */
export const COLLAB_ROOM_NOTIFY_URL = "https://collab-room/notify";
/** 저장 요청에 싣는 room epoch. 서버가 지금 room epoch와 다르면(복원·휴지통 뒤) 저장을 거부한다. */
export const COLLAB_EPOCH_FIELD = "collabEpoch";
