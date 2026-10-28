# 배포 가이드

## 개요

`portal`은 OpenNext for Cloudflare를 통해 Cloudflare Worker로 배포한다. D1 database와 R2 bucket binding을 사용한다.

## 배포 대상

| 항목 | 값 |
|---|---|
| Worker name | `portal` |
| Custom domain | `portal.stann.kr` |
| Worker entry | `worker.ts` (OpenNext fetch 합성) |
| Scheduled production entry | `worker.ts` (`wrangler.scheduled.toml`) |
| Maintenance entry | `src/workers/maintenance.ts` (`wrangler.maintenance.toml`) |
| Static assets binding | `ASSETS` |
| D1 binding | `DB` |
| D1 database | `portal-db` |
| R2 binding | `BUCKET` |
| R2 bucket | `portal-storage` |
| Rate Limiting | `ACCOUNT_CLEANUP_RATE_LIMITER`(익명 정리 상태 조회, 분당 30회), `PASSWORD_ATTEMPT_RATE_LIMITER`(비밀번호 확인, 접속 주소·용도별 분당 10회) |

현재 source-controlled Wrangler 설정은 production Worker `portal`만 정의한다. 별도 development Worker·D1·R2 설정과 branch별 Workers Builds trigger는 저장소에서 확인되지 않으므로, 중앙 배포 계약의 development/production 분리는 아직 완료됐다고 볼 수 없다. remote 설정을 확인하거나 바꾸는 작업은 별도 승인 범위다.

## 운영 상태 확인 기준

이 문서의 설정과 검증 조건은 저장소의 코드 계약이다. 현재 운영 상태는 대상 환경,
확인 시각, commit SHA와 실제 Worker version을 함께 대조해 비공개 운영 기록에 남긴다.
과거 배포 기록이나 로컬 build 성공만으로 오늘의 migration·Cron·기능 활성화를 판정하지 않는다.

| 항목 | 저장소에서 확인할 수 있는 것 | 운영 적용을 확인하는 증거 |
|---|---|---|
| D1 migration | SQL·journal·snapshot `0000~0019`, 메모리 DB에서 체인·schema 검증 | 대상 D1의 적용 목록과 실제 schema·FK, 그 목록에서 계산한 pending 범위 |
| 계정 삭제 | `0012`와 삭제·정리 구현, application 설정의 `ACCOUNT_DELETION_ENABLED="false"` 기본값 | 활성 Worker의 유효 flag, 기기 adoption, 승인된 삭제·정리 smoke |
| 예약 정리 | `worker.ts`의 `scheduled` handler, Workers Logs 설정, source에 없는 Cron trigger | 원격 trigger 주기, 대상 version의 실제 scheduled invocation, backlog·실패·alert 증거 |
| 외부 캘린더 | `0013` 구독 테이블과 `EXTERNAL_CALENDAR_ENCRYPTION_KEY` 요구 조건 | 대상 schema, secret 설정 확인, 승인된 연결·읽기·교체·해제 smoke |
| 본문 이미지·업로드 | `0014`의 `DOCUMENT_IMAGE`·`PRIVATE_NOTE` 허용, `PUT /api/media/upload/[id]`와 `BUCKET` binding 사용(R2 S3 secret 불필요) | 대상 D1의 `0014` 적용, 활성 Worker의 `BUCKET` binding, 승인된 업로드·표시·권한 smoke |
| 과제 출제·정기 과제 | `0015`의 `assignment_tasks`·`assignment_recurrences`와 `assignments`·`feedbacks` 행 보존 rebuild, 조회 시 회차 생성(Cron 불필요) | 대상 D1의 `0015` 적용과 기존 제출·피드백 row count, 승인된 출제·제출·피드백 smoke |
| 공용 가이드 | `0016`의 `guide_pages`·`guide_assets`·`qna_guide_anchors`, `scripts/guide-import/build.ts` seed 출력 | 대상 D1의 `0016` 적용, 승인된 seed 적용(D1 행·R2 `guide/` 객체), 학생·관리자 열람·편집·질문 smoke |
| 캘린더 양방향 동기화 | `0017` 연결·매핑·link·반복 일정 table, `GOOGLE_CALENDAR_CLIENT_ID`·`GOOGLE_CALENDAR_CLIENT_SECRET`·`EXTERNAL_CALENDAR_ENCRYPTION_KEY` 요구 조건, `AUTH_URL` 기준 redirect URI | 대상 schema, secret 설정 확인, Google Cloud OAuth client의 redirect URI, 승인된 연결·매핑·양방향 반영·해제 smoke |
| 캘린더 실시간 반영 | `0018` 알림 채널 table, `/api/calendar-connections/google/notify`, `worker.ts` `scheduled`의 캘린더 동기화. source에 없는 Cron trigger | 원격 Cron 주기, 대상 version의 실제 scheduled invocation, Google 채널 등록·갱신과 알림 수신 로그 |
| 배포 환경 분리 | 현재 tracked 설정의 Worker는 `portal` | development/production Worker·D1·R2·route·secret·branch trigger 각각의 inventory |

