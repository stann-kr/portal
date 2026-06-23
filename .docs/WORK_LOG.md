# WORK_LOG

## 2026-06-23 03:14 KST — portal 상태/배포준비/Codex 5.5 조사

Summary
- Hermes가 repo 문맥과 문서를 수집한 뒤 Codex 5.5로 현재 상태, 배포 준비도, 테스트 접근 단서를 read-only 조사했다.
- 결론은 `NOT_READY`.
- 가장 중요한 blocker는 `note_date` migration 누락 가능성, fresh Docker 검증 부재, env/docs 불일치, dev용 하드코딩 관리자 기본 자격증명 잔존.

Evidence highlights
- repo 상태: dirty working tree (`dev` branch)
- Docker: daemon 비활성으로 `docker compose ps` 실패
- schema: `src/db/schema.ts`에 `privateNotes.noteDate -> note_date` 존재
- drizzle: 해당 컬럼 추가 migration 파일 확인 실패
- docs mismatch:
  - 루트 README는 기본 Next.js/Vercel 템플릿
  - 실제 배포는 OpenNext + Cloudflare Workers + `portal.stann.kr`
- test access clue:
  - `seed_admin.ts`, `dev.sh`에 dev 기본 관리자 자격증명 하드코딩 존재

Outputs
- canonical note 작성: [[DEPLOYMENT-READINESS-2026-06-23]]
- follow-up audit note 작성: [[IMPROVEMENT-AUDIT-2026-06-23]]

Recommended next actions
1. `note_date` migration 생성/적용
2. `.ics` 구독 정책 수정
3. 학생 포털 커뮤니티 작성 흐름 수정
4. Docker 기반 lint/typecheck/build/build:worker 재검증
5. working tree 정리
6. dev 기본 관리자 자격증명 제거 또는 dev-only 격리
7. `.env.example` / `.docs/README.md` / 루트 README 정합화

## 2026-06-23 later — 개선 / 추가 / 검증 audit

Summary
- 사용자가 "프로젝트 조사해서 더 개선, 추가, 검증 할건 없는지 싹 봐줘"라고 요청해 추가 audit 수행.
- Codex 5.5를 구조/리스크 리뷰에 사용했고, agy로 UI/UX 시각에서 빠른 점검을 추가했다.
- Claude Code Opus 사용도 시도했으나, `auth status`는 로그인처럼 보였지만 실제 `claude -p ... --model opus`는 401로 실패했다.

Confirmed high-priority findings
- `private_notes.note_date` migration 누락
- `.ics` 구독 API의 admin-only 의존으로 학생/캘린더 앱 구독 흐름 위험
- 학생 포털 커뮤니티 인라인 작성 성공 처리/redirect 흐름 충돌
- drizzle migration SQL과 meta journal 불일치
- dirty worktree로 실제 배포 범위 모호

Additional notes
- local `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run build:worker`는 모두 통과
- `npm audit --omit=dev --audit-level=moderate`는 Next 번들 경로의 postcss moderate 2건 보고
- 이후 실제 수정으로 다음 3개를 반영함:
  - `drizzle/0007_private_notes_note_date.sql` 추가
  - signed `.ics` feed URL + route 검증 도입
  - 학생 포털 커뮤니티 인라인 작성 성공 처리/redirect 분기 수정
- migration 검증 상태:
  - fresh SQLite 시뮬레이션에서는 `0000`~`0007` 전체 순차 적용 성공
  - 현재 로컬 Wrangler D1은 이미 `note_date` 컬럼이 선반영된 상태라 `npm run db:migrate` 시 `duplicate column name: note_date` 발생
- 별도 상세 정리는 [[IMPROVEMENT-AUDIT-2026-06-23]] 참고
