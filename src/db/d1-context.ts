import { drizzle, type AnyD1Database } from "drizzle-orm/d1";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";

/** request AsyncLocalStorage가 없는 scheduled event용 explicit D1 context다. */
export function createD1DbContext(
  binding: AnyD1Database,
): Extract<DbContext, { kind: "d1" }> {
  return {
    kind: "d1",
    db: drizzle(binding, { schema }),
  };
}
