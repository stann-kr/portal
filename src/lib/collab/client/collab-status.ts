import type { AutosaveStatusKind } from "@/components/editor/AutosaveStatus";
import type { CollabConnectionStatus } from "./provider";
import type { CollabAutosaveStatus } from "./useCollabAutosave";
import type { CollabMode } from "../protocol";

/**
 * 연결 상태와 저장 상태를 한 줄 표시로 합친다. 선택창 없이 지금 어디에 남아 있는지만 알린다.
 */
export type CollabStatusView = { kind: AutosaveStatusKind; message: string; shortMessage: string };

export function describeCollabStatus(input: {
  connection: CollabConnectionStatus;
  mode: CollabMode | null;
  isSaver: boolean;
  autosave: CollabAutosaveStatus;
  autosaveError: string | null;
  blockedMessage: string;
  /** 저장 버튼으로 반영하는 작업본(게시물 수정·새 글)은 자동 저장 문구를 쓰지 않는다. */
  manual?: boolean;
}): CollabStatusView {
  const { connection, mode, isSaver, autosave } = input;
  if (connection === "denied") {
    return {
      kind: "error",
      message: "이 문서를 열 권한이 없거나 문서가 없습니다. 로그인이 끝났다면 다시 로그인해 주세요.",
      shortMessage: "열 수 없음",
    };
  }
  if (connection === "trashed") {
    return {
      kind: "blocked",
      message: "휴지통으로 이동한 문서입니다. 되살리면 이 화면에서 그대로 이어서 편집할 수 있습니다.",
      shortMessage: "휴지통",
    };
  }
  if (connection === "too-large") {
    return { kind: "error", message: "문서가 너무 커서 실시간 동기화를 멈췄습니다. 일부 내용을 줄여 주세요.", shortMessage: "동기화 멈춤" };
  }
  if (mode === "read") {
    if (connection === "paused") {
      return { kind: "pending", message: "잠시 쉬는 중 · 화면을 누르거나 움직이면 다시 실시간으로 봅니다.", shortMessage: "쉬는 중" };
    }
    return connection === "connected"
      ? { kind: "saved", message: "실시간으로 보는 중", shortMessage: "실시간" }
      : { kind: "pending", message: "연결 중… 연결되면 최신 내용이 보입니다.", shortMessage: "연결 중" };
  }
  if (connection === "offline") {
    return {
      kind: "pending",
      message: "오프라인 · 이 기기에 보관 중이며 연결되면 자동으로 합쳐집니다.",
      shortMessage: "오프라인",
    };
  }
  if (connection === "connecting") {
    return { kind: "pending", message: "연결 중… 입력은 이 기기에 보관됩니다.", shortMessage: "연결 중" };
  }
  if (connection === "paused" && (input.manual || autosave === "idle" || autosave === "saved")) {
    // 쉬기 전에 room에 모두 보냈다(보낼 것이 있으면 쉬지 않는다). 입력하면 바로 다시 붙는다.
    return { kind: "saved", message: "보관됨 · 잠시 연결을 쉬는 중이며 입력하면 바로 이어집니다", shortMessage: "쉬는 중" };
  }
  if (input.manual) {
    return {
      kind: "saved",
      message: connection === "solo" ? "이 기기에 보관 중" : "작성 내용이 실시간으로 보관됩니다",
      shortMessage: "보관됨",
    };
  }
  if (!isSaver) {
    return { kind: "saved", message: "실시간 연결됨 · 함께 연 기기에서 저장합니다", shortMessage: "실시간" };
  }
  switch (autosave) {
    case "error":
      return { kind: "error", message: input.autosaveError ?? "저장하지 못했습니다.", shortMessage: "저장 실패" };
    case "blocked":
      return { kind: "blocked", message: input.blockedMessage, shortMessage: "저장 대기" };
    case "saving":
      return { kind: "saving", message: "저장 중", shortMessage: "저장 중" };
    case "pending":
      return { kind: "pending", message: "곧 저장됩니다", shortMessage: "저장 대기" };
    default:
      return {
        kind: "saved",
        message: connection === "solo" ? "저장됨" : "저장됨 · 실시간 연결됨",
        shortMessage: "저장됨",
      };
  }
}
