import { bytesToHex } from "@noble/hashes/utils";

type SecureRandomSource = Partial<Pick<Crypto, "randomUUID" | "getRandomValues">>;

/** UUID v4 using browser CSPRNGs, including origins without randomUUID(). */
export function createSecureUuid(source: SecureRandomSource | undefined = globalThis.crypto): string {
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  if (typeof source?.getRandomValues !== "function") {
    throw new Error("안전한 요청 식별자를 만들 수 없습니다.");
  }

  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
