# portal — 개선 / 추가 / 검증 audit (2026-06-23)

작성: Hermes + Codex 5.5 + agy(UI review 일부)
대상 repo: `/Users/stann/Dev/portal`
브랜치: `dev`

## TL;DR
- 현재 프로젝트는 로컬 기준 `lint`, `tsc --noEmit`, `build`, `build:worker`까지는 통과한다.
- 이후 실제 수정으로 `note_date` migration 파일, signed `.ics` feed 접근, 학생 포털 커뮤니티 작성 흐름 분기까지 반영했다.
- 즉 “깨진 상태”는 아니지만, 아직 “건강한 배포 후보”라고 보긴 이르다.
- 가장 중요한 잔여 이슈는 문서/환경 정합성, dirty tree 정리, migration 메타/로컬 DB 상태 정리, 테스트 자동화 부족 쪽이다.

## 이미 좋은 점
- 학생/관리자 포털이 역할 기반으로 분기되고, 라우트 구조가 비교적 명확함.
- Q&A 첨부 업로드, 노트/Q&A draft autosave, 학생 포털 검색/탭 유지까지 최근 UX 개선이 반영됨.
- 커뮤니티/노트/Q&A 서버 액션 전반에 auth 체크와 sanitize 적용이 들어가 있음.
- OpenNext 기반 `build:worker`까지 현재 체크아웃에서 성공함.

## MUST_FIX
1. Drizzle migration 메타 / 로컬 DB 상태 정리
- `drizzle/0007_private_notes_note_date.sql`는 추가되었고 fresh SQLite 시뮬레이션에서는 정상 적용 확인.
- 다만 현재 로컬 Wrangler D1에는 `note_date` 컬럼이 이미 선반영되어 있어 `npm run db:migrate` 시 중복 컬럼 오류가 남는다.
- 또한 `drizzle/meta/_journal.json`은 여전히 `0002`까지만 기록되어 있어 generate 워크플로우 정리가 필요하다.

2. dirty working tree 정리 필요
- 변경 파일과 신규 파일가 많아 실제 배포 범위/검증 범위가 불명확함.
- 기능 묶음 단위로 정리하지 않으면 회귀 원인 추적이 어려워짐.

3. 문서/환경 변수 정합성 회복
- 루트 `README.md`는 아직 기본 Next.js 템플릿 성격.
- `.env.example`, `.docs/README.md`, 실제 Cloudflare/OpenNext/D1/R2 구성이 서로 정확히 맞지 않음.

4. dev 기본 관리자 자격증명 제거/격리
- `dev.sh`와 관련 seed 경로에 dev 기본 계정이 남아 있음.
- 최소한 dev-only, 명시적 플래그, 필수 인자화 중 하나는 필요.

5. 테스트 레이어 부재
- 현재 검증은 lint/type/build 위주라서,
- authz regression, migration regression, server action 성공/실패 분기, student/admin 핵심 플로우를 충분히 보호하지 못함.

## SHOULD_FIX
1. 업로드 정책 강화
- `src/lib/actions/upload.ts`가 호출자 옵션에 많이 의존함.
- prefix allowlist, 파일 크기 상한, MIME 제한, role별 정책을 서버에서 더 강하게 고정하는 편이 안전함.

2. 노트 삭제 권한 의미 재검토
- `deletePrivateNote()`는 `authorId` 기준으로 권한 검사.
- 정책이 “작성자 또는 관리자”면 맞지만, “해당 학생의 노트 소유권” 개념이 있으면 재정의 필요.

3. 함수 단위 authz 경계 강화
- 예: `getFeedbacksByAssignment()` 같은 함수는 호출 경로에 기대기보다 함수 자체도 소유권/역할 검증을 갖는 편이 안전함.

4. 문서/환경 변수 정합성 회복
- 루트 `README.md`는 아직 기본 Next.js 템플릿 성격.
- `.env.example`, `.docs/README.md`, 실제 Cloudflare/OpenNext/D1/R2 구성이 서로 정확히 맞지 않음.

5. dev 기본 관리자 자격증명 제거/격리
- `dev.sh`와 관련 seed 경로에 dev 기본 계정이 남아 있음.
- 최소한 dev-only, 명시적 플래그, 필수 인자화 중 하나는 필요.

6. 테스트 레이어 부재
- 현재 검증은 lint/type/build 위주라서,
  - authz regression
  - migration regression
  - server action 성공/실패 분기
  - student/admin 핵심 플로우
를 보호하지 못함.

## NICE_TO_HAVE / 추가하면 좋은 것
1. 프로필 이미지 / 본인 비밀번호 변경
- 현재 요구사항 문서에도 잔여 항목으로 보임.

2. 알림 시스템
- 새 피드백, 새 Q&A 답변, 레슨 일정 변경, 커뮤니티 새 글 알림 가치가 큼.

3. 학생 포털 내 작성 경험 정합화
- 커뮤니티/노트/Q&A 모두 “슬라이드 패널 + autosave + 성공 피드백 + 제출 후 복귀” 패턴을 완전히 통일하면 좋음.

4. 모바일 최적화 마감
- agy 검토상 모바일/좁은 폭에서 표/복합 패널/상세 뷰 일관성 확인이 더 필요함.

5. autosave 가시성
- 지금은 저장은 되지만 “임시저장됨 / 복원됨 / 제출 후 삭제됨” 같은 사용자 피드백이 약함.

## STILL_TO_VERIFY
1. Docker daemon 켠 뒤 fresh 검증
- `docker compose run --rm web npm run lint`
- `docker compose run --rm web npx tsc --noEmit`
- `docker compose run --rm web npm run build`
- `docker compose run --rm web npm run build:worker`
- `docker compose run --rm web npm run db:migrate`

2. 브라우저 smoke test
- 학생 로그인
- 관리자 로그인
- 학생 생성
- 노트 작성/삭제
- Q&A 질문/답변/첨부
- 학생 포털 내부 커뮤니티 작성
- `.ics` 구독 URL 실사용
- R2 업로드 성공/권한 실패 케이스

3. 회귀 테스트 최소 세트
- migration smoke
- auth guard/server action unit or integration tests
- Playwright 수준의 로그인/노트/Q&A happy path

## 추천 우선순위
### 이번 주에 바로 할 것
1. `note_date` migration 정리
2. `.ics` 접근 정책 수정
3. 포털 커뮤니티 작성 흐름 수정
4. dirty tree 정리 + 기능 단위 검증 재실행

### 그 다음
5. 업로드 정책 강화
6. 문서/env 정합성 회복
7. 최소 테스트 레이어 추가

### 이후 UX 투자
8. autosave 상태 표시
9. 모바일 polish
10. 알림 시스템 / 프로필 관리 기능

## 이번 audit에서 참고한 외부 리뷰
- Codex 5.5: 코드/배포/리스크 구조 리뷰
- agy: UI/UX 관점의 빠른 상태 확인
- Claude Opus: 사용 시도했으나 현재 CLI 토큰 401로 실사용 불가 (`auth status`와 실제 API 상태 불일치)
