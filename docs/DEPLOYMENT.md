# 배포 가이드

## 개요

`portal`은 OpenNext for Cloudflare를 통해 Cloudflare Worker로 배포한다. D1 database와 R2 bucket binding을 사용한다.

## 배포 대상

| 항목 | 값 |
|---|---|
| Worker name | `portal` |
| Custom domain | `portal.stann.kr` |
| Worker entry | `.open-next/worker.js` |
| Static assets binding | `ASSETS` |
| D1 binding | `DB` |
| D1 database | `portal-db` |
| R2 binding | `BUCKET` |
| R2 bucket | `portal-storage` |

## 사전 체크리스트

- Wrangler 인증이 유효해야 한다.
- D1 database와 R2 bucket이 존재해야 한다.
- migration이 local/remote에 적용되어야 한다.
- auth secret과 기타 secret은 배포 환경에만 설정한다.
- production deploy 전 admin/student smoke 계정과 test data를 준비한다.

## 로컬 검증

```bash
npm run db:check
npm run lint
npm run build
npm run build:worker
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

```bash
npm run build:worker
npx wrangler deploy
```

## 배포 후 확인

- `/login` 접속과 credentials login 확인.
- admin dashboard redirect 확인.
- student dashboard redirect 확인.
- Q&A/community 기본 flow 확인.
- calendar feed route 확인.
- R2 media upload flow 확인.

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

최소 분기마다 restore rehearsal을 수행하고 export 시각, checksum, 대상 격리 database, 검증 결과와 소요 시간을 비공개 운영 기록에 남긴다. R2 object는 D1 export에 포함되지 않으므로 media retention·복구 정책과 별도 inventory가 필요하다.

## 주의사항

- secret 실값은 공개 문서와 git history에 기록하지 않는다.
- D1/R2 binding 이름은 문서화 가능하지만 token/account secret은 문서화하지 않는다.
- push, remote migration, production deploy는 별도 승인 후 진행한다.
- 원격 export, 격리 database 생성·restore rehearsal도 별도 승인 후 진행한다.
