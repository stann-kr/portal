# portal 문서

## 개요

`portal`은 Stann Lumo DJ lesson 운영을 위한 Next.js 기반 lesson portal이다. 학생/관리자 dashboard, 과제, 커리큘럼, 캘린더, Q&A, 커뮤니티, private note, media upload flow를 제공한다.

## 현재 상태

- Next.js 15 App Router와 React 19 기반 web-app이다.
- NextAuth v5 credentials auth와 Drizzle ORM을 사용한다.
- Cloudflare D1/R2와 OpenNext Cloudflare worker 배포 구조를 가진다.
- public route, auth route, student dashboard, admin dashboard가 분리되어 있다.
- 공개 문서는 `docs/`, private 작업 문서와 원본 snapshot은 `.docs/`에서 관리한다.

## 빠른 시작

```bash
npm install
npm run dev
```

개발 서버 기본 포트는 `3004`다.

## 기술 스택

| 영역 | 내용 |
|---|---|
| Framework | Next.js 15 App Router |
| React | React 19 |
| Auth | NextAuth v5 Credentials |
| DB | Drizzle ORM, Cloudflare D1, local SQLite fallback |
| Storage | Cloudflare R2, S3 presigned URL |
| Editor | Tiptap, Markdown conversion |
| UI | Tailwind CSS, Radix UI, FullCalendar, Recharts |
| Deploy | OpenNext for Cloudflare, Wrangler |

## 주요 구조

```text
src/app/(auth)/login/                    # login route
src/app/dashboard/                       # dashboard entry
src/app/dashboard/student/               # student dashboard
src/app/dashboard/admin/                 # admin dashboard
src/app/dashboard/qna/                   # Q&A board
src/app/community/                       # community board
src/db/schema.ts                         # Drizzle schema
src/db/client.ts                         # D1/local DB client
src/auth.ts                              # NextAuth credentials provider
src/lib/actions/                         # server actions
drizzle/                                # D1 migration files
wrangler.toml                            # Cloudflare bindings
docs/                                    # public project docs
```

## 문서 목록

- [요구사항](./REQUIREMENTS.md)
- [기술 명세](./TECH_SPEC.md)
- [배포 가이드](./DEPLOYMENT.md)
- [변경 이력](./CHANGE_LOG.md)
- [트러블슈팅](./TROUBLESHOOTING.md)

## 운영 메모

- phase progress, audit, private design docs는 `.docs/`에 둔다.
- public docs에는 route/schema/deployment의 현재 기준만 남긴다.
- remote push와 production deploy는 별도 승인 후 진행한다.
