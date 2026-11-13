import { sql } from "drizzle-orm";
import { profiles } from "@/db/schema";

/**
 * 다른 사용자에게 내려가는 작성자 표시 이름.
 * 이메일 전체를 응답에 싣지 않도록 표시 이름이 없을 때만 `@` 앞부분을 서버에서 잘라 보낸다.
 * `profiles`를 join한 select에서만 쓴다.
 */
export const publicAuthorName = sql<string | null>`coalesce(${profiles.displayName}, nullif(substr(${profiles.email}, 1, instr(${profiles.email}, '@') - 1), ''))`;
