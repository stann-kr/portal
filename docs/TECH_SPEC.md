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
| Data aggregation | `src/lib/actions/unifiedItems.ts`, `src/lib/unified-item-normalization.ts`, `src/lib/utils/unifiedItemUtils.ts` | 학생 스페이스·포털 출처를 포함한 레슨·일정·노트·디깅·Q&A·과제 통합 |
| DB schema·client | `src/db/schema.ts`, `src/db/client.ts` | table, D1/local SQLite 선택 |
| Server actions | `src/lib/actions/` | query, mutation, revalidation |
| Security helpers | `src/lib/auth-guard.ts`, `src/lib/active-profile.ts`, `src/lib/sanitize-html.ts` | active profile·DB role·ownership, AST allowlist rich text sanitize |
| Local draft account boundary | `src/components/auth/`, `src/lib/account-cleanup-client.ts`, `src/lib/account-terminal-lock.ts`, `src/lib/local-draft-continuity-client.ts` | 기기 초안 목록·명시 폐기, 로그아웃·계정 전환·삭제 신호 정리 |
| Server draft continuity | `src/lib/actions/documentDrafts.ts`, `src/lib/hooks/useSyncedFormDraft.ts`, `src/components/editor/ServerDraftStatus.tsx` | 사용자·문서별 최신본, CAS·재전송, 오프라인 queue와 명시적 다중 기기 선택 |
| Document lifecycle | `src/lib/document-lifecycle-atomic.ts`, `src/lib/post-atomic.ts`, `src/lib/qna-atomic.ts` | 게시물·Q&A version CAS, 불변 이력·receipt, 휴지통·복원·purge·tombstone 원자 경계 |
| Storage | `src/lib/r2.ts`, `src/lib/media-lifecycle-atomic.ts`, `src/lib/actions/upload.ts`, `src/app/api/media/` | staging presigned upload, D1 registry·삭제 outbox, 인증 delivery |
| Account privacy | `src/lib/account-privacy-atomic.ts`, `src/lib/actions/accountPrivacy.ts`, `src/app/api/account-cleanup/` | 학생 본인 원자 삭제, 기기 cleanup digest, 30일 raw-ID alias |
| Calendar feed | `src/app/api/calendar/feed/route.ts`, `src/app/api/calendar/[studentId]/route.ts`, `src/lib/calendar-feed.ts` | opaque v2 token과 legacy v1 접근 |
| Scheduled maintenance | `worker.ts`, `src/lib/scheduled-maintenance.ts`, `src/db/d1-context.ts` | request context 없는 Cron에서 bounded account alias·media outbox 수렴 |
| Deploy | `open-next.config.ts`, `wrangler.toml`, `wrangler.scheduled.toml`, `wrangler.maintenance.toml` | application·예약 정리·점검용 Worker artifact와 binding 경계 |

## 런타임과 프레임워크

| 영역 | 값 |
|---|---|
| Runtime | Node.js 22 이상, Cloudflare Workers |
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
| `/dashboard/student/notes` | 학생 노트 목록 |
| `/dashboard/student/assignments/[id]` | 과제 상세 직접 접근 |
| `/dashboard/student/notes/new` | 학생 본인 노트 전체 화면 작성 |
| `/dashboard/admin/students/[id]/notes` | 관리자 대상 학생 노트 목록 |
| `/dashboard/admin/students/[id]/notes/new` | 관리자 대상 학생 노트 전체 화면 작성 |
| `/dashboard/notes/[noteId]` | 권한 검증된 개인 노트 읽기·이어쓰기 |
| `/dashboard/notes/[noteId]/history` | 개인 노트 불변 revision 조회·선택 복원 |
| `/dashboard/notes/trash` | 권한 범위의 개인 노트 휴지통·복원·관리자 영구 삭제 |
| `/community/[postId]/history` | 커뮤니티 게시물 불변 full-snapshot revision 조회·선택 복원 |
| `/community/trash` | 권한 범위의 게시물 휴지통·복원·관리자 영구 삭제 |
| `/dashboard/admin/students/new` | 학생 추가 |
| `/dashboard/admin/students/[id]` | 학생 상세 |
| `/dashboard/admin/categories` | 카테고리 관리 |
| `/dashboard/qna/**` | Q&A 목록·작성·상세·불변 event 이력·휴지통 |
| `/community/**` | 커뮤니티 목록·작성·상세 |
| `/dashboard/calendar` | 공유 캘린더 |
| `/api/calendar/feed` | raw 계정 ID를 URL에 넣지 않는 opaque v2 token `.ics` feed |
| `/api/calendar/[studentId]` | session과 기존 v1 서명 token 호환 `.ics` feed |
| `/api/media/[mediaObjectId]` | owner·게시물 audience·Q&A 참여자 권한을 재검증하는 private media delivery |
| `/api/account-cleanup/register` | 인증된 학생 기기의 cleanup token digest 등록 |
| `/api/account-cleanup/status` | 삭제 신호만 반환하는 익명·same-origin·no-store 상태 조회 |

