import { drizzle, type AnyD1Database, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type D1DrizzleDb = DrizzleD1Database<typeof schema> & {
  $client: AnyD1Database;
};

/**
 * drizzle(..., { schema })는 부를 때마다 schema 전체의 관계 설정을 새로 만든다(호출당 약 1ms CPU).
 * 페이지 하나가 데이터 함수마다 createDb()를 불러 요청당 여러 번이 되므로, 같은 바인딩이면 만든
 * 인스턴스를 다시 쓴다. Drizzle DB 객체는 질의마다 새 builder를 만들 뿐 요청별 상태가 없다.
 * WeakMap 키라 바인딩이 바뀌면 새로 만들고 옛 것은 함께 수거된다.
 * worker.ts(scheduled)와 createDbContext가 함께 쓰므로 OpenNext·로컬 SQLite 의존을 두지 않는다.
 */
const byBinding = new WeakMap<AnyD1Database, D1DrizzleDb>();

export function d1DrizzleFor(binding: AnyD1Database): D1DrizzleDb {
  const cached = byBinding.get(binding);
  if (cached) return cached;
  const db = drizzle(binding, { schema });
  byBinding.set(binding, db);
  return db;
}
