import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/**
 * 로그인 session을 발급 당시의 비밀번호 hash에 결합하는 짧은 지문.
 * 비밀번호가 바뀌면 hash와 함께 지문이 달라져 다른 기기의 기존 session을 거부할 수 있다.
 * bcrypt salt를 포함한 hash 원문은 token에 넣지 않으며, JWT 자체도 암호화되어 있다.
 */
export function credentialFingerprint(passwordHash: string | null | undefined): string | null {
  if (!passwordHash) return null;
  return bytesToHex(sha256(utf8ToBytes(`portal-session-credential:v1:${passwordHash}`))).slice(0, 32);
}