`/dashboard/student/assignments`, `curriculum`, `digging` 목록 경로는 원페이지 포털로 redirect한다. 노트 목록은 별도 route를 사용한다.

학생 포털의 기본 section은 `오늘`이다. 통합 item에서 다음 일정, 피드백이 있는 제출, Q&A 상태를 순수 selector로 분류하고 최근 공지와 실제 작성 경로를 함께 제공한다. `lessons` 행은 `EVENT`/`LESSON` 항목으로 포함하므로 다음 일정 selector와 워크스페이스에서 같은 계약을 사용한다. 현재 schema에 없는 과제 배정·마감·읽음 상태는 추정하지 않는다. 캘린더, 일별 기록, 전체 항목, 커리큘럼, 과제는 `워크스페이스` section에서 기존 기능을 유지한다.

관리자 포털의 기본 section은 `업무함`이다. 전체 Q&A 중 미답변 항목, feedback이 없는 assignment, 앞으로 7일 이내의 학생별 다음 레슨을 조회한다. 질문과 과제는 오래 기다린 항목부터 보여주고 실제 Q&A·과제 상세로 연결한다. 일정 section은 선택한 학생 스페이스를 상시 표시하고 각 통합 항목의 스페이스·출처를 식별한다.

통합 항목은 raw `id`를 route 진입에 유지하면서 `<source kind>:<entity>:<id>` 형식의 UI key를 별도로 사용한다. `calendar_events`와 `lessons`, 외부 공개 캘린더 사이에는 안정적인 연결 키가 없으므로 같은 시각이나 제목만으로 dedupe하지 않으며, 서로 다른 행을 모두 표시한다. source kind는 `PORTAL`, `GOOGLE_CALENDAR`, `ICLOUD_CALENDAR`이고 entity는 내부 항목 또는 `EXTERNAL_CALENDAR_EVENT`다. 학생 스페이스 label은 display name을 trim해 우선 사용하고 비어 있으면 email을 사용한다.

학생은 하나의 전용 공개 Google 또는 iCloud iCal 레슨 캘린더를 연결할 수 있다. 구독 URL은 `external_calendar_subscriptions`에 AES-256-GCM과 학생·provider AAD로 암호화해 저장하며, 조회 action과 UI에는 provider·label·연결 여부만 반환한다. fetch는 허용 host/path, HTTPS, redirect 거부, 5초 timeout, 1 MiB streaming 상한과 VCALENDAR 검증을 거친다. 파서는 `ical.js`로 반복·EXDATE·override·취소·all-day를 bounded window의 read-only `EVENT`/`LESSON`으로 정규화한다. 외부 fetch 또는 복호화가 실패해도 내부 일정만 반환한다.

학생과 관리자 포털은 공통 `PortalShell`과 `PortalNavigation`을 사용한다. section 선택은 역할별 local storage key에 편의 상태로 저장한다. root skip link와 main landmark, 이름이 있는 side rail control, dashboard loading/error boundary를 공통 shell 경계로 둔다. 학생 roster는 mobile label-value list와 desktop table을 분리하고 desktop 확장은 실제 button으로 조작한다.

노트 탐색과 작성은 분리한다. 학생은 `/dashboard/student/notes`, 관리자는 학생별 `/dashboard/admin/students/[id]/notes`에서 제목·노트 날짜·작성자·평문 미리보기·최근 변경 시각과 노트 열기 링크를 확인한다. 목록은 저장 HTML을 직접 렌더하지 않는다. 캘린더의 노트 추가는 역할별 전체 화면 작성 URL에 선택한 엄격한 `YYYY-MM-DD`와 내부 `returnTo`만 전달한다. 잘못된 날짜는 KST 오늘로 대체하고, 기존 초안이 있으면 초안 날짜가 URL 기본값보다 우선한다.

디깅 보드는 같은 column·track 데이터를 768px 미만에서 label-value record list로, 그 이상에서 TanStack Table 기반 data grid로 표시한다. 두 표현은 같은 edit cell과 server action을 사용한다.

## 데이터 모델과 저장소

`src/db/schema.ts`의 주요 table:

- 사용자·수업: `profiles`, `curriculums`, `lessons`, `external_calendar_subscriptions`
- 과제·피드백: `assignments`, `feedbacks`
- 콘텐츠: `categories`, `posts`, `post_revisions`, `comments`
- 개인 학습 기록: `private_notes`, `private_note_revisions`, `calendar_events`
- 문서 연속성: `document_operation_ledger`, `document_tombstones`, `document_batch_abort_guard`, `document_server_drafts`, `document_server_draft_operations`
- 미디어 수명주기: `media_objects`, `media_deletion_outbox`
- 개인정보 수명주기: `account_deletion_jobs`, `account_cleanup_tokens`, `calendar_feed_tokens`
- 디깅: `digging_columns`, `digging_tracks`
- Q&A: `qna_threads`, `qna_thread_events`, `qna_replies`

