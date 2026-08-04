# 기술 명세

## 아키텍처 개요

`portal`은 Next.js App Router 기반의 인증형 웹 애플리케이션이다. React Server Component가 초기 데이터를 조회하고 client component가 탭·필터·작성 상태를 관리한다. 데이터 mutation은 server action, 인증은 NextAuth credentials provider, 저장소 접근은 Drizzle ORM이 담당한다.

```text
Browser
  └─ Next.js App Router
      ├─ auth·role redirect
      ├─ student/admin portal shell
      ├─ shared community·Q&A routes
      ├─ server actions
      └─ calendar feed API
          ├─ Drizzle ORM → Cloudflare D1 / local SQLite
          └─ presigned upload → Cloudflare R2

OpenNext → Cloudflare Worker
```

## 실제 소스 기준

| 영역 | 파일/경로 | 확인 내용 |
|---|---|---|
| Root·dashboard redirect | `src/app/page.tsx`, `src/app/dashboard/page.tsx` | session role별 시작 경로 |
| Auth | `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts` | credentials, session, route access |
| Student portal | `src/app/dashboard/student/page.tsx`, `src/components/student-portal/` | 오늘 요약·통합 워크스페이스·커뮤니티 |
| Admin portal | `src/app/dashboard/admin/page.tsx`, `src/components/admin-portal/` | 업무함·학생·일정·공지·커뮤니티 |
| Shared flows | `src/app/community/`, `src/app/dashboard/qna/` | 게시판·Q&A |
| Data aggregation | `src/lib/actions/unifiedItems.ts`, `src/lib/utils/unifiedItemUtils.ts` | 일정·노트·디깅·Q&A·과제 통합 |
| DB schema·client | `src/db/schema.ts`, `src/db/client.ts` | table, D1/local SQLite 선택 |
| Server actions | `src/lib/actions/` | query, mutation, revalidation |
| Security helpers | `src/lib/auth-guard.ts`, `src/lib/sanitize-html.ts` | role·ownership, rich text sanitize |
| Storage | `src/lib/r2.ts`, `src/lib/actions/upload.ts` | R2 presigned upload |
| Calendar feed | `src/app/api/calendar/[studentId]/route.ts`, `src/lib/calendar-feed.ts` | session·서명 token 접근 |
| Deploy | `open-next.config.ts`, `wrangler.toml` | Worker, D1, R2, asset binding |

## 런타임과 프레임워크

| 영역 | 값 |
|---|---|
| Runtime | Node.js 20.18.1 이상, Cloudflare Workers |
| Framework | Next.js 15.5 App Router, React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| UI | Radix UI, FullCalendar, Recharts, Lucide |
| Auth | NextAuth v5 Credentials |
| Data | Drizzle ORM, Cloudflare D1, local SQLite fallback |
| Storage | Cloudflare R2, S3-compatible SDK |
| Editor | Tiptap |
| Deploy | OpenNext for Cloudflare, Wrangler |

## 주요 route

| Route | 역할 |
|---|---|
| `/` | session role에 따라 portal 또는 login으로 이동 |
| `/login` | credentials login |
| `/dashboard/student` | 학생 원페이지 포털 |
| `/dashboard/admin` | 관리자 원페이지 포털 |
| `/dashboard/student/assignments/[id]` | 과제 상세 직접 접근 |
| `/dashboard/student/notes/new` | 개인 노트 작성 직접 접근 |
| `/dashboard/admin/students/new` | 학생 추가 |
| `/dashboard/admin/students/[id]` | 학생 상세 |
| `/dashboard/admin/categories` | 카테고리 관리 |
| `/dashboard/qna/**` | Q&A 목록·작성·상세 |
| `/community/**` | 커뮤니티 목록·작성·상세 |
| `/dashboard/calendar` | 공유 캘린더 |
| `/api/calendar/[studentId]` | 인증·서명 token 기반 `.ics` feed |

`/dashboard/student/assignments`, `curriculum`, `digging`, `notes` 목록 경로는 원페이지 포털로 redirect한다.