운영 확인은 기존 상태 조회, migration·secret·trigger 변경, 데이터 쓰기 smoke를 구분해 승인된
범위에서 수행한다. secret·캘린더 URL·학생 본문은 확인 기록에 넣지 않는다.

## 사전 체크리스트

- build·upload 환경은 Node.js 22 이상이어야 한다.
- Wrangler 인증이 유효해야 한다.
- Wrangler user API token은 `.env.cloudflare.example`을 참고해 Git에서 제외된 `.env.cloudflare`에 mode `600`으로 보관하고, 원격 명령 직전에만 source한다. Next/OpenNext가 자동 로드하는 `.env`·`.env.local`에 두면 server build artifact에 포함될 수 있으므로 금지한다.
- D1 database와 R2 bucket이 존재해야 한다.
- 대상 Worker를 promotion하기 전에는 승인된 작업 창에서 실제 pending migration을 적용·검증해야 한다. 비호환 migration은 maintenance 진입 전에 미리 적용하지 않는다.
- auth secret과 기타 secret은 배포 환경에만 설정한다.
- 외부 공개 레슨 캘린더를 활성화하려면 `EXTERNAL_CALENDAR_ENCRYPTION_KEY`를 32-byte base64 또는 base64url secret으로 환경마다 안정적으로 설정한다. 값 자체는 저장소·문서·로그에 남기지 않으며, 기존 구독이 있으면 key를 임의로 교체하지 않는다. `0013` migration 적용과 key 설정 전에는 연결 기능을 운영에 사용하지 않는다.
- production deploy 전 admin/student smoke 계정과 test data를 준비한다.
- Cloudflare Workers Builds를 기본 배포 주체로 사용하고 development는 `dev`, production은 `main` push만 고정 Worker 배포를 시작하도록 분리한다. 두 환경의 Worker, binding, secret, D1, R2와 route를 공유하지 않는다.
- trigger branch, required release gate, 예상 commit SHA, Active Deployment와 대상 URL smoke를 확인하기 전에는 배포 성공을 보고하지 않는다.
- 현재 저장소에는 development 설정이 없으므로 feature/fix branch를 `dev`에 통합해도 development 자동 배포를 가정하지 않는다. remote trigger와 resource 분리가 확인될 때까지 `BLOCKED`로 다룬다.
- 비호환 migration 작업 창에는 자동 promotion을 중지하거나 upload-only 절차로 전환한다.
- OpenNext Cloudflare 빌드는 지원 기간이 끝난 Next.js major를 거부한다. 2026-10-26에 Next.js 15.5.22 → 16.4.3, OpenNext 1.20, wrangler 4.152로 올렸고 플래그 없이 빌드한다. 인증 관문은 `src/proxy.ts`(Next 16 proxy, Node.js runtime)로 옮겼다. OpenNext Cloudflare 1.20은 이를 Node.js middleware로 묶으며 빌드 때 "experimental, not officially maintained" 경고를 낸다. 운영 동형 로컬(wrangler dev)에서 비로그인 차단·로그인·역할 이동·세션 갱신·mutation 요청의 갱신 cookie 제거·로그아웃을 확인했다(2026-10-26). 출시 뒤 운영 smoke에서 같은 흐름을 다시 확인하고, 문제가 생기면 `src/middleware.ts`로 되돌리는 commit 하나로 복구한다.
- 본문 이미지·Worker 업로드 코드는 `0014`가 필요하다. `0014`는 `media_objects`의 허용 값을 넓히는 table rebuild라 기존 코드와 호환되므로 promotion 전에 먼저 적용한다.
- 과제 출제·가이드·캘린더 양방향 동기화 코드는 `0015`·`0016`·`0017`이 필요하다. 세 migration은 열을 지우거나 CHECK를 좁히지 않아(열 추가·nullable 전환·허용 값 확장·새 table) 이전 Worker와 schema가 호환되므로 promotion 전에 먼저 적용한다. 다만 `0015`는 실제 제출이 있는 `assignments`·`feedbacks`를, `0016`은 `document_server_drafts`를 행 보존 table rebuild하므로 적용 직전 export·checksum·Time Travel bookmark를 확보한다. 이전 Worker 코드는 링크 없는 제출(글 제출)을 고려하지 않으므로, 새 Worker에서 글 제출이 생긴 뒤 이전 Worker로 되돌리는 경우 과제 화면을 다시 확인한다.

