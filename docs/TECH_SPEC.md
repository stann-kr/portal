# 기술 명세

## 아키텍처 개요

`portal`은 Next.js App Router 기반 lesson portal이다. NextAuth credentials provider가 로그인과 session을 담당하고, Drizzle ORM이 Cloudflare D1 또는 local SQLite fallback에 접근한다. Media upload는 R2/S3-compatible presigned URL 구조를 사용한다.

```text
Next.js app
├─ auth route group
├─ student dashboard
├─ admin dashboard
├─ community / qna boards
├─ server actions
└─ Drizzle DB client

Cloudflare
├─ Worker via OpenNext
├─ D1 binding: DB
└─ R2 binding: BUCKET
```

## 실제 소스 기준

| 영역 | 파일/경로 | 확인 내용 |
|---|---|---|
| Root redirect | `src/app/page.tsx` | role별 dashboard redirect |
| Auth | `src/auth.ts`, `src/auth.config.ts` | NextAuth credentials provider |
| Auth API | `src/app/api/auth/[...nextauth]/route.ts` | NextAuth route handler |
| Student routes | `src/app/dashboard/student/**` | assignments, curriculum, notes, digging |
| Admin routes | `src/app/dashboard/admin/**` | students, categories, admin home |
| Boards | `src/app/dashboard/qna/**`, `src/app/community/**` | Q&A/community |
| DB schema | `src/db/schema.ts` | profiles/content schema |
| DB client | `src/db/client.ts` | D1/local DB selection |
| Actions | `src/lib/actions/**` | server mutations/queries |
| Storage | `src/lib/r2.ts`, `src/lib/actions/upload.ts` | R2/presigned upload |
| Deploy | `wrangler.toml` | D1/R2/route binding |

## 런타임과 프레임워크

| 영역 | 값 |
|---|---|
| Framework | Next.js 15.5 |
| React | 19 |
| Auth | NextAuth v5 Credentials |
| DB | Drizzle ORM, Cloudflare D1, local SQLite fallback |
| Storage | Cloudflare R2, S3-compatible SDK |
| Editor | Tiptap, turndown, markdown conversion |
| Calendar | FullCalendar, ics |
| Deploy | OpenNext for Cloudflare, Wrangler |

## route map

| Route | 역할 |
|---|---|
| `/login` | credentials login |
| `/dashboard` | dashboard entry |
| `/dashboard/admin` | admin home |
| `/dashboard/admin/students/new` | student creation |
| `/dashboard/admin/students/[id]` | student detail |
| `/dashboard/admin/categories` | category management |
| `/dashboard/student` | student home |
| `/dashboard/student/assignments` | assignment list |
| `/dashboard/student/curriculum` | curriculum |
| `/dashboard/student/notes` | private notes |
| `/dashboard/qna` | Q&A list |
| `/community` | community board |
| `/api/calendar/[studentId]` | calendar feed |

## 데이터 모델과 저장소

Cloudflare binding:

| Binding | Resource | 용도 |
|---|---|---|
| `DB` | D1 database `portal-db` | lesson portal data |
| `BUCKET` | R2 bucket `portal-storage` | media upload/storage |
| `ASSETS` | OpenNext assets | static assets |

Migration files are under `drizzle/`.

## 인증과 권한

- Credentials provider는 email/password와 bcrypt hash 비교를 사용한다.
- user role은 admin/student dashboard routing에 사용된다.
- server actions는 role/data boundary를 확인해야 한다.
- middleware와 auth guard 변경 시 route 접근 정책을 함께 검증한다.

## 배포와 운영

Cloudflare worker deployment는 OpenNext build와 Wrangler deploy를 기준으로 한다. 상세 절차는 [배포 가이드](./DEPLOYMENT.md)를 따른다.

## 테스트와 검증

```bash
npm run lint
npm run build
npm run build:worker
npm run db:migrate
```

production migration/deploy는 별도 승인 후 수행한다.

## 변경 시 같이 볼 파일

| 변경 영역 | 함께 확인할 파일 |
|---|---|
| auth/role 변경 | `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts`, `REQUIREMENTS.md` |
| schema 변경 | `src/db/schema.ts`, `drizzle/*`, `TECH_SPEC.md`, `CHANGE_LOG.md` |
| student dashboard 변경 | `src/app/dashboard/student/**`, relevant actions |
| admin dashboard 변경 | `src/app/dashboard/admin/**`, `src/lib/actions/students.ts` |
| upload/media 변경 | `src/lib/r2.ts`, `src/lib/actions/upload.ts`, `DEPLOYMENT.md` |
| Cloudflare binding 변경 | `wrangler.toml`, `DEPLOYMENT.md`, `TROUBLESHOOTING.md` |

## 문서 최신성 기준

다음 변경 시 이 문서를 갱신한다.

- route group 추가/삭제
- D1 schema/migration 변경
- R2 upload 방식 변경
- auth provider/session/role policy 변경
- Cloudflare binding 또는 deploy command 변경

## 알려진 기술 부채

- `package.json`의 project name이 generic하므로 repo 식별자와 맞추는 작업은 별도 판단이 필요하다.
- 기존 audit/phase progress는 `.docs/원본/2026-07-28/`에 보존되어 있고 public docs에는 최신 기준만 유지한다.
- production smoke test 계정과 seed data 기준은 별도 runbook으로 보강 가능하다.