학생 포털의 기본 section은 `오늘`이다. 통합 item에서 다음 일정, 피드백이 있는 제출, Q&A 상태를 순수 selector로 분류하고 최근 공지와 실제 작성 경로를 함께 제공한다. 현재 schema에 없는 과제 배정·마감·읽음 상태는 추정하지 않는다. 캘린더, 일별 기록, 전체 항목, 커리큘럼, 과제는 `워크스페이스` section에서 기존 기능을 유지한다.

관리자 포털의 기본 section은 `업무함`이다. 전체 Q&A 중 미답변 항목, feedback이 없는 assignment, 앞으로 7일 이내의 학생별 다음 레슨을 조회한다. 질문과 과제는 오래 기다린 항목부터 보여주고 실제 Q&A·과제 상세로 연결한다. 학생, 일정, 공지, 커뮤니티 section은 기존 관리 기능을 유지한다.

학생과 관리자 포털은 공통 `PortalShell`과 `PortalNavigation`을 사용한다. section 선택은 역할별 local storage key에 편의 상태로 저장한다. root skip link와 main landmark, 이름이 있는 side rail control, dashboard loading/error boundary를 공통 shell 경계로 둔다. 학생 roster는 mobile label-value list와 desktop table을 분리하고 desktop 확장은 실제 button으로 조작한다.

## 데이터 모델과 저장소

`src/db/schema.ts`의 주요 table:

- 사용자·수업: `profiles`, `curriculums`, `lessons`
- 과제·피드백: `assignments`, `feedbacks`
- 콘텐츠: `categories`, `posts`, `comments`
- 개인 학습 기록: `private_notes`, `calendar_events`
- 디깅: `digging_columns`, `digging_tracks`
- Q&A: `qna_threads`, `qna_replies`

Cloudflare binding:

| Binding | Resource | 용도 |
|---|---|---|
| `DB` | D1 database | 포털 데이터 |
| `BUCKET` | R2 bucket | 미디어 저장 |
| `ASSETS` | OpenNext assets | 정적 asset |

Migration SQL은 `drizzle/`, Drizzle metadata는 `drizzle/meta/`에 둔다. Wrangler는 SQL 파일명과 D1의 적용 이력을 기준으로 migration을 실행하고, Drizzle metadata는 다음 schema diff 생성 기준으로 사용한다. SQL·journal·snapshot은 `0000~0007`까지 대응하며 `npm run db:check`가 empty replay, current schema, latest snapshot의 구조 일치를 검사한다.

## 인증과 권한

- credentials provider는 email/password와 bcrypt hash를 비교한다.
- session의 `user.id`와 `user.role`을 route redirect와 server action guard에 사용한다.
- 데이터 조회·변경 함수는 호출 화면에 의존하지 않고 role과 ownership을 자체 검증해야 한다.
- 캘린더 feed는 본인·관리자 session 또는 `AUTH_SECRET`으로 서명한 학생별 token을 검증한다.
- rich text는 서버 저장 경계에서 sanitize한다.

## 환경 변수와 설정

| 항목 | 용도 | 값 관리 |
|---|---|---|
| `AUTH_SECRET` | auth와 calendar feed 서명 | secret |
| `AUTH_URL` | 배포·프록시 환경의 canonical URL | 환경별 설정 |
| `DEV_ADMIN_SEED_ENABLED` | 로컬 관리자 seed 명시적 opt-in | 개발 환경 전용 |
| `DEV_ADMIN_EMAIL` | 로컬 관리자 계정 식별자 | 개발 환경 전용 |
| `DEV_ADMIN_PASSWORD` | 로컬 관리자 비밀번호 | 로컬 secret |
| `DEV_ADMIN_DISPLAY_NAME` | 로컬 관리자 표시 이름 | 개발 환경 전용 |
| `R2_ENDPOINT` | R2 S3-compatible endpoint | 환경별 설정 |
| `R2_ACCESS_KEY_ID` | R2 access key | secret |
| `R2_SECRET_ACCESS_KEY` | R2 secret key | secret |
| `R2_BUCKET_NAME` | upload bucket 이름 | 환경별 설정 |
| `R2_PUBLIC_URL` | 공개 media base URL | 환경별 설정 |