### 외부 캘린더 전환 gate

연결 상태 조회와 연결·해제 action은 `external_calendar_subscriptions`를 사용한다.
구독자가 아직 없어도 해당 테이블이 필요하므로, 이 코드를 포함한 Worker를 promotion하기 전에
대상 D1에 `0013`이 적용됐는지 확인한다.

1. 대상 D1의 실제 적용 목록을 확인하고 pending 범위를 확정한다. 기존 적용 migration을 추정해 다시 실행하지 않는다.
2. pending이 있으면 승인된 작업 창에서 호환성·백업·복구 조건을 확인하고 적용한 뒤 schema·FK를 검증한다.
3. 대상 환경의 안정적인 암호화 key를 확인한다. 기존 구독의 복호화에 쓰이는 key는 임의 교체하지 않는다.
4. schema와 secret 조건을 갖춘 target version을 전환하고, 승인된 fixture로 학생·관리자 조회와 연결·교체·해제를 검증한다.

### 캘린더 양방향 동기화 전환 gate

연결 설정 화면(`/dashboard/admin/calendar-sync`)과 레슨·일정 저장 뒤 push는 `0017`의 table을 사용한다.
매핑이 없어도 조회·쓰기 경로가 table을 읽으므로, 이 코드를 포함한 Worker를 promotion하기 전에
대상 D1에 `0015~0017`이 적용됐는지 확인한다.

1. 대상 D1의 실제 적용 목록을 확인하고 pending 범위를 확정한다(`0015 → 0016 → 0017 → 0018` 순서).
2. 승인된 작업 창에서 full export·checksum과 D1 Time Travel bookmark를 확보한 뒤 pending을 순서대로 적용하고 schema·FK·`assignments`·`feedbacks`·`document_server_drafts` row count를 검증한다.
3. 대상 환경의 `EXTERNAL_CALENDAR_ENCRYPTION_KEY`, `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`과 `AUTH_URL`을 확인한다. secret이 없으면 해당 연결 기능만 꺼지고 설정 화면이 "설정 필요"를 안내한다.
4. target version을 전환하고 관리자 연결·학생 매핑·포털 → 외부 반영·외부 → 포털 반영·연결 해제를 승인된 테스트 캘린더로 확인한다. 실제 학생 캘린더로 시험하지 않는다.

### 사용자가 할 클라우드 작업

2026-10-28에 Google Cloud 항목(프로젝트·API·동의 화면·OAuth client)을 완료했다. 나머지는 각각 별도 승인 범위이며 값은 저장소·문서·로그에 남기지 않는다.

Google Calendar 연동:

