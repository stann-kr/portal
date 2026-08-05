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
| `/dashboard/notes/[noteId]` | 권한 검증된 개인 노트 읽기·이어쓰기 |
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

디깅 보드는 같은 column·track 데이터를 768px 미만에서 label-value record list로, 그 이상에서 TanStack Table 기반 data grid로 표시한다. 두 표현은 같은 edit cell과 server action을 사용한다.

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
- Q&A 상태 변경은 관리자 역할과 허용된 `OPEN`, `ANSWERED`, `CLOSED` 값인지 함께 검증한다.

## 문서 작성과 연속성

- `FullEditor`는 Tiptap 기반 block·inline 서식, slash command, 링크·이미지·YouTube 삽입 panel, Markdown 전환과 실행 취소를 제공한다. 저장 단축키는 editor 안에 한정하지 않고 상위 form 전체에서 처리한다.
- 저장된 rich text는 `RichTextContent`와 공통 `.rich-text` 스타일로 렌더한다. 서버 저장 전에 sanitize하고 YouTube는 privacy-enhanced embed만 유지한다.
- `useFormDraft`는 노트·게시물·Q&A의 작성자와 문서 문맥을 포함한 versioned local storage key를 사용한다. 각 저장은 raw hash에 결합된 불변 shadow를 canonical보다 먼저 기록하고, 다음 자기 shadow가 안전해진 뒤 이전 것을 정리한다. 구버전 mutable shadow와 미래 storage version은 rolling client의 새 입력을 지울 수 있어 자동 물리 삭제하지 않는다. 미래 version canonical이 있으면 새 입력을 recovery로 격리하고 저장소 오류와 무관하게 서버 제출을 잠근다. 이미 확인한 잠금은 page session 동안 문서 key별로 기억하고, recovery 쓰기 실패 시 현재 화면본을 writer별 메모리 안전본으로 유지해 SPA 재진입과 이탈 경고 경로에 합류시킨다.
- editor 입력 transaction은 문서 revision만 증가시키고 전체 HTML 직렬화는 200ms 정지, draft flush 또는 submit 경계까지 늦춘다. 최신 HTML reader를 draft pending에 즉시 연결하고 revision별 결과를 cache해 마지막 입력을 잃지 않으면서 매 키 입력의 전체 문서 순회를 피한다. Markdown 전체 parse와 draft payload signature 계산도 같은 지연 경계를 사용한다.
- slash command 탐색은 커서 앞 검색어 최대 64자와 경계 문자만 읽어 단일 문단 전체를 매 transaction마다 순회하지 않는다.
- page hide·탭 숨김·unmount 전에 pending 값을 flush하며, 저장공간 재시도도 실패하면 writer별 메모리 안전본을 유지하고 브라우저 이탈을 경고한다. 저장소가 회복되면 canonical보다 최신인 안전본만 현재 입력으로 채택하고 나머지는 durable recovery로 승격한다. 제출 cutoff용 원래 작성 시각과 recovery 보존 시작 시각을 분리하며, 같은 문서의 열린 탭에는 `BroadcastChannel`과 동일 문서 event로 제출 완료를 전달한다.
- 충돌·중단 복구본은 최대 30일 보존하며 최근 20개 기준으로 정리하고, UI에서 전체 저장 시각·제한된 제목/본문 미리보기·현재 화면본을 확인한 뒤 선택 복원하거나 2단계 확인으로 삭제할 수 있다. 같은 내용의 안전본은 causal 저장 시각이 가장 최신인 사본을 남기며, canonical과 같은 사본도 별도 key 사이의 교체 경합 때문에 화면에서만 숨기고 자동 물리 삭제하지 않는다. 제출 이력은 내용 서명별 append-only tombstone을 같은 30일 동안 개수 제한 없이 유지해 연속 제출 뒤 잠든 탭의 ghost 복원을 차단한다. 복원·채택 시점에도 tombstone과 원래 저장 시각을 다시 검증한다.
- 포털 section, workspace view와 관리자 학생 선택은 URL에 기록한다. 작성 화면과 저장된 문서는 검증된 내부 `returnTo`를 전달해 직전 작업 문맥으로 돌아간다.
- 첨부 업로드·서버 제출 중에는 submit, editor mutation, 화면 내 SPA link, 상위 상태 전환과 slide panel dismiss를 잠근다. hard navigation에는 이탈 경고를 제공하고 진행 중 업로드가 unmount되면 전송을 중단한다. 브라우저 Back/Forward와 임의의 programmatic route 전환은 client만으로 완전히 취소할 수 없으므로 실제 브라우저 E2E가 별도로 필요하다.
- 새 노트·게시물·Q&A 질문·답변의 draft에는 UUIDv4 생성 작업 nonce를 저장하고 submit 직전에 전체 snapshot을 flush한다. 서버는 인증된 작성자·대상·문서 종류를 함께 영역 분리한 결정적 UUIDv8을 실제 resource ID로 사용한다. 같은 nonce와 정규화 payload의 순차·동시 재전송은 기존 결과를 반환하며, 같은 작성 흐름의 다른 payload는 초안을 유지한 채 기존 문서 열기 또는 별도 문서 분리를 선택하게 한다.
- 개인 노트와 커뮤니티 게시물은 안정 URL에서 다시 편집할 수 있다. 편집 draft에는 서버 기준 snapshot을 함께 보존하되 요청에는 전체 기준 본문 대신 문서 종류·ID·저장 원문·날짜를 영역 분리한 SHA-256 지문만 보낸다. 서버는 현재 저장본의 지문을 대조하고 실제 조회한 필드를 조건으로 갱신해 다른 화면의 선행 저장을 감지한다. 노트의 날짜 입력은 생성·편집 모두 비어 있거나 실제 존재하는 canonical `YYYY-MM-DD`만 허용한다. 오래된 기준본을 복원하면 서버 최신본과 현재 초안 중 선택하게 하며, 저장 성공 응답이 유실된 동일 payload 재전송은 update 전 현재값 확인과 CAS 실패 뒤 재조회로 성공에 수렴한다.
- 새 게시물·Q&A 질문·답변의 `Cmd/Ctrl+S`는 공개 action을 호출하지 않고 최신 form snapshot을 로컬에 flush한다. 노트와 기존 문서 편집의 단축키는 명시된 서버 저장 action을 사용한다.
- Q&A의 스레드·첫 본문과 답변·상태 변경은 D1 binding batch 또는 로컬 SQLite transaction으로 함께 commit하거나 rollback한다. 답변 쓰기는 ownership과 `CLOSED` 상태를 원자 쓰기 안에서 다시 검증한다.
- 모든 작성 form은 draft hydration이 끝날 때까지 입력을 잠근다. 종료된 Q&A도 로컬 초안이나 복구본이 남아 있으면 읽기 전용 composer를 유지하고, 업로드 오류·진행률은 alert와 progressbar 의미로 노출한다.

