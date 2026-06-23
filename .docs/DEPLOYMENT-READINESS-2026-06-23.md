# portal — 상태 / 배포 준비 / 테스트 접근 단서 (2026-06-23)

작성: Hermes orchestration + Codex 5.5 조사
원본 repo: `/Users/stann/Dev/portal`
조사 시각: 2026-06-23 03:14:36 KST

## Executive summary
- 현재 portal 프로젝트는 LMS/커뮤니티/Q&A/노트/디깅/캘린더/학생·어드민 포털 등 기능 폭은 넓게 구현되어 있다.
- 그러나 현재 시점 배포 준비도는 `NOT_READY`로 판단한다.
- 가장 큰 이유는 다음 5가지:
  1. working tree가 크게 dirty 상태
  2. Docker daemon 비활성 상태라 fresh lint/typecheck/build:worker 재검증을 못 함
  3. `private_notes.note_date` 스키마 추가에 대응하는 drizzle migration 파일이 보이지 않음
  4. env example / repo docs / 실제 환경 키 구성이 서로 어긋남
  5. dev용 관리자 기본 자격증명이 repo 스크립트에 그대로 남아 있음

## 1) 현재 구현 상태
### 확인된 구현 범위
- 인증: NextAuth Credentials + bcrypt 비교 기반 로그인
- 권한: admin / student role 분리 + middleware 보호 라우트
- DB: Cloudflare D1 + Drizzle
- 파일 업로드: Cloudflare R2 presigned upload 패턴 사용
- 배포 타깃: OpenNext + Cloudflare Workers
- 최근 기능/수정 범위:
  - FullEditor 전환
  - 학생/어드민 원페이지 포털 리팩터
  - Q&A 첨부 업로드
  - 노트/Q&A draft autosave
  - sanitize/authz/XSS 보강
  - 학생 포털 검색/탭 상태 유지

### 현재 repo 상태
- branch: `dev`
- 상태: dirty working tree
- 확인된 시그널:
  - 수정 파일 다수
  - 삭제 파일 2개
  - untracked 파일 다수
- 즉, 아직 커밋/정리 전 작업 중 상태로 보는 것이 안전함

### 검증 상태
- 과거 `WORK_LOG.md`에는 2026-06-20 기준 lint/typecheck/build green 기록이 있음
- 하지만 2026-06-23 현재 변경분까지 포함한 fresh Docker 검증은 이번 조사 시점에 수행되지 못함
- 원인: `docker compose ps`가 Docker daemon 연결 실패로 종료
- 따라서 현재 green 상태를 단정하면 안 됨

## 2) 배포 전에 진행해야 하는 것
### P0 — 실제 blocker
1. `note_date` migration 누락 여부 해결
- `src/db/schema.ts`에는 `privateNotes.noteDate -> note_date` 컬럼이 존재함
- 그런데 `drizzle/` 아래에는 이 컬럼을 추가하는 migration 파일이 확인되지 않음
- 이 상태로 기존 DB에 배포하면 note insert 경로에서 런타임 실패 가능성 있음
- 해야 할 일:
  - migration 생성
  - local / remote 적용 여부 확인
  - note 생성 플로우 재검증

2. fresh 검증 실행
- Docker daemon부터 정상화
- 그 뒤 최소 아래 4개 재실행 필요:
  - `docker compose run --rm web npm run lint`
  - `docker compose run --rm web npx tsc --noEmit`
  - `docker compose run --rm web npm run build`
  - `docker compose run --rm web npm run build:worker`
- 가능하면 추가:
  - `docker compose run --rm web npm audit --omit=dev --audit-level=moderate`

3. working tree 정리
- 현재 어떤 변경을 이번 배포에 포함할지 범위를 확정해야 함
- 특히 untracked 신규 파일(에디터, admin-portal, Note/QnA slide form, hooks 등) 포함 여부 명시 필요
- 배포 전에는 최소한 “이번 릴리스 범위” 기준으로 diff를 안정화해야 함

