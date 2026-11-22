import { sql } from "drizzle-orm";

/**
 * 관리자 목록 줄의 "읽음 N"용 상관 subquery(0034 `post_reads`). 수강 중인 학생만 센다
 * (수강 종료한 학생의 기록은 남겨 두고 세지 않는다). `posts`를 FROM에 둔 select에서만 쓴다.
 * Drizzle의 sql`` 열 보간은 표 이름 없이 그려져 안쪽 표의 열로 묶이므로, 바깥 `posts`를 문자 그대로 적는다.
 */
export function postReadCountSql() {
  return sql<number>`(
    SELECT count(*) FROM post_reads AS read_row
    JOIN profiles AS reader ON reader.id = read_row.student_id
    WHERE read_row.post_id = "posts"."id"
      AND reader.role = 'student'
      AND reader.account_status = 'ACTIVE'
  )`.mapWith(Number);
}