샘플 계약은 `.env.example`에 두고 실제 값은 commit하지 않는다.

## 테스트와 검증

```bash
npm run db:check
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run build:worker
npm audit --omit=dev --audit-level=moderate
```

현재 migration consistency smoke, 개발용 관리자 seed의 환경·입력 경계, auth guard의 session·role·ownership, calendar token 변조·대상 불일치, HTML sanitize payload, portal 상태 registry, 학생 오늘과 관리자 업무함 selector 회귀 테스트가 자동화되어 있다. 대표 server action의 query·mutation integration/E2E test는 아직 없으며 DB migration과 production deploy는 별도 승인 후 실행한다.

UI token, 상태 registry, 공통 component와 접근성 규칙은 [디자인 시스템](./DESIGN_SYSTEM.md)을 기준으로 한다. 상태 registry는 label, semantic tone, icon key가 서로 어긋나지 않도록 단위 테스트로 보호한다.

| 품질 경계 | 현재 자동화 | 다음 보강 |
|---|---|---|
| Migration | SQL·journal·snapshot·current schema empty replay | remote 적용 이력은 배포 준비 시 별도 점검 |
| 개발 credential | development/opt-in/env/input binding 단위 테스트 | 실제 local seed는 데이터 변경 작업으로 분리 |
| 인증·권한 | 미인증·role·ownership 허용/거부 단위 테스트 | 대표 server action의 실제 query·mutation 경계 테스트 |
| 입력·콘텐츠 | script·event handler·위험 protocol XSS payload 테스트 | upload MIME·size 정책 테스트 |
| UI 상태 | status registry 단위 테스트, loading/error route, semantic landmark·control 정적 검토 | keyboard interaction component 테스트 |

## 변경 시 같이 볼 파일

| 변경 영역 | 함께 확인할 파일 |
|---|---|
| auth·role | `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts`, `docs/REQUIREMENTS.md` |
| schema·migration | `src/db/schema.ts`, `drizzle/**`, 관련 action, `docs/TECH_SPEC.md` |
| student portal | `src/app/dashboard/student/page.tsx`, `src/components/student-portal/**` |
| admin portal | `src/app/dashboard/admin/page.tsx`, `src/components/admin-portal/**`, `src/lib/actions/students.ts` |
| rich text·input | 관련 form, `src/lib/sanitize-html.ts`, server action |
| upload·media | `src/lib/r2.ts`, `src/lib/actions/upload.ts`, `.env.example`, `docs/DEPLOYMENT.md` |
| Cloudflare binding | `wrangler.toml`, `open-next.config.ts`, `docs/DEPLOYMENT.md` |

## 문서 최신성 기준

다음 변경이 생기면 이 문서를 갱신한다.

- route, API, schema 또는 migration 변경
- 인증·권한·session 경계 변경
- 주요 모듈이나 데이터 흐름 변경
- 환경 변수, Cloudflare binding 또는 배포 방식 변경
- 검증 명령과 지원 runtime 변경

## 알려진 기술 부채

- runtime dependency audit은 현재 0건이다. 상위 의존성이 보안 패치 전 하위 의존성을 고정하는 구간은 `package.json` override로 제한하며, upstream stable이 해당 버전을 채택하면 override를 제거해야 한다.
- 개발 도구 전체 audit에는 Drizzle Kit의 구형 esbuild loader 체인에서 발생하는 moderate 권고가 남아 있다. 현재 npm 제안은 호환되지 않는 구버전 downgrade이므로 upstream 패치를 추적한다.
- migration SQL과 `drizzle/meta` 생성 이력은 `0007`까지 복구됐고 local D1도 빈 상태에서 전체 migration 재적용과 구조 검증을 통과했다. remote 이력은 별도 승인 전 추정하지 않는다.
- 대표 server action과 핵심 사용자 흐름을 보호할 integration/E2E 테스트가 없다.
- `package.json`의 package name이 임시값이다.
- route 단위 `loading.tsx`와 `error.tsx`가 없어 대기·복구 상태가 부족하다.
- 일부 대형 client component와 status color가 공통 token·variant 없이 중복되어 있다.