현재 초안은 단일 브라우저 기기용이다. 서버 초안 동기화, 문서 revision, 휴지통, 다중 기기 merge는 구현되지 않았다. 저장소 자체를 사용할 수 없는 상태에서 브라우저 프로세스를 강제로 종료하면 메모리 안전본도 유지할 수 없다. 과거 owner 정보가 없는 local storage draft는 계정 간 노출을 막기 위해 자동 이관하지 않는다.

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
npm run test:integration
npm run lint
npx tsc --noEmit
npm run build
npm run build:worker
npm audit --omit=dev --audit-level=moderate
```

현재 migration consistency smoke, 개발용 관리자 seed의 환경·입력 경계, auth guard의 session·role·ownership, calendar token 변조·대상 불일치, HTML sanitize·YouTube payload, draft envelope·shadow·retention·연속 제출 tombstone·미래 version 보존과 제출 잠금, 안전한 복구 미리보기, 지연 문서 직렬화, 저장 단축키 controller와 로컬 flush helper, rich text 빈 값, 안전한 복귀 경로, editor URL·삽입 panel Enter·고정 범위 slash command, portal 상태 registry, 학생 오늘과 관리자 업무함 selector 회귀 테스트가 자동화되어 있다. OS 임시 영역의 격리 D1으로 Q&A rollback·권한·`CLOSED` 경쟁과 노트·게시물 compact fingerprint CAS·동일 편집 재전송 수렴을, DOM 격리 환경으로 draft unmount·문서 전환·다중 작성 흐름·복구 동작을 검증한다. 실제 브라우저 E2E, DB migration과 production deploy는 별도 범위다.

UI token, 상태 registry, 공통 component와 접근성 규칙은 [디자인 시스템](./DESIGN_SYSTEM.md)을 기준으로 한다. 상태 registry는 label, semantic tone, icon key가 서로 어긋나지 않도록 단위 테스트로 보호한다.

| 품질 경계 | 현재 자동화 | 다음 보강 |
|---|---|---|
| Migration | SQL·journal·snapshot·current schema empty replay | remote 적용 이력은 배포 준비 시 별도 점검 |
| 개발 credential | development/opt-in/env/input binding 단위 테스트 | 실제 local seed는 데이터 변경 작업으로 분리 |
| 인증·권한 | 미인증·role·ownership 허용/거부 단위 테스트, Q&A 격리 D1 권한 회귀 | 다른 주요 server action의 실제 query·mutation 경계 테스트 |
| 입력·콘텐츠 | script·event handler·위험 protocol XSS payload 테스트 | upload MIME·size 정책 테스트 |
| 문서 연속성 | draft shadow·flush·복구·제출 경쟁 DOM 통합, 미래 version 제출 잠금, 지연 직렬화·저장 단축키 controller·로컬 flush helper 테스트, note/post compact CAS 재전송과 Q&A 원자 쓰기 격리 D1 통합 | 실제 브라우저의 form 조합·reload·offline·navigation·대형 문서 frame·delete/restore E2E |
| UI 상태 | status registry 단위 테스트, loading/error route, semantic landmark·control 정적 검토 | keyboard interaction component 테스트 |

## 변경 시 같이 볼 파일

| 변경 영역 | 함께 확인할 파일 |
|---|---|
| auth·role | `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts`, `docs/REQUIREMENTS.md` |
| schema·migration | `src/db/schema.ts`, `drizzle/**`, 관련 action, `docs/TECH_SPEC.md` |
| student portal | `src/app/dashboard/student/page.tsx`, `src/components/student-portal/**` |
| admin portal | `src/app/dashboard/admin/page.tsx`, `src/components/admin-portal/**`, `src/lib/actions/students.ts` |
| rich text·input | 관련 form, `src/lib/sanitize-html.ts`, server action |
| 문서 draft·재진입 | `src/lib/form-draft.ts`, `src/lib/hooks/useFormDraft.ts`, 안정 문서 route, 관련 server action |
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
- 대표 문서 server action과 draft 생명주기의 격리 integration test는 있으나 실제 브라우저 reload·offline·navigation·delete/restore E2E는 없다.
- 문서 revision·휴지통·서버 초안이 없다. 현재 노트·게시물은 snapshot 기반 충돌 감지와 탭별 복구본을 제공하지만 다중 기기 연속성은 지원하지 않는다.
- 새 노트·게시물·Q&A·답변은 로컬 draft의 생성 작업 nonce와 기존 resource payload를 대조해 동일 재전송의 중복 생성을 막는다. 다만 별도 불변 생성 작업 원장이 없어 최초 생성 뒤 문서가 편집되거나 hard delete된 오래된 요청까지 영구적으로 증명할 수는 없다. Q&A 한 요청 안의 복합 쓰기 자체는 원자적이다.
- 큰 문서의 전체 HTML·payload 서명은 매 입력이 아니라 지연된 flush·submit 경계에서 revision당 한 번만 만들고, 편집 요청의 충돌 기준은 전체 원문 대신 짧은 지문으로 전송한다. 다만 Server Action의 기본 요청 본문 한도와 제품의 문서 용량 정책을 확정하지 않았고, 실제 브라우저 대용량 문서의 frame budget과 autosave latency 기준·측정도 없어 제품급 입력 부드러움은 아직 검증되지 않았다.
- lockfile의 Wrangler는 Node.js 22 이상을 요구하지만 package engine과 Docker image는 Node.js 20을 허용한다. 지원 runtime과 배포 image를 같은 major로 정렬해야 한다.
- 운영 D1 export·복구 절차는 문서화됐지만 승인된 원격 backup과 격리 restore rehearsal 기록은 아직 없다.
- 일부 대형 client component는 상태 hook, domain view와 presentation 경계가 한 파일에 남아 있다.
- 소셜 공유 이미지는 승인된 브랜드 asset이 준비된 뒤 metadata에 연결해야 한다.