- [x] Google Cloud Console에서 포털용 프로젝트를 만들거나 고른다(포털 운영 Google 계정의 "Stann Lumo Portal").
- [x] 그 프로젝트에서 Google Calendar API를 사용 설정한다.
- [x] OAuth 동의 화면(Google Auth Platform)을 구성한다(외부, 홈페이지 `https://portal.stann.kr`, 승인된 도메인 `stann.kr`, 개인정보처리방침 `https://portal.stann.kr/privacy`). scope는 `https://www.googleapis.com/auth/calendar.events`와 `https://www.googleapis.com/auth/calendar.calendarlist.readonly` 두 개다(`src/lib/calendar-sync/google.ts` `GOOGLE_CALENDAR_SCOPES`). email·profile scope는 쓰지 않는다.
- [ ] 게시 상태: 개인정보처리방침 링크가 없으면 "앱 게시"가 비활성이라 `/privacy`(로그인 없이 열림)를 배포한 뒤 링크를 등록하고 "프로덕션"으로 게시한다. 게시 전에는 관리자 계정을 테스트 사용자로 둔다. 참고: 게시 상태가 "테스트"이면 테스트 사용자로 관리자 Google 계정을 추가해야 하고, 이 상태에서 받은 refresh token은 짧게(약 7일) 만료될 수 있다. calendar scope는 민감한 scope라 "프로덕션" 게시에는 Google 검증이 필요할 수 있다. 연결 계정이 관리자 한 명뿐이므로 어느 상태로 둘지 콘솔 안내를 확인해 결정한다.
- [x] OAuth client ID를 "웹 애플리케이션" 유형으로 만들고 승인된 redirect URI에 `https://portal.stann.kr/api/calendar-connections/google/callback`을 정확히 넣는다(`wrangler.toml`의 `AUTH_URL` origin + 고정 경로). 로그인용 Google provider client와 섞지 않는다.
- [ ] Worker secret을 등록한다: `npx wrangler secret put GOOGLE_CALENDAR_CLIENT_ID`, `npx wrangler secret put GOOGLE_CALENDAR_CLIENT_SECRET`(값은 프롬프트로만 입력).
- [ ] `EXTERNAL_CALENDAR_ENCRYPTION_KEY`는 위 사전 체크리스트의 기존 항목과 같은 secret이다. 아직 없으면 32-byte 무작위 key를 base64url로 만들어 한 번 등록한다. 이 key는 iCal 구독 URL과 함께 캘린더 연결 token·앱 암호도 복호화하므로, 교체하면 기존 구독이 끊기고 모든 연결이 "다시 연결 필요"가 된다.

iCloud 연동:

- [ ] 연결할 Apple ID에 2단계 인증을 켠다.
- [ ] appleid.apple.com → 로그인 및 보안 → 앱 암호에서 포털용 앱 전용 암호를 만든다. 이 값은 Worker secret이 아니라 관리자 캘린더 동기화 화면에 Apple ID와 함께 입력하며, 포털은 암호화해 저장한다. 앱 암호를 폐기하면 연결이 "다시 연결 필요"가 된다.

데이터베이스와 가이드:

- [ ] 승인된 작업 창에서 export·checksum·Time Travel bookmark를 확보한 뒤 remote D1에 `0015 → 0016 → 0017 → 0018`을 적용한다(`npm run db:migrate:remote`, 위 전환 gate).
- [ ] 디깅 보드 플레이리스트(`0019_digging_playlists`, 새 table만 추가)를 포함한 version을 promotion하기 전에, 승인된 작업 창에서 export·checksum·Time Travel bookmark를 확보하고 remote D1에 `0019`를 적용한 뒤 `digging_playlists` schema·UNIQUE·FK와 기존 table row count를 확인한다. 디깅 화면이 이 table을 읽으므로 적용 전 코드를 올리면 디깅 화면이 실패한다. 기존 행은 바꾸지 않는다.
- [ ] 공용 가이드 seed를 만든다: `npx tsx scripts/guide-import/build.ts`(기본 입력 `.docs/goals/assignments-guide-calendar/guide-export`, 출력 `.wrangler/guide-import`). 스크립트는 D1·R2에 쓰지 않고 `seed.sql`·이미지 객체와 명령만 출력하는 `apply-local.sh`를 만든다. 로컬은 `sh .wrangler/guide-import/apply-local.sh`가 출력한 `--local` 명령을 확인한 뒤 직접 실행한다.
- [ ] remote seed(`wrangler d1 execute portal-db --remote --file=…/seed.sql`과 `wrangler r2 object put portal-storage/guide/<id> --remote …`)는 별도 승인 뒤 `0016` 적용 다음에 한 번만 실행한다. seed는 `INSERT OR IGNORE`라 포털에서 고친 내용을 덮어쓰지 않지만, 포털에서 지운 페이지는 다시 실행하면 되살아난다.

예약 동기화와 Google 변경 알림:

- [ ] Cron Trigger: `wrangler.scheduled.toml`은 의도적으로 `[triggers]`를 두지 않는다. 승인된 전환 뒤 원격에서 주기(예: 10분)를 정해 `wrangler triggers deploy`로 적용한다. 같은 `scheduled` handler가 기존 예약 정리도 실행하므로 아래 "점검·예약 정리 Worker artifact"의 Cron 전제(`0011`·`0012`, private R2·staging lifecycle, legacy inventory, plan 한도·alert)를 함께 확인한다.
- [ ] Google 변경 알림 주소: 코드는 `AUTH_URL` origin + `/api/calendar-connections/google/notify`(https만)로 채널을 등록한다. 운영에서 이 주소로 채널이 등록되는 것은 매핑 저장·예약 동기화가 실행될 때이므로, 실시간 반영 Worker의 production 전환 자체를 별도 승인 항목으로 둔다. 확인 항목: Google 콘솔이 알림 받을 도메인의 소유 확인·등록을 요구하는지 전환 전에 확인한다.

### 비호환 migration 전환 gate

`0010`의 문서 trigger와 새 애플리케이션은 이전 Worker와 양방향 호환되지 않는다. 이전·신규 Worker를 동시에 받는 gradual traffic split을 사용하지 않는다.

1. 원격 migration 적용 목록과 D1 schema·foreign key 무결성을 읽기 전용으로 확인한다.
2. maintenance 진입 전에 full schema+data export와 checksum, D1 Time Travel bookmark를 확보하고 격리 D1에서 **실제 pending 전체 범위**의 restore·migration rehearsal을 통과한다. 이 사본은 rehearsal 입력이며 최종 rollback 기준점은 아니다.
3. maintenance와 target Worker를 upload-only로 준비해 immutable version ID·tag·binding을 기록하고, Workers Builds 자동 promotion과 별도 Cron·queue 등 모든 writer를 중지한다.
4. 쓰기를 거부하는 정확한 maintenance version ID를 100% 적용한다. version metadata 일치, app·asset·API `503`, old/new split 0%를 확인한다.
5. 기존 Worker invocation이 끝날 drain window를 둔 뒤 핵심 row count와 write watermark가 더 이상 변하지 않는지 확인한다.
6. write fence 뒤 full schema+data export를 다시 만들고 checksum과 새 D1 Time Travel bookmark를 기록한다. 이 post-fence 사본만 실제 migration의 rollback 기준점으로 사용한다.
7. 실제 pending migration을 순서대로 적용하고 즉시 schema·trigger·foreign key·핵심 row count를 검증한다.
8. 대상 Worker를 schema smoke 뒤 100% 단일 전환하고 즉시 admin/student 로그인, 게시물·Q&A 생성·복원·purge, media와 계정 삭제 smoke를 수행한다.
9. smoke가 실패하면 보존한 maintenance version ID를 다시 100% 적용하고, 통과하면 작업 창을 종료한다.

maintenance 전에 만든 export/bookmark만으로 복구하면 backup과 write fence 사이의 정상 쓰기를 잃을 수 있다. 장애 시 이전 Worker만 되돌리면 새 schema와도 맞지 않으므로, 쓰기를 계속 차단한 상태에서 post-fence 기준점으로 Worker와 D1을 함께 복구하는 절차가 필요하다.

### R2 private media gate

신규 Q&A 첨부는 application 권한을 확인하는 private delivery가 전제다. 다음 조건이 하나라도 준비되지 않으면 `0011` 대상 Worker를 production에 promotion하지 않는다.

- 신규 managed media용 private bucket을 기존 공개 bucket과 분리하거나, 기존 URL을 registry로 backfill하고 인증 proxy URL로 rewrite한 뒤 public access를 끈다. 단일 bucket의 public access를 유지하면 신규 Q&A 권한을 우회하고, 바로 끄면 기존 URL 첨부가 깨진다.
- bucket CORS는 정확한 portal origin, `PUT`, `Content-Type`, `If-None-Match`만 허용하고 실제 browser preflight와 one-shot PUT을 확인한다.
- `media-upload/` staging prefix에 최대 2일 lifecycle을 적용한다. 만료 직전 시작한 PUT이나 연결 종료 뒤의 remote commit은 application outbox만으로 완전히 회수할 수 없으므로 bucket lifecycle이 최종 안전망이다.
- 만료 registry와 삭제 outbox를 주기적으로 실행하고 backlog·최종 실패를 알리는 scheduler/alert 또는 동등한 운영 절차를 준비한다. 현재 관리자 cleanup control과 사용자 mutation의 bounded retry만으로는 무트래픽 상태의 자동 수렴을 보장하지 않는다.
- final prefix inventory를 registry와 주기적으로 대조한다. `DELETED` 또는 삭제 대기 registry인데 실제 object가 남은 경우 새 repair 작업으로 재삭제해야 한다. Copy 요청은 10분 client timeout, 15분 DB lease, lease 만료 뒤 1시간 recovery grace를 사용하지만, 원격 side effect가 grace 뒤 commit되지 않는다는 강한 storage fence는 아니므로 이 reconciliation을 생략하지 않는다.
- 기존 URL은 승인된 HTTPS origin과 prefix만 inventory한다. trusted legacy R2 key는 backfill 또는 수동 검토 대상으로 분류하고, 외부 URL은 R2 삭제 대상으로 추정하지 않는다.

