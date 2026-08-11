# 배포 가이드

## 개요

`portal`은 OpenNext for Cloudflare를 통해 Cloudflare Worker로 배포한다. D1 database와 R2 bucket binding을 사용한다.

## 배포 대상

| 항목 | 값 |
|---|---|
| Worker name | `portal` |
| Custom domain | `portal.stann.kr` |
| Worker entry | `.open-next/worker.js` |
| Scheduled candidate entry | `worker.ts` (`wrangler.scheduled.toml`) |
| Maintenance entry | `src/workers/maintenance.ts` (`wrangler.maintenance.toml`) |
| Static assets binding | `ASSETS` |
| D1 binding | `DB` |
| D1 database | `portal-db` |
| R2 binding | `BUCKET` |
| R2 bucket | `portal-storage` |

## 사전 체크리스트

- build·upload 환경은 Node.js 22 이상이어야 한다.
- Wrangler 인증이 유효해야 한다.
- D1 database와 R2 bucket이 존재해야 한다.
- 대상 Worker를 promotion하기 전에는 승인된 작업 창에서 실제 pending migration을 적용·검증해야 한다. 비호환 migration은 maintenance 진입 전에 미리 적용하지 않는다.
- auth secret과 기타 secret은 배포 환경에만 설정한다.
- production deploy 전 admin/student smoke 계정과 test data를 준비한다.
- production branch merge가 자동 배포를 시작하는지 확인하고, migration 작업 창에는 자동 promotion을 중지하거나 upload-only 절차로 전환한다.

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
- media deletion outbox와 30일이 지난 account raw-ID erasure를 주기적으로 실행하고 backlog·실패를 경보한다. 관리자 수동 control은 비상 수렴 경로이며 scheduler를 대체하지 않는다.
- 신규 캘린더 URL은 `/api/calendar/feed?token=…` 형태만 발급한다. 기존 v1 URL은 active profile이 없으면 거부하지만 외부 calendar client와 과거 log에 이미 복사된 raw ID 자체는 회수할 수 없음을 운영 기록에 남긴다.
- 삭제 smoke는 기존 session endpoint와 read/write/upload 거부, 재로그인 거부, 다른 학생 데이터 불변, persistent-token 현재 기기의 직접 정리, cleanup token quota가 가득 찬 경우와 storage-unavailable memory-only 경로의 삭제 성공·수동 정리 안내, 사전 등록된 오프라인 기기의 재접속 정리, 30일 안의 subject ID 재사용 거부, 30일 경계 전후 aliasing과 second-run no-op을 확인한다.
- 계정에 연결된 managed media는 DB 원문 삭제와 함께 outbox에 들어가지만 R2 물리 삭제는 비동기다. UI와 운영 응답은 outbox가 남아 있는 동안 저장소 삭제 완료를 주장하지 않는다.
- 기존 게시물·Q&A URL이 trusted R2 object를 가리키면 계정 삭제 전에 key를 registry로 backfill하거나 별도 deletion inventory에 보존한다. URL 원문부터 지우면 object key를 복원할 수 없으므로 legacy inventory 없이 계정 삭제 기능을 활성화하지 않는다.

## 점검·예약 정리 Worker artifact

두 별도 설정은 production 상태를 바꾸지 않는 local dry-run용 진입점을 제공한다.

```bash
npm run build:maintenance
npm run build:scheduled
```

- `wrangler.maintenance.toml`은 동일한 `portal` 서비스의 점검용 version을 만든다. D1, R2, asset, application route와 Cron trigger를 포함하지 않는다.
- `wrangler.scheduled.toml`은 OpenNext fetch를 유지하면서 `scheduled` handler를 추가한다. D1과 R2 binding은 event 환경에서 직접 주입하며 request AsyncLocalStorage에 의존하지 않는다.
- scheduled 설정에는 아직 `[triggers]`와 route가 없다. 따라서 dry-run 또는 upload-only만으로 production Cron이 시작되지 않는다.
- 예약 정리는 계정 raw-ID alias, 만료 media enqueue, 기존 R2 deletion outbox를 제한된 순차 batch로 처리한다. 로그에는 고정된 상태와 집계만 남긴다.

production Cron을 활성화하기 전에는 Workers plan의 Cron CPU 한도, 실행 주기, log 보존, backlog·실패 alert를 확인한다. `0011`·`0012` migration, private R2·staging lifecycle, legacy inventory가 준비되기 전에 trigger를 추가하지 않는다.

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
npm run db:check
npm run lint
npm run build
npm run build:worker
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

schema와 양방향 호환되는 일반 application 변경만 OpenNext deploy를 사용할 수 있다.

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
