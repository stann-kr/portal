import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { createSecureUuid } from "./secure-uuid";

export const CREATION_OPERATION_FIELD = "operationId";

const CREATION_OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** 새 문서 생성 의도를 브라우저 초안과 서버 쓰기 사이에서 안정적으로 연결한다. */
export function createCreationOperationId(): string {
  return createSecureUuid();
}

/** 외부 입력은 브라우저가 생성하는 UUID v4만 허용한다. */
export function parseCreationOperationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return CREATION_OPERATION_ID_PATTERN.test(normalized) ? normalized : null;
}

/** 누락되거나 잘못된 외부 ID를 거부해 재전송 보장이 없는 생성 쓰기를 막는다. */
export function resolveCreationOperationId(value: unknown): string | null {
  return parseCreationOperationId(value);
}

/** SHA-256 domain separation으로 생성 작업에 딸린 결정적 UUID v8을 만든다. */
export function deriveCreationResourceId(
  operationId: string,
  purpose: string,
): string {
  const normalizedOperationId = parseCreationOperationId(operationId);
  if (!normalizedOperationId || !purpose) {
    throw new Error("유효한 문서 생성 식별자와 용도가 필요합니다.");
  }

  const bytes = sha256(utf8ToBytes(`${purpose}\u0000${normalizedOperationId}`)).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
