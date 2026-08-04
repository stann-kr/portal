# portal 문서

## 개요

`portal`은 Stann Lumo DJ 레슨 운영을 위한 Next.js 기반 웹 애플리케이션이다. 학생과 관리자가 과제·피드백, 커리큘럼, 일정, 개인 노트, 디깅 기록, 커뮤니티와 1:1 Q&A를 한 곳에서 관리한다.

## 현재 상태

- Next.js 15 App Router와 React 19를 사용한다.
- NextAuth credentials 인증으로 student/admin 역할을 분리한다.
- Drizzle ORM을 통해 Cloudflare D1 또는 로컬 SQLite에 접근한다.
- 미디어 업로드는 Cloudflare R2 presigned URL 흐름을 사용한다.
- 학생·관리자 포털은 원페이지 탭 구조이며 일부 상세·작성 라우트를 병행한다.
- migration metadata·empty replay 자동 검사와 lint, TypeScript typecheck, Next.js build를 기본 검증으로 사용한다. unit/integration/E2E 회귀 테스트는 아직 보강이 필요하다.

## 빠른 시작

요구 사항:

- Node.js 20.18.1 이상
- npm
- `.env.example`을 기준으로 작성한 `.env.local`

```bash
npm install
npm run dev
```

개발 서버 기본 포트는 `3004`다.

## 기술 스택

| 영역 | 내용 |
|---|---|
| Framework | Next.js 15 App Router, React 19 |
| Language | TypeScript |
| Auth | NextAuth v5 Credentials |
| Data | Drizzle ORM, Cloudflare D1, local SQLite fallback |
| Storage | Cloudflare R2, S3-compatible presigned URL |
| Editor | Tiptap |
| UI | Tailwind CSS 4, Radix UI, FullCalendar, Recharts |
| Deploy | OpenNext for Cloudflare, Wrangler |

## 주요 구조

```text
src/app/                    # route, layout, API
src/components/             # 도메인 UI와 공통 primitive
src/db/                     # Drizzle schema와 DB client
src/lib/actions/            # query·mutation server action
src/lib/                    # auth guard, sanitize, storage utility
drizzle/                    # D1 migration
docs/                       # 프로젝트 문서
```

## 문서 목록

- [요구사항](./REQUIREMENTS.md)
- [기술 명세](./TECH_SPEC.md)
- [배포 가이드](./DEPLOYMENT.md)
- [변경 이력](./CHANGE_LOG.md)
- [트러블슈팅](./TROUBLESHOOTING.md)

## 문서 최신성 기준

다음 변경이 생기면 관련 문서를 함께 갱신한다.

- route, schema, 인증·권한 경계 변경
- D1/R2 binding 또는 배포 방식 변경
- 주요 사용자 흐름이나 공개 인터페이스 변경
- 검증 명령과 지원 runtime 변경

실제 secret과 로컬 환경의 절대 경로는 문서에 기록하지 않는다.
