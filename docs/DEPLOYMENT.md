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

## 주의사항

- secret 실값은 공개 문서와 git history에 기록하지 않는다.
- D1/R2 binding 이름은 문서화 가능하지만 token/account secret은 문서화하지 않는다.
- push, remote migration, production deploy는 별도 승인 후 진행한다.