### 계정 개인정보 수명주기 gate

`0012`는 학생 본인 삭제 job, 기기 정리 digest와 opaque 캘린더 token을 추가한다. 다음 조건을 갖추기 전에는 계정 삭제 기능이 포함된 Worker를 production에 promotion하지 않는다.

- `/api/account-cleanup/status`는 request body와 token digest를 access log에 남기지 않고, same-origin POST·body 상한에 더해 edge rate limit 또는 동등한 abuse 방어를 적용한다. 미등록·활성 digest는 모두 같은 `NO_ACTION` 응답을 사용한다.
- 첫 production 전환에서는 `ACCOUNT_DELETION_ENABLED=false`를 유지한다. 기존 학생 기기가 새 cleanup token을 등록한 adoption 기간과 scheduler 정상 실행을 확인한 뒤 별도 version에서만 `true`로 바꾼다. UI를 숨기는 것과 server action 거부를 함께 유지한다.
- media deletion outbox와 30일이 지난 account raw-ID erasure를 주기적으로 실행하고 backlog·실패를 경보한다. 관리자 수동 control은 비상 수렴 경로이며 scheduler를 대체하지 않는다.
- 신규 캘린더 URL은 `/api/calendar/feed?token=…` 형태만 발급한다. 기존 v1 URL은 active profile이 없으면 거부하지만 외부 calendar client와 과거 log에 이미 복사된 raw ID 자체는 회수할 수 없음을 운영 기록에 남긴다.
- 삭제 smoke는 기존 session endpoint와 read/write/upload 거부, 재로그인 거부, 다른 학생 데이터 불변, persistent-token 현재 기기의 직접 정리, cleanup token quota가 가득 찬 경우와 storage-unavailable memory-only 경로의 삭제 성공·수동 정리 안내, 사전 등록된 오프라인 기기의 재접속 정리, 30일 안의 subject ID 재사용 거부, 30일 경계 전후 aliasing과 second-run no-op을 확인한다.
- 계정에 연결된 managed media는 DB 원문 삭제와 함께 outbox에 들어가지만 R2 물리 삭제는 비동기다. UI와 운영 응답은 outbox가 남아 있는 동안 저장소 삭제 완료를 주장하지 않는다.
- 기존 게시물·Q&A URL이 trusted R2 object를 가리키면 계정 삭제 전에 key를 registry로 backfill하거나 별도 deletion inventory에 보존한다. URL 원문부터 지우면 object key를 복원할 수 없으므로 legacy inventory 없이 계정 삭제 기능을 활성화하지 않는다.

## 점검·예약 정리 Worker artifact

두 별도 설정은 maintenance와 예약 정리 artifact를 독립적으로 검증하는 진입점을 제공한다.

```bash
npm run build:maintenance
npm run build:scheduled
```

- `wrangler.maintenance.toml`은 동일한 `portal` 서비스의 점검용 version을 만든다. D1, R2, asset, application route와 Cron trigger를 포함하지 않는다.
- `wrangler.scheduled.toml`은 OpenNext fetch를 유지하면서 `scheduled` handler를 추가한다. D1과 R2 binding은 event 환경에서 직접 주입하며 request AsyncLocalStorage에 의존하지 않는다.
- scheduled 설정은 source-controlled `[triggers]`와 route를 의도적으로 포함하지 않는다. 따라서 dry-run 또는 upload-only만으로 production Cron이 시작되지 않으며, 승인된 전환 뒤 `wrangler triggers deploy`로 원격 trigger를 별도 적용한다.
- 예약 정리는 계정 raw-ID alias, 만료 media enqueue, 기존 R2 deletion outbox, final prefix inventory reconciliation을 제한된 순차 batch로 처리한다. inventory cursor는 R2 내부 운영 key에만 두며, registry가 없거나 `PENDING_DELETE`·`DELETED`인 managed final object만 재삭제한다. 로그에는 고정된 상태와 집계만 남긴다.
- target entry는 `/api/account-cleanup/status`의 body를 읽기 전에 `ACCOUNT_CLEANUP_RATE_LIMITER`를 호출한다. 동일 Cloudflare 위치의 client address별 분당 30회를 넘으면 `429`, binding 오류면 `503`과 `no-store`로 닫는다.

