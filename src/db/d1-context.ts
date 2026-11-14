import type { AnyD1Database } from "drizzle-orm/d1";
import type { DbContext } from "@/db/client";
import { d1DrizzleFor } from "@/db/d1-drizzle";

/** request AsyncLocalStorage가 없는 scheduled event용 explicit D1 context다. */
export function createD1DbContext(
  binding: AnyD1Database,
): Extract<DbContext, { kind: "d1" }> {
  return {
    kind: "d1",
    db: d1DrizzleFor(binding),
  };
}
