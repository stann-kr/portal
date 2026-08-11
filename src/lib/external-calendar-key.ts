/* eslint-disable @typescript-eslint/no-require-imports */
import { decodeExternalCalendarKey, ExternalCalendarError } from "@/lib/external-calendar";

/** OpenNext Worker binding과 Node development 환경 모두에서 encryption key를 찾는다. */
export function getExternalCalendarEncryptionKey(): Uint8Array {
  let value = process.env.EXTERNAL_CALENDAR_ENCRYPTION_KEY;
  try {
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as {
      getCloudflareContext: () => { env?: Record<string, unknown> };
    };
    const binding = getCloudflareContext()?.env?.EXTERNAL_CALENDAR_ENCRYPTION_KEY;
    if (typeof binding === "string") value = binding;
  } catch {
    // Node runtime에서는 process.env contract를 사용한다.
  }
  if (!value) throw new ExternalCalendarError("External calendar encryption key is unavailable");
  return decodeExternalCalendarKey(value);
}