production Cron을 활성화하기 전에는 Workers plan의 Cron CPU 한도, 실행 주기, log 보존, backlog·실패 alert를 확인한다. `0011`·`0012` migration, private R2·staging lifecycle, legacy inventory가 준비되기 전에 trigger를 추가하지 않는다.

production target config는 Workers Logs와 invocation log를 활성화한다. Cron 주기는 원격 설정에서 확인하고 변경 전 plan의 실행 한도와 예상 부하를 검토한다. trigger가 존재한다는 사실 외에 활성 target version의 실제 실행과 account/media backlog·reconciliation failure를 확인해야 한다. `partial_failure`는 invocation error로 승격되므로 운영 알림은 이 error와 반복 `retry`/backlog를 함께 감시한다.

### 비호환 migration의 immutable version 전환

아래 명령은 승인된 작업 창에서만 실행한다. upload와 100% 전환을 분리하고 version ID를 운영 기록에 보존한다.

```bash
# 점검 version upload-only
npx wrangler versions upload \
  --config wrangler.maintenance.toml \
  --keep-vars \
  --tag "$MAINTENANCE_TAG" \
  --message "migration maintenance fence"

# target application + scheduled handler build와 upload-only
npm run build:worker
npx opennextjs-cloudflare upload \
  --config wrangler.scheduled.toml \
  -- \
  --keep-vars \
  --tag "$TARGET_TAG" \
  --message "schema-compatible target"

# immutable version 확인
npx wrangler versions list --name portal --json
npx wrangler deployments status --name portal --json

# 작업 창 진입과 target 전환은 각각 단일 version 100%
npx wrangler versions deploy "${MAINTENANCE_VERSION_ID}@100%" --name portal -y
npx wrangler versions deploy "${TARGET_VERSION_ID}@100%" --name portal -y
```

점검 version은 `GET`·`HEAD /__portal/maintenance/healthz`와 `readyz`만 `200`으로 응답하고, 나머지 application·asset·API 요청은 method와 무관하게 `503`으로 차단한다. `readyz`의 `applicationReady`는 항상 `false`다. 운영 probe는 HTTP status만 보지 않고 version metadata의 ID와 tag가 비어 있지 않으며 업로드 직후 기록한 maintenance version과 정확히 일치할 때만 준비 완료로 판정한다. migration 작업 중 old/new gradual split, bare `wrangler rollback`, `wrangler deploy`와 자동 promotion을 사용하지 않는다. target 장애 시 점검 version ID를 다시 100% 적용하고 D1·R2 상태를 확인한 뒤 forward-fix한다. Worker version 전환만으로 database나 object storage는 복구되지 않는다.

## 로컬 검증

```bash
npm run quality
npm run build:maintenance
npm run build:scheduled
```

`db:check`는 메모리 SQLite에서 SQL·Drizzle metadata·현재 schema를 비교하며 local·remote D1을 변경하지 않는다.

## D1 migration

Local:

```bash
npm run db:migrate
```

Remote:

```bash
npm run db:migrate:remote
```

Remote migration은 production 데이터에 영향을 줄 수 있으므로 별도 승인 후 실행한다.

## 배포

일반 feature/fix 배포의 기준 경로는 Cloudflare Workers Builds다. feature/fix branch는 `dev`로 통합하고, 검증된 `dev` push는 분리된 development Worker, 명시적으로 승인된 `main` push는 production Worker를 배포해야 한다. 현재 저장소에서는 development Worker와 branch trigger를 확인할 수 없으므로 이 경로는 아직 활성화됐다고 주장하지 않는다.

아래 수동 명령은 중앙 배포 경로의 대체 수단이 아니다. schema와 양방향 호환되는 application 변경을 승인된 운영 복구·전환 작업에서 직접 배포해야 할 때만 사용한다.