### P1 — 문서/설정 정합화
4. env 문서 정리
- `.docs/README.md`는 `DATABASE_URL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`를 언급
- `.env.example`는 R2 / Google 중심으로 작성되어 있음
- 실제 `.env.local`에서 이번 조사로 키 이름만 확인된 항목:
  - `AUTH_SECRET`
  - `NEXT_PUBLIC_R2_DEV_URL`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI`
- 해야 할 일:
  - 실제 런타임 필요 키 목록 확정
  - `.env.example`와 `.docs/README.md` 동기화
  - local/dev/prod 용도 구분 명확화

5. 루트 README 갱신
- 현재 `/Users/stann/Dev/portal/README.md`는 create-next-app 기본 템플릿 상태
- 실제 프로젝트는:
  - localhost 3004 사용
  - Docker 개발 흐름 사용
  - Cloudflare Workers + OpenNext 배포
  - custom domain `portal.stann.kr`
- 즉 onboarding 문서로는 사실상 잘못된 상태

### P2 — 보안/운영 hygiene
6. 하드코딩 관리자 기본 자격증명 제거 또는 dev-only 명시 강화
- 아래 기본 관리자 자격증명이 repo에 남아 있음:
  - email: `admin@stannlumo.com`
  - password: `adminpassword123!`
- 용도상 dev/test seed default로 보이지만, 배포 전엔 최소 아래 중 하나 필요:
  - 제거
  - 문서상 dev-only로 강하게 명시
  - 운영 환경에서는 절대 사용하지 않도록 분리

7. build 시 lint 우회 상태 재검토
- `next.config.ts`에서 build 중 ESLint를 무시하고 있음
- 즉 `npm run build` 성공만으로 lint clean을 보장하지 않음
- release gate를 분리해서 운영할지, build 전에 lint mandatory로 둘지 결정 필요

## 3) 테스트용 임시 비밀번호 / 계정 단서
주의: 아래 값들은 repo 내부에 하드코딩된 dev/test default로 보이며, 운영 비밀번호로 간주하면 안 됨.

### 하드코딩된 기본값
1. `seed_admin.ts`
- path: `/Users/stann/Dev/portal/seed_admin.ts`
- 확인 내용:
  - admin email: `admin@stannlumo.com`
  - admin password: `adminpassword123!`
- 비고:
  - 파일 내 주석상 “실제 사용시 변경 필수” 문구 존재

2. `dev.sh`
- path: `/Users/stann/Dev/portal/dev.sh`
- `./dev.sh seed` 기본 인자:
  - email 기본값: `admin@stannlumo.com`
  - password 기본값: `adminpassword123!`
  - displayName 기본값: `Stann`

### 생성형 / 수동형 관리자 생성 흐름
3. `src/scripts/setup-admin.ts`
- path: `/Users/stann/Dev/portal/src/scripts/setup-admin.ts`
- 특징:
  - email/password를 CLI 인자로 받음
  - bcrypt hash 생성 후 profiles upsert SQL 생성
  - `--exec`로 로컬 Wrangler SQLite에 직접 반영 가능
- 의미:
  - 이 스크립트 자체엔 고정 비밀번호가 없고, 실행 시 넘기는 값으로 생성함

## 4) 배포/인프라 관련 확인 메모
### 현재 확인된 설정
- `docker-compose.yml`
  - 개발 포트: `3004:3004`
  - `NODE_ENV=development`
  - `.env.local` 주입
- `wrangler.toml`
  - worker name: `portal`
  - main: `.open-next/worker.js`
  - compatibility_date: `2024-11-18`
  - `nodejs_compat` 활성화
  - D1 binding: `DB`
  - D1 database_name: `portal-db`
  - R2 binding: `BUCKET`
  - AUTH_URL: `https://portal.stann.kr`
  - route: `portal.stann.kr`

### 중요한 모순
- 루트 README는 기본 Next.js/Vercel 문서
- 실제 설정은 Docker + Cloudflare Workers/OpenNext
- `.docs/README.md`의 env 설명도 현재 코드/실환경과 완전히 맞지 않을 가능성이 큼

## 5) 최종 판단
판정: `NOT_READY`

이유:
- 기능 자체는 많이 만들어져 있지만, “배포 가능 상태”와 “구현이 많이 되어 있음”은 다름
- 현재는 DB migration 공백 가능성, 문서/환경 정합성 부족, dev 자격증명 잔존, fresh verification 부재가 동시에 존재함
- 즉 다음 배포는 코드 구현보다도 release hardening / verification / docs cleanup 작업이 먼저임

## 6) 바로 다음 액션 추천
1. `note_date` migration 생성/적용 확인
2. Docker daemon 켜고 lint/typecheck/build/build:worker 재검증
3. 이번 배포 범위 기준 working tree 정리
4. dev seed credential 제거 또는 dev-only 격리
5. `.env.example`, `.docs/README.md`, 루트 `README.md` 정리
6. 필요하면 이후 결과를 바탕으로 이 노트를 `DEPLOYMENT-READINESS` canonical note로 계속 업데이트

## 7) 조사 근거 파일
- `/Users/stann/Dev/portal/package.json`
- `/Users/stann/Dev/portal/next.config.ts`
- `/Users/stann/Dev/portal/docker-compose.yml`
- `/Users/stann/Dev/portal/wrangler.toml`
- `/Users/stann/Dev/portal/.env.example`
- `/Users/stann/Dev/portal/.docs/README.md`
- `/Users/stann/Dev/portal/.docs/REQUIREMENTS.md`
- `/Users/stann/Dev/portal/.docs/TROUBLESHOOTING.md`
- `/Users/stann/Dev/portal/.docs/phases/PHASE_PROGRESS.md`
- `/Users/stann/Dev/portal/WORK_LOG.md`
- `/Users/stann/Dev/portal/seed_admin.ts`
- `/Users/stann/Dev/portal/dev.sh`
- `/Users/stann/Dev/portal/src/scripts/setup-admin.ts`
- `/Users/stann/Dev/portal/src/db/schema.ts`