Cloudflare binding:

| Binding | Resource | 용도 |
|---|---|---|
| `DB` | D1 database | 포털 데이터 |
| `BUCKET` | R2 bucket | 미디어 저장 |
| `ASSETS` | OpenNext assets | 정적 asset |

Migration SQL은 `drizzle/`, Drizzle metadata는 `drizzle/meta/`에 둔다. Wrangler는 SQL 파일명과 D1의 적용 이력을 기준으로 migration을 실행하고, Drizzle metadata는 다음 schema diff 생성 기준으로 사용한다. SQL·journal·snapshot은 `0000~0013`까지 대응한다. `npm run db:check`는 empty replay와 current schema/latest snapshot의 column·FK·index뿐 아니라 문서·미디어·개인정보·외부 캘린더 구독 CHECK·FK·unique index, 불변·부활·교체 우회 방지 probe, `0007` fixture upgrade·inbound FK preflight, `0008→0009` account cascade, 기존 게시물·Q&A의 `0009→0010`, 기존 URL을 보존하는 `0010→0011`, populated `0011→0012` 개인정보 및 `0012→0013` 외부 캘린더 upgrade를 검사한다. 이 체인은 저장소의 schema 계약이며 persistent local·remote D1의 현재 적용 이력을 뜻하지 않는다. 환경별 실제 적용 목록과 pending 범위는 [운영 상태 확인 기준](./DEPLOYMENT.md#운영-상태-확인-기준)으로 확인한다. 외부 캘린더 코드의 promotion에는 대상 D1의 `0013`이 필요하다.

신규 업로드는 사용자에게 노출된 `media-upload/` staging key로만 PUT하고, 서버가 size·Content-Type metadata·ETag를 확인한 뒤 사용자에게 공개되지 않은 별도 `media/` final key로 봉인한다. D1의 `SEALING` lease가 봉인과 삭제를 직렬화하며, 결과를 잃은 Copy는 복구 유예 뒤 final 삭제 outbox가 다시 정리한다. 문서에는 object ID와 `/api/media/{id}`만 저장하고, 게시물과 Q&A의 원자 생성·purge transaction이 registry claim과 R2 삭제 의도를 함께 commit한다. R2 삭제는 lease·지수 backoff를 사용하는 durable outbox로 재시도한다.

예약 정리 source는 OpenNext application fetch를 유지한 custom Worker entry에 `scheduled` handler를 추가한다. request AsyncLocalStorage에 의존하지 않고 event의 D1·R2 binding을 직접 주입하며, 30일이 지난 계정 raw ID alias, 만료 미귀속 media enqueue, 기존 R2 deletion outbox를 작은 순차 batch로 처리한다. soft time budget은 처리 중인 transaction이나 R2 요청을 취소하지 않고 다음 작업 claim만 멈춘다. 로그는 처리 건수·backlog·stage 상태만 포함하며 계정 ID, object key, digest와 예외 원문을 기록하지 않는다. `wrangler.scheduled.toml`에는 Cron trigger와 route를 넣지 않고 원격 운영 trigger를 별도로 관리한다. handler 구현과 원격 trigger 활성 상태는 별도로 확인한다. 운영 수용에는 활성 target version의 실제 scheduled invocation, backlog·실패와 alert 증거가 필요하다.

## 인증과 권한

- credentials provider는 email/password와 bcrypt hash를 비교한다.
- session의 `user.id`는 profile 조회의 시작점으로만 사용한다. Node auth의 JWT callback, `/api/auth/session`과 모든 server 인증 경계가 profile 존재와 DB의 최신 role을 다시 확인해 삭제된 JWT를 즉시 거부한다. JWT/session 최대 수명은 7일로 고정해 raw subject ID의 30일 보존 경계보다 먼저 만료시킨다.
- 데이터 조회·변경 함수는 호출 화면에 의존하지 않고 role과 ownership을 자체 검증해야 한다.
- 신규 캘린더 feed는 256-bit opaque token의 SHA-256 digest로 owner를 찾고 회전 시 이전 digest를 폐기한다. 기존 v1 URL은 active 학생 profile을 먼저 확인한 뒤 서명을 검증한다.
- 학생 계정 삭제는 현재 비밀번호, persistent 또는 memory-only 기기 digest와 UUID operation을 요구한다. persistent token은 삭제 batch에서 모두 job에 결합하고 memory-only digest는 cleanup token quota를 소비하지 않는 job initiating receipt로 기록한다. job·profile 삭제는 함께 commit하거나 rollback하며, admin 삭제는 이 흐름에서 거부한다.
- rich text는 HTML5 AST를 새 안전 트리로 복사하는 tag·속성·URL allowlist로 서버 저장과 렌더 경계에서 sanitize한다. DOM emulation 없이 Node·browser·Worker에서 같은 동기 결과를 사용한다.
- Q&A 상태 변경은 관리자 역할과 허용된 `OPEN`, `ANSWERED`, `CLOSED` 값인지 함께 검증한다.

## 문서 작성과 연속성

- `FullEditor`는 Tiptap 기반 block·inline 서식, slash command, 링크·이미지·YouTube 삽입 panel, Markdown 전환과 실행 취소를 제공한다. 저장 단축키는 editor 안에 한정하지 않고 상위 form 전체에서 처리한다.
- 저장된 rich text는 `RichTextContent`와 공통 `.rich-text` 스타일로 렌더한다. 서버 저장 전에 sanitize하고 YouTube는 privacy-enhanced embed만 유지한다.
- `useFormDraft`는 노트·게시물·Q&A의 작성자와 문서 문맥을 포함한 versioned local storage key를 사용한다. 각 저장은 raw hash에 결합된 불변 shadow를 canonical보다 먼저 기록하고, 다음 자기 shadow가 안전해진 뒤 이전 것을 정리한다. 구버전 mutable shadow와 미래 storage version은 rolling client의 새 입력을 지울 수 있어 자동 물리 삭제하지 않는다. 미래 version canonical이 있으면 새 입력을 recovery로 격리하고 저장소 오류와 무관하게 서버 제출을 잠근다. 이미 확인한 잠금은 page session 동안 문서 key별로 기억하고, recovery 쓰기 실패 시 현재 화면본을 writer별 메모리 안전본으로 유지해 SPA 재진입과 이탈 경고 경로에 합류시킨다. 삭제 성공 뒤 현재 기기는 cleanup token 유무와 관계없이 raw ID를 저장하지 않는 durable terminal lock을 먼저 기록하고 owner allowlist를 직접 정리한다. 모든 draft·server queue writer가 lock을 재확인해 열린 탭의 늦은 재생성을 막으며, 저장소가 차단돼 완료를 증명할 수 없으면 자동 재시도를 주장하지 않고 브라우저 사이트 데이터의 수동 삭제를 안내한다.
- `useSyncedFormDraft`는 로컬 복구 계약을 유지한 채 같은 사용자·문서 key의 계정 초안을 연결한다. 서버는 최신 payload 하나와 단조 증가 `draft_version`, base resource revision, writer device ID를 30일 보존하고 UUIDv4 operation receipt로 응답 유실 재전송을 구분한다. 저장과 폐기는 기대 version이 맞을 때만 원자 처리하며 같은 payload의 저장은 version을 늘리지 않는다. profile 삭제는 초안 원문과 receipt를 함께 cascade한다.
- 브라우저는 source별 최신 `UPSERT` 또는 `DISCARD` 의도 하나만 local storage queue에 남긴다. 같은 raw 재시도는 operation ID를 유지하고 내용·CAS 기준이 달라지면 새 operation으로 회전한다. 성공 응답은 보낸 raw가 아직 현재 queue일 때만 제거하며, 충돌 없는 전송 중 생긴 새 입력만 최신 서버 version으로 다시 기준을 잡는다. 30일이 지난 queue와 만료 서버본은 실행하지 않고 stale version의 자동 부활을 거부한다.
- 초기 확인, online·focus·storage event와 visible 상태의 주기 확인에서 다른 기기 최신본을 비교한다. payload가 다르면 로컬 원문과 queue를 보존하고 자동 병합 없이 계정 작성본 사용 또는 내 초안으로 계속을 선택한다. 선택 전 추가 입력은 로컬에만 보존하고 `UPSERT` 전송을 잠근다. 게시·저장 성공과 명시적 폐기는 `DISCARD`를 즉시 전송하고 실패 시 durable queue로 재시도한다.
- editor 입력 transaction은 문서 revision만 증가시키고 전체 HTML 직렬화는 200ms 정지, draft flush 또는 submit 경계까지 늦춘다. 연속 입력이 멈추지 않아도 첫 pending 뒤 최대 5초에 최신 snapshot을 checkpoint한다. 최신 HTML reader를 draft pending에 즉시 연결하고 revision별 결과를 cache해 마지막 입력을 잃지 않으면서 매 키 입력의 전체 문서 순회를 피한다. Markdown 전체 parse와 draft payload signature 계산도 같은 지연 경계를 사용한다.
- slash command 탐색은 커서 앞 검색어 최대 64자와 경계 문자만 읽어 단일 문단 전체를 매 transaction마다 순회하지 않는다.
- page hide·탭 숨김·unmount 전에 pending 값을 flush하며, 저장공간 재시도도 실패하면 writer별 메모리 안전본을 유지하고 브라우저 이탈을 경고한다. 저장소가 회복되면 canonical보다 최신인 안전본만 현재 입력으로 채택하고 나머지는 durable recovery로 승격한다. 제출 cutoff용 원래 작성 시각과 recovery 보존 시작 시각을 분리하며, 같은 문서의 열린 탭에는 `BroadcastChannel`과 동일 문서 event로 제출 완료를 전달한다. 제출 완료 시 저장소 읽기·쓰기·삭제가 모두 막혀도 page-session marker로 cutoff 이전 초안을 숨기고, durable tombstone과 정리가 확인될 때까지 이탈을 경고한다. 같은 내용의 cutoff는 새 벽시계와 이미 관측한 causal 저장 시각 중 큰 값을 사용해 최초 제출 직전 시계 역행에도 낮아지지 않는다.
- 충돌·중단 복구본은 최대 30일 보존하며 최근 20개 기준으로 정리하고, UI에서 전체 저장 시각·제한된 제목/본문 미리보기·현재 화면본을 확인한 뒤 선택 복원하거나 2단계 확인으로 삭제할 수 있다. 같은 내용의 안전본은 causal 저장 시각이 가장 최신인 사본을 남기며, canonical과 같은 사본도 별도 key 사이의 교체 경합 때문에 화면에서만 숨기고 자동 물리 삭제하지 않는다. 복구본 목록 정리는 compaction에서 한 번 해석한 recovery·marker·canonical·causal raw 상태를 재사용하고, namespace가 달라지면 만료 marker를 보수적으로 유지한다. 여러 제출 표현의 cutoff 계산·삭제 후보 관측과 marker 기록도 각각 batch 처리해 같은 대형 원문과 marker namespace를 alias마다 다시 순회하지 않는다. 제출 이력은 내용 서명별 append-only tombstone을 같은 30일 동안 개수 제한 없이 유지해 연속 제출 뒤 잠든 탭의 ghost 복원을 차단한다. 복원·채택 시점에도 tombstone과 원래 저장 시각을 다시 검증하며, tombstone이 가리는 causal snapshot이 남아 있으면 기본 보존 기간을 넘겨도 먼저 제거하지 않는다. 작성 폼이 활성인 동안의 선제 정리는 브라우저 유휴 시간이 남으면 최대 4개, 시간 제한으로 실행될 때는 1개 key씩 나눠 현재 열리지 않은 문서의 current-version 불변 recovery만 정리한다. 큰 key·원문과 causal 전역 확인이 필요한 marker는 이 경로에서 보존하고, marker는 해당 source 정리에서, 큰 recovery와 marker를 포함한 전역 정리는 quota 재시도에서 수행한다. future·legacy·손상 데이터와 active source는 전역 정리에서 보수적으로 보존한다. 사이드 레일의 기기 초안 관리에서는 현재 계정의 문서 namespace를 안전한 미리보기와 함께 모아 보고 문서별 또는 전체 폐기할 수 있다. 제출 tombstone이 가린 ghost는 목록에서 제외한다. 로그아웃 직전에는 해당 계정의 canonical·recovery·future·legacy·marker와 메모리 pending을 지우고 열린 작성 흐름의 재저장을 잠근다. 다음 계정 인증 시에는 다른 계정의 잔여 namespace를 다시 정리한다.
- 포털 section, workspace view와 관리자 학생 선택은 URL에 기록한다. 작성 화면과 저장된 문서는 검증된 내부 `returnTo`를 전달해 직전 작업 문맥으로 돌아간다.
- 첨부 업로드·서버 제출 중에는 제목·분류·첨부·editor mutation, submit, 화면 내 SPA link, 상위 상태 전환과 slide panel dismiss를 잠근다. hard navigation에는 이탈 경고를 제공하고 진행 중 업로드가 unmount되면 전송을 중단한다. 브라우저 Back/Forward와 임의의 programmatic route 전환은 client만으로 완전히 취소할 수 없으므로 실제 브라우저 E2E가 별도로 필요하다.
- 새 노트·게시물·Q&A 질문·답변의 draft에는 UUIDv4 생성 작업 nonce를 저장하고 submit 직전에 전체 snapshot을 flush한다. 서버는 인증된 작성자·대상·문서 종류를 함께 영역 분리한 결정적 UUIDv8을 실제 resource ID로 사용한다. 같은 nonce와 정규화 payload의 순차·동시 재전송은 기존 결과를 반환하며, 같은 작성 흐름의 다른 payload는 초안을 유지한 채 기존 문서 열기 또는 별도 문서 분리를 선택하게 한다.
- 개인 노트와 커뮤니티 게시물은 안정 URL에서 다시 편집할 수 있다. 편집 draft와 요청은 전체 서버 기준 본문을 복제하지 않고 문서 종류·ID·저장 원문·날짜를 영역 분리한 SHA-256 지문만 보존한다. rolling 구버전 client에는 유효 서버 문서와 같을 수 없는 고정 sentinel을 함께 저장해 compact draft를 안전한 stale 상태로 연다. 저장 성공 시 compact 표현, 기준 metadata가 없는 표현, 현재 서버 기준의 구버전 표현과 사용자 필드가 같은 실제 복원 표현에 각각 cutoff tombstone을 남겨 업데이트 전 탭이 제출 전 초안을 다시 복원하지 못하게 한다. 다른 사용자 내용의 복구본은 이 alias에 포함하지 않는다. 서버는 현재 저장본의 지문을 대조하고 실제 조회한 필드를 조건으로 갱신해 다른 화면의 선행 저장을 감지한다. 노트의 날짜 입력은 생성·편집 모두 비어 있거나 실제 존재하는 canonical `YYYY-MM-DD`만 허용한다. 오래된 기준본을 복원하면 서버 최신본과 현재 초안 중 선택하게 하며, 저장 성공 응답이 유실된 동일 payload 재전송은 update 전 현재값 확인과 CAS 실패 뒤 재조회로 성공에 수렴한다.
- 개인 노트 mutation은 UUIDv4 operation ID와 명시적 base revision을 사용한다. D1 `batch()`와 로컬 SQLite transaction 안에서 immutable receipt, 조건부 head 변경, fail-closed sentinel, 새 full-snapshot revision을 함께 commit하거나 전부 rollback한다. 같은 operation의 exact replay는 historical result revision과 현재 head revision을 분리해 반환하며 다른 payload는 충돌로 거부한다. canonical no-op은 head와 revision을 늘리지 않고 재전송 가능한 receipt만 남긴다.
- 개인 노트 삭제는 `deleted_at` soft delete다. active 기본 조회는 휴지통 노트를 제외하고, trash/restore와 과거 revision restore는 각각 새 revision을 만든다. 30일 만료 뒤 admin purge만 head와 revision을 제거하며 tombstone과 본문 없는 ledger가 늦은 create/update의 부활을 차단한다. revision은 문서가 active/trash인 동안 append-only이고 일반 profile 삭제는 `RESTRICT`하며 전용 account-deletion transaction만 이력을 먼저 완결 삭제한 뒤 profile을 제거한다.
- 개인 노트는 Server Action 기본 1MB body의 action/form envelope 여유를 남기기 위해 sanitize된 HTML 본문 800 KiB, 제목 200자, 사용자별 head와 내용 변경 revision 100 MiB의 logical quota를 적용한다. `TRASH`·`RESTORE_TRASH` 상태 snapshot은 사용자 quota에서 제외하고 실제 D1 사용량 관측 대상으로 남긴다. version 충돌은 자동 병합하지 않고 현재 초안을 보존한 채 서버 최신본을 펼쳐 확인·복사한 다음 서버본 사용 또는 현재 초안 계속을 선택한다.
- 커뮤니티 게시물의 생성·편집·고정 변경·휴지통 이동·복원·과거 revision 복원·영구 삭제도 UUIDv4 operation ID와 명시적 base revision을 사용한다. head, 불변 receipt와 full-snapshot revision을 D1 `batch()` 또는 로컬 transaction에서 함께 처리한다. exact replay는 이후 다른 변경이 있어도 원래 결과 revision으로 수렴하며, 저장된 snapshot hash가 맞지 않으면 과거 revision 복원을 거부한다.
- 게시물 댓글은 head와 함께 삭제하지 않는다. 휴지통 게시물은 기본 목록과 통합 기록에서 제외하고 읽기 전용으로만 열며, DB trigger가 휴지통 상태에서 새 댓글과 댓글 삭제 경쟁을 차단한다. 게시물을 복원하면 기존 댓글이 다시 함께 보이고, 관리자 purge 때만 FK cascade로 제거한다.
- 새 게시물·Q&A 질문·답변의 `Cmd/Ctrl+S`는 공개 action을 호출하지 않고 최신 form snapshot을 로컬에 flush한다. 노트와 기존 문서 편집의 단축키는 명시된 서버 저장 action을 사용한다.
- Q&A의 스레드·첫 본문, 답변·상태 변경, 휴지통 이동·복원·영구 삭제는 D1 binding batch 또는 로컬 SQLite transaction으로 함께 commit하거나 rollback한다. 각 mutation은 operation receipt와 append-only `qna_thread_events`를 남기고 version CAS를 적용한다. 답변 쓰기는 ownership과 `CLOSED`·휴지통 상태를 원자 쓰기 안에서 다시 검증한다.
- Q&A 답변은 휴지통 이동·복원 동안 보존되고 관리자 purge 때만 스레드와 함께 제거된다. active 기본 조회와 통합 기록은 휴지통 질문을 제외하며, tombstone과 본문 없는 ledger가 purge 뒤 늦은 질문·답변·상태 요청의 부활을 차단한다.
- 모든 작성 form은 draft hydration이 끝날 때까지 입력을 잠근다. 종료된 Q&A도 로컬 초안이나 복구본이 남아 있으면 읽기 전용 composer를 유지하고, 업로드 오류·진행률은 alert와 progressbar 의미로 노출한다.

노트·게시물·Q&A 초안은 로컬 복구와 사용자·문서별 서버 최신본, 오프라인 재시도, 다중 기기 비교를 제공한다. 세 문서 영역 모두 versioned server lifecycle, 30일 휴지통, 관리자 purge와 anti-replay ledger/tombstone을 제공한다. 게시물은 full-snapshot revision, Q&A는 질문 상태의 append-only event와 보존된 답변을 사용한다. 계정 삭제 전에 등록된 기기는 local raw token을 서버에 보내지 않고 digest 상태만 조회해 삭제된 owner의 namespace를 정리한다. 저장소 자체를 사용할 수 없는 상태에서 브라우저 프로세스를 강제로 종료하면 메모리 안전본도 유지할 수 없다. 과거 owner 정보가 없는 local storage draft는 계정 간 노출을 막기 위해 자동 이관하거나 임의 계정 정리에 포함하지 않으며 로그인 화면의 명시적 snapshot 확인으로만 지운다.

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
| `EXTERNAL_CALENDAR_ENCRYPTION_KEY` | 공개 iCal URL AES-256-GCM용 32-byte base64/base64url key | Worker/local secret, 운영 미설정 |
| `R2_BUCKET_NAME` | upload bucket 이름 | 환경별 설정 |

샘플 계약은 `.env.example`에 두고 실제 값은 commit하지 않는다. 신규 managed media는 public bucket URL을 runtime 설정으로 사용하지 않는다. 기존 URL의 trusted base는 배포 전 inventory·backfill 입력으로만 별도 관리한다.

## 테스트와 검증

```bash
npm run db:check
npm test
npm run test:integration
npm run lint
npx tsc --noEmit
npm run build
npm run build:worker
npm run build:maintenance
npm run build:scheduled
npm audit --omit=dev --audit-level=moderate
```

현재 migration consistency와 `0007` upgrade, `0008→0009` account cascade, `0009→0010` 게시물·Q&A baseline, `0010→0011` media, `0011→0012` 개인정보 및 `0012→0013` 외부 캘린더 upgrade, CHECK·trigger semantic probe, 개발용 관리자 seed의 환경·입력 경계, active-profile auth guard, calendar token 회전·변조, HTML AST sanitize·YouTube payload, local draft와 서버 초안 연속성이 자동화되어 있다. 격리 D1은 노트·게시물·Q&A와 미디어 claim·봉인·purge, 학생 계정 삭제·exact replay·30일 raw-ID alias의 원자 rollback을 검증한다. 예약 정리는 bounded enqueue, poison job 격리, soft budget, 무민감 aggregate log를 검증하고 별도 설정의 maintenance·scheduled Worker를 dry-run bundle한다. DOM 격리 환경에서는 로컬 복구, terminal lock, owner별 계정 정리, ownerless snapshot 확인, 오프라인 재시도와 다중 기기 선택을 검증한다. 실제 브라우저 E2E와 production migration·R2 설정·Cron trigger·deploy는 별도 범위다.

UI token, 상태 registry, 공통 component와 접근성 규칙은 [디자인 시스템](./DESIGN_SYSTEM.md)을 기준으로 한다. 상태 registry는 label, semantic tone, icon key가 서로 어긋나지 않도록 단위 테스트로 보호한다.

| 품질 경계 | 현재 자동화 | 다음 보강 |
|---|---|---|
| Migration | SQL·journal·snapshot·current schema empty replay, CHECK·trigger, `0007` upgrade·inbound FK preflight, `0008→0009` cascade, `0009→0010` 게시물·Q&A, `0010→0011` media, `0011→0012` privacy, `0012→0013` 기존 데이터 보존·구독 제약·owner cascade | persistent local·remote의 실제 적용 목록에서 pending 범위를 계산하고 승인된 작업 창에서 점검 |
| 개발 credential | development/opt-in/env/input binding 단위 테스트 | 실제 local seed는 데이터 변경 작업으로 분리 |
| 인증·권한 | 미인증·role·ownership 허용/거부 단위 테스트, Q&A 격리 D1 권한 회귀 | 다른 주요 server action의 실제 query·mutation 경계 테스트 |
| 입력·콘텐츠 | HTML5 AST tag·속성·URL allowlist, malformed·foreign-content XSS, 멱등성, upload MIME·size·quota·opaque key 정책 | 실제 R2 CORS·대용량 PUT smoke |
| 미디어 | staging/final key 분리, SEALING lease·late Copy 복구, claim/purge rollback, bounded 만료 enqueue, outbox 재시도·final prefix cursor reconciliation·private RBAC·Range 자동 테스트 | 원격 trigger·실행 상태와 실제 R2 PUT·inventory 운영 검증 |
| 문서 연속성 | local shadow·5초 checkpoint·복구·제출 경쟁, 사용자·문서별 서버 최신본·CAS·offline queue·다중 기기 명시 선택 DOM 통합, 노트·게시물·Q&A revision/event·trash·purge·anti-replay 격리 D1 통합 | 실제 브라우저 reload·offline·navigation·강제 종료·대형 문서 E2E |
| 계정 개인정보 | student-only 원자 삭제, old JWT 거부, cleanup digest·terminal lock, ownerless snapshot 확인, 30일 alias·second-run no-op·poison job 격리, edge-local status rate limit·rollout flag | 유효 삭제 flag, Cron/alert·오프라인 adoption 확인과 승인된 삭제 smoke |
| UI 상태 | status registry 단위 테스트, loading/error route, semantic landmark·control 정적 검토 | keyboard interaction component 테스트 |

## 변경 시 같이 볼 파일

| 변경 영역 | 함께 확인할 파일 |
|---|---|
| auth·role | `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts`, `docs/REQUIREMENTS.md` |
| schema·migration | `src/db/schema.ts`, `drizzle/**`, 관련 action, `docs/TECH_SPEC.md` |
| student portal | `src/app/dashboard/student/page.tsx`, `src/components/student-portal/**` |
| admin portal | `src/app/dashboard/admin/page.tsx`, `src/components/admin-portal/**`, `src/lib/actions/students.ts` |
| rich text·input | 관련 form, `src/lib/sanitize-html.ts`, server action |
| 문서 draft·재진입 | `src/lib/form-draft.ts`, `src/lib/hooks/useFormDraft.ts`, `src/lib/hooks/useSyncedFormDraft.ts`, `src/lib/actions/documentDrafts.ts`, 안정 문서 route |
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
- migration SQL과 `drizzle/meta` 생성 이력은 `0012`까지 대응하고 격리 D1에서 전체 replay, `0009→0010`, populated `0010→0011→0012` upgrade를 검사한다. persistent local D1은 `0009`까지 적용됐으며 `0010~0012`와 remote 적용 이력은 승인된 운영 점검 전 추정하지 않는다.
- 대표 문서 server action과 draft 생명주기의 격리 integration test는 있으나 실제 브라우저 reload·offline·navigation·delete/restore E2E는 없다.
- 신규 managed media의 registry·문서 claim·purge 삭제 outbox와 인증 delivery, bounded 예약 정리·final prefix cursor reconciliation source를 구현했다. Copy timeout·lease·recovery grace 뒤 발견된 registry 없는 final object와 삭제 상태 object는 다음 inventory page에서 재삭제한다. production에서는 private R2 CORS·staging lifecycle·Cron과 알림을 검증해야 하며, 기존 외부 URL과 managed 형식이 아닌 legacy R2 object는 자동 삭제 대상으로 추정하지 않는다.
- 큰 문서의 전체 HTML·payload 서명은 매 입력이 아니라 지연된 flush·submit 경계에서 revision당 한 번만 만들고, 연속 입력은 최대 5초마다 최신본을 checkpoint한다. 개인 노트는 저장 HTML 800 KiB와 logical history 100 MiB 정책을 적용한다. 다만 실제 브라우저의 100 KiB·500 KiB·1 MiB frame budget과 autosave·복구 latency를 측정하지 않아 제품급 입력 부드러움은 아직 검증되지 않았다.
- rolling 호환용 제출 alias는 ghost 복원을 막기 위해 signature별 tombstone을 30일 동안 보존한다. 반복 편집 시 여러 unique entry가 origin 저장공간에 누적될 수 있으므로, 호환 종료 조건과 문서 namespace별 byte budget·용량 안내 정책은 아직 확정하지 않았다.
- 계정 삭제의 profile·원문 즉시 제거, 등록된 오프라인 기기 cleanup digest, edge-local status rate limit과 30일 raw-ID alias workflow는 구현했다. 첫 production version은 삭제 rollout flag를 닫고 cleanup·erasure scheduler와 backlog를 확인한다. 등록 전부터 오프라인인 기기는 서버가 ownerless local draft를 식별할 수 없으므로 adoption 확인 뒤 별도 version에서만 삭제를 연다.
- maintenance와 scheduled Worker artifact, log persistence·rate limit·inventory reconciliation config는 준비돼 있다. production Cron trigger와 backlog alert, immutable version 전환은 승인된 운영 작업에서 실제 검증한다.
- 운영 D1의 read-only inventory와 full export 격리 restore rehearsal은 통과했다. 실제 migration rollback anchor는 maintenance write fence 뒤 새 export/checksum과 Time Travel bookmark로 다시 확보해야 한다.
- 일부 대형 client component는 상태 hook, domain view와 presentation 경계가 한 파일에 남아 있다.
- 소셜 공유 이미지는 승인된 브랜드 asset이 준비된 뒤 metadata에 연결해야 한다.
