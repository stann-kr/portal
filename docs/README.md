# portal 문서

## 개요

`portal`은 Stann Lumo DJ 레슨 운영을 위한 Next.js 기반 웹 애플리케이션이다. 학생과 관리자가 과제·피드백, 커리큘럼, 일정, 개인 노트, 디깅 기록, 커뮤니티와 1:1 Q&A를 한 곳에서 관리한다.

## 현재 상태

- Next.js 15 App Router와 React 19를 사용한다.
- NextAuth credentials 인증으로 student/admin 역할을 분리한다.
- Drizzle ORM을 통해 Cloudflare D1 또는 로컬 SQLite에 접근한다.
- 미디어 업로드는 Cloudflare R2 presigned URL 흐름을 사용한다.
- 학생 포털은 오늘·워크스페이스·커뮤니티 구조이며 일부 상세·작성 라우트를 병행한다.
- 관리자 포털은 미답변 Q&A·피드백 대기·다가오는 레슨을 우선하는 업무함에서 시작한다.
- migration metadata·empty replay 자동 검사와 lint, TypeScript typecheck, Next.js·Worker build를 기본 검증으로 사용한다.
- 개발용 관리자 seed, auth guard, calendar token, HTML sanitize, UI 상태 registry와 학생 오늘 selector를 단위 테스트로 보호한다.
- 문서 draft 생명주기와 Q&A·노트·게시물의 핵심 mutation은 격리 DOM·D1 integration test로 보호한다.
- 개인 노트는 version 기반 저장, 불변 revision 이력, 30일 휴지통, 복원·관리자 영구 삭제와 anti-replay ledger/tombstone을 제공한다.
- 학생 본인 계정 삭제는 profile과 원문을 즉시 제거하고 기존 session을 차단한다. 현재 기기는 직접 정리하고 사전 등록된 다른 기기에는 정리 신호를 남기며, raw ID의 30일 경계 뒤 alias 수렴을 예약 정리 handler로 처리한다. 기능 활성화와 scheduler의 실제 적용은 [운영 상태 확인 기준](./DEPLOYMENT.md#운영-상태-확인-기준)에 따라 확인한다.

## 빠른 시작

요구 사항:

- Node.js 22 이상
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
- [디자인 시스템](./DESIGN_SYSTEM.md)
- [배포 가이드](./DEPLOYMENT.md)
- [변경 이력](./CHANGE_LOG.md)
- [트러블슈팅](./TROUBLESHOOTING.md)

## 추천 읽기 순서

| 목적 | 문서 | 확인할 내용 |
|---|---|---|
| 제품 이해 | [요구사항](./REQUIREMENTS.md) | 사용자, 기능 범위, 검증 기준, 현재 충족 상태 |
| 구현 이해 | [기술 명세](./TECH_SPEC.md) | 아키텍처, route, data model, auth·storage 경계 |
| UI 구현 | [디자인 시스템](./DESIGN_SYSTEM.md) | token, 상태 registry, 공통 component, 접근성·반응형 규칙 |
| 실행·운영 | [배포 가이드](./DEPLOYMENT.md) | local 검증, D1 migration, Worker build·deploy 경계 |
| 변화 추적 | [변경 이력](./CHANGE_LOG.md) | 날짜·버전별 사용자-visible 변경 |
| 문제 해결 | [트러블슈팅](./TROUBLESHOOTING.md) | 재발 가능한 문제의 증상·원인·해결·검증 |

## 현재 개발 우선순위

1. 대상 환경의 실제 migration 목록과 Worker version을 대조하고, 외부 캘린더 코드의 `0013`·암호화 secret 조건을 포함한 배포 gate를 확인한다.
2. development/production 자원 분리, private managed media 설정, 예약 정리의 실제 실행·alert와 복구 rehearsal을 승인된 범위에서 검증한다.
3. 실제 브라우저의 reload·offline·Back/Forward·다중 탭·대용량 입력 성능과 강제 종료 복구를 측정한다.

## 문서 최신성 기준

다음 변경이 생기면 관련 문서를 함께 갱신한다.

- route, schema, 인증·권한 경계 변경
- D1/R2 binding 또는 배포 방식 변경
- 주요 사용자 흐름이나 공개 인터페이스 변경
- 검증 명령과 지원 runtime 변경

실제 secret과 로컬 환경의 절대 경로는 문서에 기록하지 않는다.