```bash
npx opennextjs-cloudflare deploy
```

비호환 migration, 점검 전환 또는 scheduled entry 활성화에는 이 명령을 사용하지 않고 위의 upload-only·immutable version 절차를 따른다.

## 배포 후 확인

- `/login` 접속과 credentials login 확인.
- admin dashboard redirect 확인.
- student dashboard redirect 확인.
- Q&A/community 기본 flow 확인.
- calendar feed route 확인.
- 캘린더 v2 token 회전, token-only URL과 이전 token 거부 확인.
- 학생 본인 계정 삭제 뒤 기존 session·로그인 거부, persistent-token 현재 기기 정리, memory-only 경로의 수동 정리 안내, 사전 등록된 다른 기기의 상태 동기화와 다른 학생 데이터 보존 확인.
- 30일 경계 fixture에서 account raw-ID alias 작업과 재실행 no-op 확인.
- 게시물 오디오와 Q&A 첨부의 staging PUT, 완료 검증, owner preview와 문서 첨부 확인.
- 다른 학생이 Q&A media ID와 direct object key를 알아도 읽지 못하는지 확인.
- `Range`, ETag 불일치, 휴지통 audience, purge 뒤 outbox·R2 삭제와 실패 재시도 확인.
- 관리자 과제 출제(믹스셋·글·둘 다)와 학생 제출·수정, 학생 자유 제출(링크·글·둘 다)의 제출·피드백 전 수정·삭제, 글 제출 피드백, 정기 과제 회차 생성과 다른 학생 과제 접근 거부 확인.
- 디깅 보드 플레이리스트: Beatport 공유 링크 등록(새 탭 열기)·SoundCloud 세트 등록(제목 자동·페이지 안 재생)·링크/제목/메모 수정·삭제, 다른 학생 목록 접근 거부와 관리자 읽기 전용 확인.
- 가이드 목록·페이지·이미지 표시, 관리자 편집·순서 변경, 학생 구간 질문이 그 학생과 관리자에게만 보이는지 확인.
- 테스트용 Google·iCloud 캘린더로 연결, 학생 매핑, 포털 레슨·일정 생성·이동·삭제의 외부 반영, 외부 생성·이동·삭제의 포털 반영, 연결 해제 확인.

## D1 백업과 복구 rehearsal

원격 export와 restore는 운영 데이터·cloud resource를 다루므로 승인된 작업 창에서만 실행한다. 배포 또는 migration 전에는 시각이 포함된 파일명으로 schema와 data를 함께 export한다.

```bash
npx wrangler d1 export portal-db --remote --output portal-db-YYYYMMDD-HHMM.sql
shasum -a 256 portal-db-YYYYMMDD-HHMM.sql > portal-db-YYYYMMDD-HHMM.sql.sha256
```

Export 파일은 저장소에 commit하지 않고 접근 제한·암호화·retention이 적용된 백업 위치로 옮긴다. 생성 직후 파일이 비어 있지 않은지, checksum이 다시 일치하는지, schema와 핵심 table 구문이 포함됐는지 확인한다.

복구는 production database에 바로 실행하지 않는다. 승인된 격리 D1 database를 준비한 뒤 export를 적용하고 로그인, 사용자 수, 노트·게시물·Q&A 표본, foreign key 무결성을 확인한다.

```bash
npx wrangler d1 execute RECOVERY_DATABASE --remote --file portal-db-YYYYMMDD-HHMM.sql
```

최소 분기마다 restore rehearsal을 수행하고 export 시각, checksum, 대상 격리 database, 검증 결과와 소요 시간을 비공개 운영 기록에 남긴다. R2 object는 D1 export에 포함되지 않으므로 media registry/outbox와 실제 object inventory를 대조한다. 첫 managed media write 뒤 D1만 과거로 복구하면 R2와 식별자가 어긋날 수 있으므로 forward-fix 또는 D1/R2 reconciliation을 포함해야 한다.

## 주의사항

- secret 실값은 공개 문서와 git history에 기록하지 않는다.
- D1/R2 binding 이름은 문서화 가능하지만 token/account secret은 문서화하지 않는다.
- push, remote migration, production deploy는 별도 승인 후 진행한다.
- 원격 export, 격리 database 생성·restore rehearsal도 별도 승인 후 진행한다.
