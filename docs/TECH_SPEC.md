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
      ├─ calendar feed API
      └─ calendar connection API(Google OAuth)
          ├─ Drizzle ORM → Cloudflare D1 / local SQLite
          ├─ Worker upload route → R2 binding
          └─ calendar sync engine → Google Calendar API / iCloud CalDAV

OpenNext → Cloudflare Worker
```

## 실제 소스 기준

| 영역 | 파일/경로 | 확인 내용 |
|---|---|---|
| Root·dashboard redirect | `src/app/page.tsx`, `src/app/dashboard/page.tsx` | session role별 시작 경로 |
| Auth | `src/auth.ts`, `src/auth.config.ts`, `src/proxy.ts` | credentials, session, route access |
| Student portal | `src/app/dashboard/student/page.tsx`, `src/components/student-portal/` | 오늘 요약·통합 워크스페이스·커뮤니티 |
| Admin portal | `src/app/dashboard/admin/page.tsx`, `src/components/admin-portal/` | 업무함·학생·일정(공지·커뮤니티는 `/community`) |
| Shared flows | `src/app/community/`, `src/app/dashboard/qna/` | 게시판·Q&A |
| Data aggregation | `src/lib/actions/unifiedItems.ts`, `src/lib/unified-item-normalization.ts`, `src/lib/utils/unifiedItemUtils.ts` | 학생 스페이스·포털 출처를 포함한 레슨·일정·노트·디깅·Q&A·과제 통합 |
| DB schema·client | `src/db/schema.ts`, `src/db/client.ts` | table, D1/local SQLite 선택 |
| Server actions | `src/lib/actions/` | query, mutation, revalidation |
| Security helpers | `src/lib/auth-guard.ts`, `src/lib/active-profile.ts`, `src/lib/sanitize-html.ts` | active profile·DB role·ownership, AST allowlist rich text sanitize |
| Local draft account boundary | `src/components/auth/`, `src/lib/account-cleanup-client.ts`, `src/lib/account-terminal-lock.ts`, `src/lib/local-draft-continuity-client.ts`, `src/lib/document-server-draft-logout.ts`, `src/lib/document-server-draft-discard-api.ts`, `src/app/api/document-drafts/discard/route.ts` | 기기 초안 목록·명시 폐기, 로그아웃·계정 전환·삭제 신호 정리 |
| Server draft continuity | `src/lib/actions/documentDrafts.ts`, `src/lib/hooks/useSyncedFormDraft.ts`, `src/components/editor/ServerDraftStatus.tsx` | 사용자·문서별 최신본, CAS·재전송, 오프라인 queue와 명시적 다중 기기 선택 |
| Document lifecycle | `src/lib/document-lifecycle-atomic.ts`, `src/lib/post-atomic.ts`, `src/lib/qna-atomic.ts` | 게시물·Q&A version CAS, 불변 이력·receipt, 휴지통·복원·purge·tombstone 원자 경계 |
| Storage | `src/lib/r2.ts`, `src/lib/media-lifecycle-atomic.ts`, `src/lib/actions/upload.ts`, `src/app/api/media/` | Worker 경유 staging upload(`PUT /api/media/upload/[id]`)·binding seal, D1 registry·삭제 outbox, 본문 이미지 연결(`src/lib/document-image-references.ts`), 인증 delivery |
| Account privacy | `src/lib/account-privacy-atomic.ts`, `src/lib/actions/accountPrivacy.ts`, `src/app/api/account-cleanup/` | 학생 본인 원자 삭제, 기기 cleanup digest, 30일 raw-ID alias |
| Calendar feed | `src/app/api/calendar/feed/route.ts`, `src/app/api/calendar/[studentId]/route.ts`, `src/lib/calendar-feed.ts` | opaque v2 token과 legacy v1 접근 |
| Assignment tasks | `src/lib/actions/assignmentTasks.ts`, `src/lib/assignment-recurrence.ts`, `src/lib/assignment-task-generation.ts`, `src/lib/assignment-submission.ts`, `src/components/admin/assignments/` | 관리자 출제·정기 과제 규칙, 조회 시 회차 생성, 형식별 제출 검증 |
| Guide | `src/lib/actions/guide.ts`, `src/lib/guide-store.ts`, `src/lib/guide-content.ts`, `src/lib/guide-asset-handlers.ts`, `src/lib/guide-import.ts`, `scripts/guide-import/build.ts`, `src/components/guide/` | 공용 가이드 CRUD·순서·이미지, 블록 앵커, 구간 질문 위치, Claude 문서 export 가져오기 |
| Calendar sync | `src/lib/calendar-sync/`, `src/lib/actions/calendarSync.ts`, `src/app/api/calendar-connections/`, `src/components/admin/calendar-sync/` | provider client(Google·CalDAV), 양방향 엔진, 자격 증명 암호화, OAuth route, 관리자 연결·매핑 화면 |
| Scheduled maintenance | `worker.ts`, `src/lib/scheduled-maintenance.ts`, `src/db/d1-context.ts` | request context 없는 Cron에서 bounded account alias·media outbox 수렴 |
| Deploy | `open-next.config.ts`, `wrangler.toml`, `wrangler.scheduled.toml`, `wrangler.maintenance.toml` | application·예약 정리·점검용 Worker artifact와 binding 경계 |

## 런타임과 프레임워크

| 영역 | 값 |
|---|---|
| Runtime | Node.js 22 이상, Cloudflare Workers |
| Framework | Next.js 16.4 App Router(Turbopack), React 19, OpenNext Cloudflare 1.20 |
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
| `/dashboard/student/assignments/[id]` | 과제 재생·타임라인 피드백. 학생 본인과 관리자만 열고, 검증된 `returnTo`로 직전 화면에 복귀한다. 관리자에게는 제출 학생을 표시한다 |
| `/dashboard/student/notes/new` | 학생 본인 노트 전체 화면 작성 |
| `/dashboard/guide` | 공용 가이드 페이지 목록(학생·관리자 공통, 사이드바 "가이드"). 관리자는 페이지 추가·순서 변경 |
| `/dashboard/guide/[pageId]` | 가이드 페이지 읽기. 학생은 문단을 골라 질문하고 본인 질문 위치를, 관리자는 모든 학생의 질문 위치를 본다 |
| `/dashboard/guide/[pageId]/edit` | 관리자 전용 가이드 편집(초안·version 충돌·이탈 보호, 삭제) |
| `/dashboard/admin/calendar-sync` | 관리자 캘린더 동기화 설정(운영 도구에서 진입): 서버 설정 안내, Google·iCloud 계정 연결·해제, 학생별 캘린더 매핑·지금 동기화·오류 표시 |
| `/dashboard/student/digging` | 학생 본인 디깅 보드: 트랙 값 편집·삭제, 컬럼 관리. 검증된 `returnTo`로 복귀 |
| `/dashboard/admin/students/[id]/notes` | 관리자 대상 학생 노트 목록 |
| `/dashboard/admin/students/[id]/notes/new` | 관리자 대상 학생 노트 전체 화면 작성 |
| `/dashboard/notes/[noteId]` | 권한 검증된 개인 노트 읽기·이어쓰기 |
| `/dashboard/notes/[noteId]/history` | 개인 노트 불변 revision 조회·선택 복원 |
| `/dashboard/notes/trash` | 권한 범위의 개인 노트 휴지통·복원·관리자 영구 삭제 |
| `/community/[postId]/history` | 커뮤니티 게시물 불변 full-snapshot revision 조회·선택 복원 |
| `/community/trash` | 권한 범위의 게시물 휴지통·복원·관리자 영구 삭제 |
| `/dashboard/admin/students/new` | 학생 추가 |
| `/dashboard/admin/students/[id]` | 학생 상세: 개요·과제·디깅·노트·Q&A 탭. 개요 탭은 레슨을 관리한다. 커리큘럼 모듈 관리는 코드에 남아 있지만 `src/lib/curriculum-visibility.ts` 스위치로 숨겨져 있다. 과제 탭은 출제 과제·정기 과제 관리(`AdminAssignmentsPanel`)와 제출 최신순·과제별 피드백 수를 보여 준다 |
| `/dashboard/admin/categories` | 자유 게시판 채널 추가·수정·삭제. 게시물이 참조하는 주소 식별자(slug)는 생성 뒤 바꾸지 않고 이름·설명·정렬 순서만 수정한다. 관리자 커뮤니티 section과 `/community`에서 진입 |
| `/dashboard/qna/**` | Q&A 목록·작성·상세·불변 event 이력·휴지통 |
| `/community/**` | 커뮤니티 목록·작성·상세 |
| `/dashboard/calendar` | 공유 캘린더 |
| `/api/calendar/feed` | raw 계정 ID를 URL에 넣지 않는 opaque v2 token `.ics` feed |
| `/api/calendar/[studentId]` | session과 기존 v1 서명 token 호환 `.ics` feed |
| `/api/media/[mediaObjectId]` | owner·게시물 audience·Q&A 참여자 권한을 재검증하는 private media delivery |
| `/api/account-cleanup/register` | 인증된 학생 기기의 cleanup token digest 등록 |
| `/api/account-cleanup/status` | 삭제 신호만 반환하는 익명·same-origin·no-store 상태 조회 |
| `/api/guide-assets` | 관리자 전용 가이드 이미지 업로드(JPG·PNG·GIF·WebP, 10MB, R2 `guide/<uuid>`) |
| `/api/guide-assets/[assetId]` | 로그인 사용자에게 가이드 이미지 전달 |
| `/api/calendar-connections/google/start` | 관리자 Google 연결 시작: state·PKCE를 봉인 cookie에 담고 Google 동의 화면으로 이동 |
| `/api/calendar-connections/google/callback` | Google OAuth redirect URI. cookie의 state·관리자·만료를 확인하고 code를 token으로 바꿔 연결을 저장한 뒤 설정 화면으로 돌아간다 |
| `/api/calendar-connections/google/notify` | Google 변경 알림 수신. 로그인 없이 channel id·token으로만 검증한다 |

`/dashboard/student/assignments`, `curriculum` 목록 경로는 원페이지 포털로, 예전 `/dashboard/admin/students/[id]/digging`은 학생 상세 디깅 탭으로 redirect한다. 노트 목록과 디깅 보드는 별도 route를 사용한다.

`/community`는 URL의 게시판·채널을 서버에서 확정해 채널 목록과 첫 페이지(30개)를 함께 렌더하고, 이후 게시판·채널 전환과 "게시물 더 보기"만 client에서 읽는다. 게시판 줄은 공지·믹스셋과 자유 게시판 채널(#)을 한 줄로 둔다. `getCommunityPostPage`는 공지·믹스셋을 고정 우선, 자유 게시판을 채널별 최신순으로 정렬하고 (고정 여부, 작성 시각, ID) keyset cursor로 겹침 없이 이어 읽으며, 모든 게시판 목록에 미리보기에 필요한 본문 앞 4,096자와 댓글 수(`comments` 집계 서브쿼리)만 보낸다. 받은 목록과 현재 위치가 다르면 빈 상태 대신 skeleton을 보이며, 자유 게시판 채널이 없으면 관리자에게는 채널 추가 경로를, 학생에게는 대기 안내를 보인다.

학생 홈은 게시물 본문 없이 공지 3개의 요약만 읽는다. 예전 포털 구역 주소 `?section=community`(학생·관리자)와 `?section=announcements`(관리자)는 `/community`(공지는 `boardType=ANNOUNCEMENT`)로 redirect한다. 통합 일정의 노트는 본문 앞 4,096자만 읽어 240자 평문 미리보기로 전달하고, 상세 패널을 열 때 해당 노트 본문만 권한을 다시 확인해 불러온다.

학생 포털의 기본 section은 `오늘`이다. 통합 item에서 다음 일정, 피드백이 있는 제출, Q&A 상태를 순수 selector로 분류하고 최근 공지와 실제 작성 경로를 함께 제공한다. `lessons` 행은 `EVENT`/`LESSON` 항목으로 포함하므로 다음 일정 selector와 워크스페이스에서 같은 계약을 사용한다. 관리자 출제 과제는 마감·제출 상태를 갖지만, 읽음 상태는 schema에 없으므로 추정하지 않는다. 캘린더(월·주·일별·전체 하나의 세그먼트, 좁은 화면은 주 없음·기본 일별)와 과제는(커리큘럼은 숨김 스위치가 켜졌을 때만) `워크스페이스` section에서 기존 기능을 유지한다. 주소 `create=today`(학생)·`create=lesson`(관리자)은 빠른 만들기·레슨 예약을 한 번 열고 `replaceState`로 지운다. view 없이 들어오면 기기에 저장된 캘린더 계열 보기(달력·일별·전체)만 복원한다.

캘린더(`UnifiedCalendar`)는 FullCalendar를 `timeZone="UTC"`로 두고 KST 벽시계 시각(실제 시각 + 9시간, 한국은 일광절약시간 없음)을 넣어 기기 시간대와 무관하게 칸을 KST로 맞춘다(`src/lib/calendar-interaction.ts`). 끌어 옮기기는 클라이언트 판정(일정·레슨은 그 학생 본인과 관리자 — 2026-10-26 사용자 결정, 노트는 관리자 또는 작성자)과 같은 규칙을 서버가 다시 검사한다: `moveCalendarEvent`(학생 본인 또는 관리자가 대상 학생 ID로, 기존 patch 검증), `moveLesson`(학생 본인 또는 관리자, 대상 학생 레슨), `movePrivateNoteDate`(현재 revision의 제목·본문을 그대로 두고 날짜만 바꾸는 새 revision, 이미 그 날짜면 쓰기 없는 성공으로 재전송을 흡수). 화면은 저장 전 이동을 먼저 보여 주고, 저장된 이동은 다시 받은 목록이 반영할 때까지 유지하며, 같은 항목의 겹친 이동은 마지막 요청만 반영한다. 끌 수 없는 항목(다른 작성자 노트·디깅·Q&A·과제·외부 캘린더)은 끌려고 하면 이유를 알린다. 상세 패널은 수정 권한(관리자 또는 작성자)이 있는 노트를 문서 페이지와 같은 `NoteEditorForm`으로 바로 편집하고(자동 저장·초안·충돌 보호 동일, 저장·업로드 중 닫힘 잠금), 저장 결과를 캘린더 항목에 반영한다. 칸 선택·터치 탭은 `CalendarQuickCreate`를 열어 노트(작성 화면 `?title=&date=`), 일정(`createCalendarEvent`), 레슨(`createLesson`)을 만든다. 관리자 일정 section은 선택한 학생의 캘린더에서 레슨을 예약·이동하고, 레슨 상세에서 시간 변경과 취소 우선 2단계 삭제를 제공한다. 결과는 현재 학생의 캘린더 상태에 즉시 반영하고, 학생을 바꾼 뒤 도착한 늦은 결과는 다른 학생 캘린더에 섞지 않는다.

관리자 포털의 기본 section은 `업무함`이다. 전체 Q&A 중 미답변 항목, feedback이 없는 assignment, 앞으로 7일 이내의 학생별 다음 레슨을 조회한다. 질문과 과제는 오래 기다린 항목부터 보여주고 실제 Q&A·과제 상세로 연결한다. 일정 section은 선택한 학생 스페이스를 상시 표시하고 각 통합 항목의 스페이스·출처를 식별한다.

학생 본인 워크스페이스의 상세 패널은 `PORTAL`·`CALENDAR_EVENT` 항목에만 수정·삭제를 제공한다. 수정은 form 상태를 반환하는 `updateCalendarEventDetails`가 owner 조건으로 갱신하고, 삭제 성공 항목은 서버 목록 갱신 전에도 화면에서 즉시 제외한다.

통합 항목은 raw `id`를 route 진입에 유지하면서 `<source kind>:<entity>:<id>` 형식의 UI key를 별도로 사용한다. `calendar_events`와 `lessons`, 외부 공개 캘린더 사이에는 안정적인 연결 키가 없으므로 같은 시각이나 제목만으로 dedupe하지 않으며, 서로 다른 행을 모두 표시한다. source kind는 `PORTAL`, `GOOGLE_CALENDAR`, `ICLOUD_CALENDAR`이고 entity는 내부 항목 또는 `EXTERNAL_CALENDAR_EVENT`다. 학생 스페이스 label은 display name을 trim해 우선 사용하고 비어 있으면 email을 사용한다.

학생은 하나의 전용 Google 또는 iCloud iCal 레슨 캘린더를 읽기 전용으로 연결할 수 있다. Google은 공개 주소(`/calendar/ical/<id>/public/basic.ics`)와 비공개 Secret 주소(`/private-<token>/basic.ics`)를 모두 받고, 비공개 주소는 이름만 "Google 비공개 레슨 캘린더"로 나눌 뿐 같은 암호화 저장·원문 비반환을 따른다. 그 밖의 경로·query·hash는 거부한다. iCloud는 `p<N>-caldav.icloud.com/published/2/…` 공개 주소만 받는다. 학생의 외부 일정은 관리자의 그 학생 캘린더에도 보인다. 제공자는 별도 선택 없이 붙여 넣은 주소의 host로 판별하고, 주소 형식 위반은 구체적인 안내로, 읽기·파싱 실패와 암호화 key 미설정은 원문 없는 고정 안내로 구분해 돌려준다. 거부된 주소는 form에 남아 바로 고칠 수 있다. 구독 URL은 `external_calendar_subscriptions`에 AES-256-GCM과 학생·provider AAD로 암호화해 저장하며, 조회 action과 UI에는 provider·label·연결 여부만 반환한다. fetch는 허용 host/path, HTTPS, redirect 거부, 5초 timeout, 1 MiB streaming 상한과 VCALENDAR 검증을 거친다. 파서는 `ical.js`로 반복·EXDATE·override·취소·all-day를 bounded window의 read-only `EVENT`/`LESSON`으로 정규화한다. 외부 fetch 또는 복호화가 실패해도 내부 일정만 반환한다.

학생과 관리자 포털은 공통 앱 셸(`AppShell`·`AppSidebar`: 넓은 화면 240px 사이드바, 좁은 화면 52px 위쪽 막대와 메뉴 서랍, 계정 … 메뉴)과 `PortalShell`을 사용한다. 위쪽 막대의 제목·뒤로·주 행동은 `resolveMobileTopBar`가 주소에서 정하고 화면이 `MobileTopBar`로 덮어쓴다. section 선택은 역할별 local storage key에 편의 상태로 저장한다. root skip link와 main landmark, dashboard loading/error boundary를 공통 shell 경계로 둔다. 학생 roster는 mobile label-value list와 desktop table을 분리하고 desktop 확장은 실제 button으로 조작한다.

노트 탐색과 작성은 분리한다. 학생은 `/dashboard/student/notes`, 관리자는 학생별 `/dashboard/admin/students/[id]/notes`에서 제목·노트 날짜·작성자·평문 미리보기·최근 변경 시각과 노트 열기 링크를 확인한다. 목록은 저장 HTML을 직접 렌더하지 않는다. 캘린더의 노트 추가는 역할별 전체 화면 작성 URL에 선택한 엄격한 `YYYY-MM-DD`, 빠른 입력 제목(노트 제목 한도까지)과 내부 `returnTo`만 전달한다. 잘못된 날짜는 KST 오늘로 대체하고, 복원한 초안이 있으면 초안의 제목·날짜가 URL 기본값보다 우선한다. URL 기본값만 채워진 화면은 초안으로 저장하지 않는다. 노트 목록(`NotesDatabase`)은 표/목록 보기 선택을 계정별 `portal:notesView:<id>`에 저장하고 계정 정리에서 함께 지운다.

디깅 보드는 같은 column·track 데이터를 768px 미만에서 label-value record list로, 그 이상에서 TanStack Table 기반 data grid로 표시한다. 두 표현은 같은 edit cell과 server action을 사용한다. 학생은 `/dashboard/student/digging`에서 편집하고 관리자는 학생 상세의 디깅 탭에서 읽기 전용으로 본다. 셀은 값이 바뀐 경우에만 저장하고, 비운 숫자·별점은 0이 아닌 빈 값으로 저장한다. 컬럼 변경 뒤에는 전체 새로고침 대신 server component만 다시 받는다.

## 데이터 모델과 저장소

`src/db/schema.ts`의 주요 table:

- 사용자·수업: `profiles`, `curriculums`, `lessons`, `external_calendar_subscriptions`
- 과제·피드백: `assignment_tasks`, `assignment_recurrences`, `assignments`, `feedbacks`
- 공용 가이드: `guide_pages`, `guide_assets`, `qna_guide_anchors`
- 캘린더 양방향 동기화: `calendar_connections`, `calendar_mappings`, `calendar_sync_links`, `calendar_remote_series`(예정: `calendar_push_channels`)
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

Migration SQL은 `drizzle/`, Drizzle metadata는 `drizzle/meta/`에 둔다. Wrangler는 SQL 파일명과 D1의 적용 이력을 기준으로 migration을 실행하고, Drizzle metadata는 다음 schema diff 생성 기준으로 사용한다. SQL·journal·snapshot은 `0000~0018`까지 대응한다. `npm run db:check`는 empty replay와 current schema/latest snapshot의 column·FK·index뿐 아니라 문서·미디어·개인정보·외부 캘린더 구독 CHECK·FK·unique index, 불변·부활·교체 우회 방지 probe, `0007` fixture upgrade·inbound FK preflight, `0008→0009` account cascade, 기존 게시물·Q&A의 `0009→0010`, 기존 URL을 보존하는 `0010→0011`, populated `0011→0012` 개인정보, `0012→0013` 외부 캘린더, `0013→0014` 본문 이미지, 기존 제출·피드백을 보존하는 `0014→0015` 과제 출제, 서버 초안 trigger를 다시 만드는 `0015→0016` 가이드, 추가만 하는 `0016→0017` 캘린더 동기화, 알림 채널을 더하는 `0017→0018` upgrade를 검사한다. 이 체인은 저장소의 schema 계약이며 persistent local·remote D1의 현재 적용 이력을 뜻하지 않는다. 환경별 실제 적용 목록과 pending 범위는 [운영 상태 확인 기준](./DEPLOYMENT.md#운영-상태-확인-기준)으로 확인한다. 외부 캘린더 코드의 promotion에는 대상 D1의 `0013`, 본문 이미지·Worker 업로드 코드에는 `0014`, 과제 출제·정기 과제에는 `0015`, 가이드에는 `0016`, 캘린더 양방향 동기화에는 `0017`, Google 변경 알림에는 `0018`이 필요하다.

신규 업로드는 사용자에게 노출된 `media-upload/` staging key로만 PUT하고, 서버가 size·Content-Type metadata·ETag를 확인한 뒤 사용자에게 공개되지 않은 별도 `media/` final key로 봉인한다. D1의 `SEALING` lease가 봉인과 삭제를 직렬화하며, 결과를 잃은 Copy는 복구 유예 뒤 final 삭제 outbox가 다시 정리한다. 문서에는 object ID와 `/api/media/{id}`만 저장하고, 게시물과 Q&A의 원자 생성·purge transaction이 registry claim과 R2 삭제 의도를 함께 commit한다. R2 삭제는 lease·지수 backoff를 사용하는 durable outbox로 재시도한다.

클라이언트 업로드는 목적·초안 operation과 개별 요청에 귀속된다. 실제 화면에 반영된 문맥 변경이나 unmount는 진행 중 PUT을 중단하고, 이후 도착한 발급·완료 응답, 진행률·오류·busy 해제를 새 초안에 전달하지 않는다. 아직 반영되지 않은 transition 렌더는 현재 업로드를 취소하지 않는다. 오래된 발급 객체의 정리는 기존 owner 검증과 outbox 정책을 따른다.

예약 정리 source는 OpenNext application fetch를 유지한 custom Worker entry에 `scheduled` handler를 추가한다. request AsyncLocalStorage에 의존하지 않고 event의 D1·R2 binding을 직접 주입하며, 30일이 지난 계정 raw ID alias, 만료 미귀속 media enqueue, 기존 R2 deletion outbox를 작은 순차 batch로 처리한다. soft time budget은 처리 중인 transaction이나 R2 요청을 취소하지 않고 다음 작업 claim만 멈춘다. 로그는 처리 건수·backlog·stage 상태만 포함하며 계정 ID, object key, digest와 예외 원문을 기록하지 않는다. `wrangler.scheduled.toml`에는 Cron trigger와 route를 넣지 않고 원격 운영 trigger를 별도로 관리한다. handler 구현과 원격 trigger 활성 상태는 별도로 확인한다. 운영 수용에는 활성 target version의 실제 scheduled invocation, backlog·실패와 alert 증거가 필요하다.

## 인증과 권한

- 로그인 form은 `loginWithCredentials` server action의 상태로 실패를 돌려받아 입력한 이메일과 middleware가 넘긴 `callbackUrl`을 유지하고 비밀번호 입력으로 초점을 옮긴다. 이동 주소의 same-origin 확인은 NextAuth redirect callback이 수행한다. NextAuth가 직접 붙인 `?error=` query는 고정 안내로만 바꿔 표시한다.
- credentials provider는 email/password와 bcrypt hash를 비교한다. 로그인 이메일은 앞뒤 공백을 무시하고, 정확히 일치하는 계정이 없을 때만 대소문자만 다른 계정이 하나인 경우를 같은 계정으로 본다. 관리자가 만드는 학생 이메일은 소문자로 저장하고 대소문자만 다른 중복을 거부한다.
- 한 server component 렌더 안의 layout·page·query는 React `cache`로 active session 확인을 한 번만 수행한다. server action·route handler 호출은 렌더 범위 밖이므로 매번 JWT와 profile을 다시 검증한다.
- 로그인 token은 비밀번호 hash의 SHA-256 지문(`credential-fingerprint`)에 결합한다. Node JWT callback은 매 갱신에서 profile의 현재 지문과 대조해 비밀번호가 바뀐 뒤 남은 다른 기기의 token을 거부하고, 지문 결합 이전에 발급된 token은 기존 최대 수명까지 허용한다. 지문과 hash는 session 응답에 노출하지 않는다.
- `changeOwnPassword`는 현재 비밀번호를 bcrypt로 확인하고 읽은 hash가 그대로일 때만 새 hash를 저장한 뒤, 새 비밀번호로 현재 기기의 session을 다시 발급한다. 재발급에 실패하면 변경 성공과 재로그인 필요를 함께 알린다.
- 관리자는 학생 비밀번호를 원하는 값으로 바꾸지 못하고 `resetStudentPassword`로 서버가 만든 60-bit 임시 비밀번호(`xxxx-xxxx-xxxx`)만 발급한다. `password_hash`에는 `temporary:` 표시를 붙인 bcrypt hash만 저장해(`src/lib/password-storage.ts`) schema 변경 없이 "변경 필요" 상태가 hash와 함께 바뀐다. 모든 비밀번호 확인은 `verifyStoredPassword`를 거친다.
- 임시 비밀번호 상태는 Node JWT callback이 매 갱신에서 현재 hash로 다시 판단해 `passwordChangeRequired` claim으로 싣는다. `getActiveAuthSession`·`requireAuth`는 이 session을 인증으로 승격하지 않아 모든 page·action·route가 거부하고, `/account/password` 화면과 `changeOwnPassword`만 `getSignedInSession`·`requireSignedInSession`으로 받는다. proxy는 같은 claim으로 화면 이동만 `/account/password`로 돌리고 login·API는 server gate에 맡긴다. 관리자가 임시 비밀번호로 학생 계정을 조용히 쓰려면 새 비밀번호를 정해야 하고, 그러면 학생 본인이 로그인하지 못해 드러난다.
- 학생 계정 생성은 비밀번호 대신 `invite:<만료 epoch 초>:<bcrypt>` 형식의 가입 링크 secret hash를 저장한다(`createStudent`, 7일). 링크는 `/invite#<학생 id>.<256-bit secret>`이고, `/invite` 화면이 `#` 뒤 token을 읽어 `getInviteStatus`·`completeInvite` server action 본문으로만 보낸다. `verifyStoredPassword`는 invite hash를 항상 거부해 링크 secret으로 로그인할 수 없다. `completeInvite`는 읽은 invite hash가 그대로일 때만 새 bcrypt hash로 바꿔 한 번만 쓰이게 하고, 새 비밀번호로 로그인을 발급한다. `reissueStudentInvite`는 아직 invite 상태인 학생만 다시 발급한다. 다른 계정으로 로그인한 상태의 `/invite`는 그 로그인을 덮어쓰지 않도록 로그아웃을 안내한다.
- 비밀번호를 확인하는 경계(credentials `authorize`, `changeOwnPassword`, 가입 링크 action, 계정 삭제)는 `isPasswordAttemptAllowed`로 `PASSWORD_ATTEMPT_RATE_LIMITER` binding(`<용도>:<CF-Connecting-IP>` key, 분당 10회)을 먼저 호출한다. 로그인은 `code=rate_limited`인 `CredentialsSignin`으로 거부하고 login form·`?error=…&code=` 화면이 같은 안내를 보인다. binding이 없는 local·test는 제한하지 않고, binding 호출 오류는 로그인 장애를 피하려고 통과시킨 뒤 오류만 기록한다.
- session의 `user.id`는 profile 조회의 시작점으로만 사용한다. Node auth의 JWT callback, `/api/auth/session`과 모든 server 인증 경계가 profile 존재와 DB의 최신 role을 다시 확인해 삭제된 JWT를 즉시 거부한다. JWT/session 최대 수명은 7일로 고정해 raw subject ID의 30일 보존 경계보다 먼저 만료시킨다.
- 데이터 조회·변경 함수는 호출 화면에 의존하지 않고 role과 ownership을 자체 검증해야 한다.
- 신규 캘린더 feed는 256-bit opaque token의 SHA-256 digest로 owner를 찾고 회전 시 이전 digest를 폐기한다. 관리자 학생 상세는 현재 v2 구독 URL의 마지막 발급 시각만 조회해 보여 주고(원문·digest는 반환하지 않음), 기존 URL이 있으면 교체 전에 취소 우선 확인을 거친다. URL 원문은 발급 직후 한 번만 표시한다. 기존 v1 URL은 active 학생 profile을 먼저 확인한 뒤 서명을 검증한다. `.ics`의 각 레슨은 레슨 ID 기반 고정 UID와 UTC 시작 시각을 사용하고, 예정 레슨이 없으면 일정 없는 빈 캘린더를 반환한다.
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
- 충돌·중단 복구본은 최대 30일 보존하며 최근 20개 기준으로 정리하고, UI에서 전체 저장 시각·제한된 제목/본문 미리보기·현재 화면본을 확인한 뒤 선택 복원하거나 2단계 확인으로 삭제할 수 있다. 같은 내용의 안전본은 causal 저장 시각이 가장 최신인 사본을 남기며, canonical과 같은 사본도 별도 key 사이의 교체 경합 때문에 화면에서만 숨기고 자동 물리 삭제하지 않는다. 복구본 목록 정리는 compaction에서 한 번 해석한 recovery·marker·canonical·causal raw 상태를 재사용하고, namespace가 달라지면 만료 marker를 보수적으로 유지한다. 여러 제출 표현의 cutoff 계산·삭제 후보 관측과 marker 기록도 각각 batch 처리해 같은 대형 원문과 marker namespace를 alias마다 다시 순회하지 않는다. 제출 이력은 내용 서명별 append-only tombstone을 같은 30일 동안 개수 제한 없이 유지해 연속 제출 뒤 잠든 탭의 ghost 복원을 차단한다. 복원·채택 시점에도 tombstone과 원래 저장 시각을 다시 검증하며, tombstone이 가리는 causal snapshot이 남아 있으면 기본 보존 기간을 넘겨도 먼저 제거하지 않는다. 작성 폼이 활성인 동안의 선제 정리는 브라우저 유휴 시간이 남으면 최대 4개, 시간 제한으로 실행될 때는 1개 key씩 나눠 현재 열리지 않은 문서의 current-version 불변 recovery만 정리한다. 큰 key·원문과 causal 전역 확인이 필요한 marker는 이 경로에서 보존하고, marker는 해당 source 정리에서, 큰 recovery와 marker를 포함한 전역 정리는 quota 재시도에서 수행한다. future·legacy·손상 데이터와 active source는 전역 정리에서 보수적으로 보존한다. 계정 메뉴의 기기 초안 관리에서는 현재 계정의 문서 namespace를 안전한 미리보기와 함께 모아 보고 문서별 또는 전체 폐기할 수 있다. 제출 tombstone이 가린 ghost는 목록에서 제외한다. 로그아웃 직전에는 먼저 `useLogoutSubmit`이 해당 계정의 서버 초안 폐기 대기열만 원래 operation ID·CAS 기준으로 보낸다(`flushQueuedDocumentServerDraftDiscards`). 같은 본문이 다른 version으로 남은 충돌이나 재실행 응답은 최대 3회 rebase하고, 실패·오프라인이면 건너뛴다. 전송은 server action 줄을 피하려고 `fetch`로 `POST /api/document-drafts/discard`(`document-server-draft-discard-api.ts`, Sec-Fetch-Site 또는 Origin·Host 같은 출처·JSON만 받고 검증·계정 확인·CAS는 `discardDocumentServerDraft`)에 보내며, 전체 3초 상한에서 abort한다. 그래서 그 사이 로컬 초안 정리는 최대 3초 늦어진다. 그 뒤 해당 계정의 canonical·recovery·future·legacy·marker·서버 queue와 메모리 pending을 지우고 열린 작성 흐름의 재저장을 잠근다. 저장(UPSERT) 대기열은 공유 기기 보호에 따라 보내지 않고 지운다. 다음 계정 인증 시에는 다른 계정의 잔여 namespace를 다시 정리한다.
- 포털 section, workspace view와 관리자 학생 선택은 URL에 기록한다. 작성 화면과 저장된 문서는 검증된 내부 `returnTo`를 전달해 직전 작업 문맥으로 돌아간다.
- 첨부 업로드·서버 제출 중에는 제목·분류·첨부·editor mutation, submit, 화면 내 SPA link, 상위 상태 전환과 slide panel dismiss를 잠근다. hard navigation에는 이탈 경고를 제공하고 진행 중 업로드가 unmount되면 전송을 중단한다. 브라우저 Back/Forward와 임의의 programmatic route 전환은 client만으로 완전히 취소할 수 없으므로 실제 브라우저 E2E가 별도로 필요하다.
- 새 노트·게시물·Q&A 질문·답변의 draft에는 UUIDv4 생성 작업 nonce를 저장하고 submit 직전에 전체 snapshot을 flush한다. 서버는 인증된 작성자·대상·문서 종류를 함께 영역 분리한 결정적 UUIDv8을 실제 resource ID로 사용한다. 같은 nonce와 정규화 payload의 순차·동시 재전송은 기존 결과를 반환하며, 같은 작성 흐름의 다른 payload는 초안을 유지한 채 기존 문서 열기 또는 별도 문서 분리를 선택하게 한다.
- 개인 노트와 커뮤니티 게시물은 안정 URL에서 다시 편집할 수 있다. 편집 draft와 요청은 전체 서버 기준 본문을 복제하지 않고 문서 종류·ID·저장 원문·날짜를 영역 분리한 SHA-256 지문만 보존한다. rolling 구버전 client에는 유효 서버 문서와 같을 수 없는 고정 sentinel을 함께 저장해 compact draft를 안전한 stale 상태로 연다. 저장 성공 시 compact 표현, 기준 metadata가 없는 표현, 현재 서버 기준의 구버전 표현과 사용자 필드가 같은 실제 복원 표현에 각각 cutoff tombstone을 남겨 업데이트 전 탭이 제출 전 초안을 다시 복원하지 못하게 한다. 다른 사용자 내용의 복구본은 이 alias에 포함하지 않는다. 서버는 현재 저장본의 지문을 대조하고 실제 조회한 필드를 조건으로 갱신해 다른 화면의 선행 저장을 감지한다. 노트의 날짜 입력은 생성·편집 모두 비어 있거나 실제 존재하는 canonical `YYYY-MM-DD`만 허용한다. 오래된 기준본을 복원하면 서버 최신본과 현재 초안 중 선택하게 하며, 저장 성공 응답이 유실된 동일 payload 재전송은 update 전 현재값 확인과 CAS 실패 뒤 재조회로 성공에 수렴한다.
- 개인 노트 mutation은 UUIDv4 operation ID와 명시적 base revision을 사용한다. D1 `batch()`와 로컬 SQLite transaction 안에서 immutable receipt, 조건부 head 변경, fail-closed sentinel, 새 full-snapshot revision을 함께 commit하거나 전부 rollback한다. 같은 operation의 exact replay는 historical result revision과 현재 head revision을 분리해 반환하며 다른 payload는 충돌로 거부한다. canonical no-op은 head와 revision을 늘리지 않고 재전송 가능한 receipt만 남긴다.
- 개인 노트 삭제는 `deleted_at` soft delete다. active 기본 조회는 휴지통 노트를 제외하고, trash/restore와 과거 revision restore는 각각 새 revision을 만든다. 30일 만료 뒤 admin purge만 head와 revision을 제거하며 tombstone과 본문 없는 ledger가 늦은 create/update의 부활을 차단한다. revision은 문서가 active/trash인 동안 append-only이고 일반 profile 삭제는 `RESTRICT`하며 전용 account-deletion transaction만 이력을 먼저 완결 삭제한 뒤 profile을 제거한다.
- 개인 노트는 Server Action 기본 1MB body의 action/form envelope 여유를 남기기 위해 sanitize된 HTML 본문 800 KiB, 제목 200자, 사용자별 head와 내용 변경 revision 100 MiB의 logical quota를 적용한다. `TRASH`·`RESTORE_TRASH` 상태 snapshot은 사용자 quota에서 제외하고 실제 D1 사용량 관측 대상으로 남긴다. version 충돌은 자동 병합하지 않고 현재 초안을 보존한 채 서버 최신본을 펼쳐 확인·복사한 다음 서버본 사용 또는 현재 초안 계속을 선택한다.
- 커뮤니티 게시물의 생성·편집·고정 변경·휴지통 이동·복원·과거 revision 복원·영구 삭제도 UUIDv4 operation ID와 명시적 base revision을 사용한다. head, 불변 receipt와 full-snapshot revision을 D1 `batch()` 또는 로컬 transaction에서 함께 처리한다. exact replay는 이후 다른 변경이 있어도 원래 결과 revision으로 수렴하며, 저장된 snapshot hash가 맞지 않으면 과거 revision 복원을 거부한다.
- 노트·게시물의 휴지통 및 이력 복원 버튼은 문서·기준 version·작업 종류(이력 복원은 대상 revision 포함)에 요청 ID를 결합한다. 결과가 불명확한 같은 작업은 같은 ID로 재시도하고, 새 기준본에서 시작한 작업은 새 ID를 사용한다. 노트 휴지통 action의 예외는 화면 내부 오류로 표시해 편집 화면과 재시도 경로를 유지한다.
- 노트·게시물의 전체 페이지 작성 및 편집은 저장 요청 예외를 폼 안에 표시하고 원문·초안·재시도 경로를 유지한다. 편집 초안에는 operation ID와 기준 revision을 보관해 화면 재진입 후 같은 요청을 재전송하며, 사용자의 내용 수정이나 충돌 기준본 선택은 새 operation을 사용한다. 버전 충돌은 권한을 재확인한 서버 최신본의 내용과 version을 함께 보여 주고 명시적 선택 전 저장을 잠근다. 늦게 도착한 화면이 이미 확인한 최신본의 version을 되돌리지 않으며, 충돌 선택 뒤 제목 입력으로 초점을 돌려준다.
- 노트·게시물 작성 및 편집 폼의 수명은 작성자와 대상 학생/문서에 결합한다. 문맥 전환 전에 시작한 저장의 늦은 성공은 새 문맥의 원문·초안 정리·진행 잠금·화면 이동에 반영하지 않는다. Q&A 질문(페이지·패널)과 답변도 저장 예외 뒤 같은 operation과 원문을 유지해 재시도할 수 있다.
- 게시물 댓글은 head와 함께 삭제하지 않는다. 휴지통 게시물은 기본 목록과 통합 기록에서 제외하고 읽기 전용으로만 열며, DB trigger가 휴지통 상태에서 새 댓글과 댓글 삭제 경쟁을 차단한다. 게시물을 복원하면 기존 댓글이 다시 함께 보이고, 관리자 purge 때만 FK cascade로 제거한다.
- 과제 제출 링크는 `src/lib/assignment-media-url.ts`가 서버에서 검증·정규화한다. YouTube는 영상 ID가 있는 watch·youtu.be·Shorts·라이브·embed 주소만 받고 `m.`·`music.` host를 `www.youtube.com`으로, SoundCloud는 트랙·세트 경로만 받고 `m.`·`www.` host를 `soundcloud.com`으로 맞춰 https로 저장한다. 앱 공유용 `on.soundcloud.com` 짧은 링크는 위젯이 재생하지 못하므로 전체 주소를 붙여 넣도록 안내한다.
- 학생은 `deleteMyAssignment`로 본인 제출을 삭제할 수 있다. 피드백 존재 확인과 삭제를 한 `DELETE … NOT EXISTS` 문으로 처리해 그 사이 등록된 피드백을 지우지 않으며, 관리자는 학생 제출을 대신 삭제하지 않는다. 과제 목록 패널과 과제 상세는 피드백이 없을 때만 취소 우선 2단계 삭제를 보인다.
- 과제 상세의 플레이어는 준비된 동안에만 현재 재생 위치 reader를 노출한다(YouTube는 HTML media `currentTime`, SoundCloud는 widget `getPosition`). 관리자 피드백 폼의 `현재 위치`는 이 값을 MM:SS로 채우고 읽을 수 없으면 직접 입력을 안내한다.
- 댓글·과제 피드백의 로컬 작성본에는 UUIDv4 operation ID를 함께 보관한다. 응답 유실·화면 재진입 후 같은 작성본은 같은 ID로 재시도하고, 편집 또는 성공 후 새 작성은 새 ID를 사용한다. 서버는 작성자·대상별 결정적 PK와 정규화 원문을 대조해 같은 레코드의 중복 insert를 막고 다른 원문의 재사용을 거부한다. 개별 댓글·피드백을 직접 삭제해 row가 제거된 이후에는 이 재전송 보장이 유지되지 않는다.
- 새 게시물·Q&A 질문·답변의 `Cmd/Ctrl+S`는 공개 action을 호출하지 않고 최신 form snapshot을 로컬에 flush한다. 노트와 기존 문서 편집의 단축키는 명시된 서버 저장 action을 사용한다.
- Q&A의 스레드·첫 본문, 답변·상태 변경, 휴지통 이동·복원·영구 삭제는 D1 binding batch 또는 로컬 SQLite transaction으로 함께 commit하거나 rollback한다. 각 mutation은 operation receipt와 append-only `qna_thread_events`를 남기고 version CAS를 적용한다. 답변 쓰기는 ownership과 `CLOSED`·휴지통 상태를 원자 쓰기 안에서 다시 검증한다.
- Q&A 휴지통 작업이 다른 화면의 변경과 충돌하면 오래된 snapshot의 쓰기를 잠그고 최신 상태 확인을 제공한다. 실제 서버 props의 version·삭제/권한 상태가 바뀐 후 새 작업을 허용하며, 재조회 실패의 재시도와 작성 중 답변은 유지한다. 같은 결과 불명 요청은 동일 operation으로, 새 version 또는 작업 종류는 새 operation으로 처리한다.
- Q&A 상세는 답변 제출·첨부 업로드·상태 및 휴지통 변경의 busy 상태를 함께 사용해 작업이 겹치지 않도록 한다. 계정이나 스레드가 바뀌면 해당 작성 UI의 상태 수명을 분리하고, 같은 스레드의 version 갱신에서는 작성 중 답변을 유지한다.
- Q&A 목록의 상태 필터는 `qnaStatus` URL query가 소유한다. 학생·관리자 목록과 관리자 학생별 Q&A 탭은 첫 서버 렌더에서 같은 필터를 적용하고, GET 필터 변경과 상세·새 질문·휴지통의 복귀 경로에 상위 포털/학생 탭 문맥을 함께 보존한다.
- Q&A 검색은 `qnaQuery` URL query로 제목·질문·답변의 전체 기간을 대상으로 한다. NFKC·대소문자 정규화 뒤 띄어 쓴 단어를 대화 전체에서 AND로 찾고 HTML 속성·숨겨진 코드 없이 평문 일치 구간만 표시한다. 검색 시에만 인증된 active scope의 답변을 ID keyset으로64개씩 읽으며 관리자 학생별 검색도 동일한 student 조건을 사용한다. 상태 필터와 검색 초기화는 서로의 조건·상위 returnTo를 보존한다. 별도 검색 index나 schema 변경은 없으며 처리량은 해당 범위 대화량에 비례한다.
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
| `R2_ENDPOINT` | 로컬 `next dev`에서 BUCKET binding 없이 R2를 쓸 때만 쓰는 S3-compatible endpoint | 개발 환경 전용 |
| `R2_ACCESS_KEY_ID` | 위와 같은 로컬 개발용 access key | 로컬 secret |
| `R2_SECRET_ACCESS_KEY` | 위와 같은 로컬 개발용 secret key | 로컬 secret |
| `EXTERNAL_CALENDAR_ENCRYPTION_KEY` | 32-byte base64/base64url key. iCal 구독 URL, 캘린더 연결 자격 증명(Google token·iCloud 앱 암호)의 AES-256-GCM 암호화와 Google OAuth 흐름 cookie 봉인 key(HKDF 파생)에 함께 쓴다 | Worker/local secret, 운영 미설정 |
| `GOOGLE_CALENDAR_CLIENT_ID` | Google Calendar 연동 OAuth 웹 client ID(로그인용 Google provider와 별개) | Worker/local secret, 운영 미설정 |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | 위 client의 secret | Worker/local secret, 운영 미설정 |
| `R2_BUCKET_NAME` | upload bucket 이름 | 환경별 설정 |

Google 연동은 `GOOGLE_CALENDAR_CLIENT_ID`·`GOOGLE_CALENDAR_CLIENT_SECRET`·`AUTH_URL` 가운데 하나라도 없으면 꺼지고(`src/lib/calendar-sync/oauth-config.ts`), redirect URI는 `AUTH_URL`의 origin + `/api/calendar-connections/google/callback`이다. 암호화 key가 없으면 Google·iCloud 연결 모두 꺼지며 설정 화면이 "설정 필요"를 안내한다. 샘플 계약은 `.env.example`에 두고 실제 값은 commit하지 않는다. 신규 managed media는 public bucket URL을 runtime 설정으로 사용하지 않는다. 기존 URL의 trusted base는 배포 전 inventory·backfill 입력으로만 별도 관리한다.

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

화면의 날짜·시각은 실행 환경 timezone(Worker SSR은 UTC)과 무관하게 `src/lib/kst-format.ts`로 Asia/Seoul 기준 표시한다. UI 계약 검사는 이 경계 밖의 locale 날짜 포맷 호출을 거부한다.

UI token, 상태 registry, 공통 component와 접근성 규칙은 [디자인 시스템](./DESIGN_SYSTEM.md)을 기준으로 한다. 되돌리기 어려운 동작은 브라우저 기본 확인창 대신 `ConfirmPanel`의 취소 우선 2단계 확인을 거치며, 확인 단계는 기존 operation ID 재사용 규칙(결과 불명 재시도는 같은 ID, 새 기준 version은 새 ID)을 바꾸지 않는다. 상태 registry는 label, semantic tone, icon key가 서로 어긋나지 않도록 단위 테스트로 보호한다.

| 품질 경계 | 현재 자동화 | 다음 보강 |
|---|---|---|
| Migration | SQL·journal·snapshot·current schema empty replay, CHECK·trigger, `0007` upgrade·inbound FK preflight, `0008→0009` cascade, `0009→0010` 게시물·Q&A, `0010→0011` media, `0011→0012` privacy, `0012→0013` 기존 데이터 보존·구독 제약·owner cascade, `0014→0015` 제출·피드백 보존, `0015→0016` 서버 초안 trigger, `0016→0017` 연결·매핑 제약·cascade | persistent local·remote의 실제 적용 목록에서 pending 범위를 계산하고 승인된 작업 창에서 점검 |
| 개발 credential | development/opt-in/env/input binding 단위 테스트 | 실제 local seed는 데이터 변경 작업으로 분리 |
| 인증·권한 | 미인증·role·ownership 허용/거부 단위 테스트, Q&A 격리 D1 권한 회귀 | 다른 주요 server action의 실제 query·mutation 경계 테스트 |
| 입력·콘텐츠 | HTML5 AST tag·속성·URL allowlist, malformed·foreign-content XSS, 멱등성, upload MIME·size·quota·opaque key 정책 | 실제 R2 CORS·대용량 PUT smoke |
| 미디어 | staging/final key 분리, SEALING lease·late Copy 복구, claim/purge rollback, bounded 만료 enqueue, outbox 재시도·final prefix cursor reconciliation·private RBAC·Range 자동 테스트 | 원격 trigger·실행 상태와 실제 R2 PUT·inventory 운영 검증 |
| 문서 연속성 | local shadow·5초 checkpoint·복구·제출 경쟁, 사용자·문서별 서버 최신본·CAS·offline queue·다중 기기 명시 선택 DOM 통합, 노트·게시물·Q&A revision/event·trash·purge·anti-replay 격리 D1 통합 | 실제 브라우저 reload·offline·navigation·강제 종료·대형 문서 E2E |
| 계정 개인정보 | student-only 원자 삭제, old JWT 거부, cleanup digest·terminal lock, ownerless snapshot 확인, 30일 alias·second-run no-op·poison job 격리, edge-local status rate limit·rollout flag | 유효 삭제 flag, Cron/alert·오프라인 adoption 확인과 승인된 삭제 smoke |
| 과제·가이드 | 정기 회차 계산·결정적 ID·동시 생성, 형식별 제출·형식 변경 경쟁 거부, 가이드 sanitize·블록 앵커·재전송 비교, 이미지 저장 실패 시 R2 정리, 가이드 질문 권한 격리 D1 통합 | 실제 브라우저의 가이드 구간 선택·편집기 앵커 보존 E2E |
| 외부 캘린더 동기화 | Google·CalDAV client fixture(PKCE·syncToken·sync-collection·etag 충돌·XML·ICS), 실제 SQLite와 가짜 provider로 엔진(웹 우선·루프 방지·tombstone·반복 일정·종일), OAuth route 봉인 cookie, 자격 증명 AAD, 학생·관리자 경계 격리 D1 통합 | 실제 Google·iCloud 계정 연동, 운영 Cron·Google 변경 알림 |
| UI 상태 | status registry 단위 테스트, loading/error route, semantic landmark·control 정적 검토 | keyboard interaction component 테스트 |

## 변경 시 같이 볼 파일

| 변경 영역 | 함께 확인할 파일 |
|---|---|
| auth·role | `src/auth.ts`, `src/auth.config.ts`, `src/proxy.ts`, `src/lib/active-profile.ts`, `src/lib/auth-guard.ts`, `src/lib/credential-fingerprint.ts`, `src/lib/password-storage.ts`, `src/lib/actions/password.ts`, `docs/REQUIREMENTS.md` |
| schema·migration | `src/db/schema.ts`, `drizzle/**`, 관련 action, `docs/TECH_SPEC.md` |
| student portal | `src/app/dashboard/student/page.tsx`, `src/components/student-portal/**` |
| admin portal | `src/app/dashboard/admin/page.tsx`, `src/components/admin-portal/**`, `src/lib/actions/students.ts` |
| rich text·input | 관련 form, `src/lib/sanitize-html.ts`, server action |
| 문서 draft·재진입 | `src/lib/form-draft.ts`, `src/lib/hooks/useFormDraft.ts`, `src/lib/hooks/useSyncedFormDraft.ts`, `src/lib/actions/documentDrafts.ts`, 안정 문서 route |
| upload·media | `src/lib/r2.ts`, `src/lib/actions/upload.ts`, `.env.example`, `docs/DEPLOYMENT.md` |
| Cloudflare binding | `wrangler.toml`, `open-next.config.ts`, `docs/DEPLOYMENT.md` |
| 과제 출제·정기 과제 | `src/lib/actions/assignmentTasks.ts`, `src/lib/assignment-recurrence.ts`, `src/lib/assignment-task-generation.ts`, `src/lib/actions/feedbacks.ts`, `scripts/migration-check/assignment-tasks.mjs` |
| 공용 가이드 | `src/lib/guide-content.ts`, `src/lib/guide-store.ts`, `src/lib/sanitize-html.ts`(`data-block-id`), `src/lib/actions/qna.ts`, `src/lib/guide-import.ts`, `scripts/guide-import/build.ts` |
| 캘린더 동기화 | `src/lib/calendar-sync/**`, `src/lib/actions/calendarSync.ts`, `src/lib/actions/lessons.ts`, `src/lib/actions/calendarEvents.ts`, `wrangler.scheduled.toml`, `docs/DEPLOYMENT.md` |

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
- migration SQL과 `drizzle/meta` 생성 이력은 `0017`까지 대응하고 `db:check`가 전체 replay와 단계별 upgrade를 검사한다. persistent local D1과 remote의 실제 적용 이력은 승인된 운영 점검 전 추정하지 않는다(마지막 기록: persistent local D1 `0009`까지).
- 대표 문서 server action과 draft 생명주기의 격리 integration test는 있으나 실제 브라우저 reload·offline·navigation·delete/restore E2E는 없다.
- 신규 managed media의 registry·문서 claim·purge 삭제 outbox와 인증 delivery, bounded 예약 정리·final prefix cursor reconciliation source를 구현했다. Copy timeout·lease·recovery grace 뒤 발견된 registry 없는 final object와 삭제 상태 object는 다음 inventory page에서 재삭제한다. production에서는 private R2 CORS·staging lifecycle·Cron과 알림을 검증해야 하며, 기존 외부 URL과 managed 형식이 아닌 legacy R2 object는 자동 삭제 대상으로 추정하지 않는다.
- 큰 문서의 전체 HTML·payload 서명은 매 입력이 아니라 지연된 flush·submit 경계에서 revision당 한 번만 만들고, 연속 입력은 최대 5초마다 최신본을 checkpoint한다. 개인 노트는 저장 HTML 800 KiB와 logical history 100 MiB 정책을 적용한다. 다만 실제 브라우저의 100 KiB·500 KiB·1 MiB frame budget과 autosave·복구 latency를 측정하지 않아 제품급 입력 부드러움은 아직 검증되지 않았다.
- rolling 호환용 제출 alias는 ghost 복원을 막기 위해 signature별 tombstone을 30일 동안 보존한다. 반복 편집 시 여러 unique entry가 origin 저장공간에 누적될 수 있으므로, 호환 종료 조건과 문서 namespace별 byte budget·용량 안내 정책은 아직 확정하지 않았다.
- 계정 삭제의 profile·원문 즉시 제거, 등록된 오프라인 기기 cleanup digest, edge-local status rate limit과 30일 raw-ID alias workflow는 구현했다. 첫 production version은 삭제 rollout flag를 닫고 cleanup·erasure scheduler와 backlog를 확인한다. 등록 전부터 오프라인인 기기는 서버가 ownerless local draft를 식별할 수 없으므로 adoption 확인 뒤 별도 version에서만 삭제를 연다.
- maintenance와 scheduled Worker artifact, log persistence·rate limit·inventory reconciliation config는 준비돼 있다. production Cron trigger와 backlog alert, immutable version 전환은 승인된 운영 작업에서 실제 검증한다.
- 운영 D1의 read-only inventory와 full export 격리 restore rehearsal은 통과했다. 실제 migration rollback anchor는 maintenance write fence 뒤 새 export/checksum과 Time Travel bookmark로 다시 확보해야 한다.
- 일부 대형 client component는 상태 hook, domain view와 presentation 경계가 한 파일에 남아 있다.
- 소셜 공유 이미지는 승인된 브랜드 asset이 준비된 뒤 metadata에 연결해야 한다.

## 응답 대기 표시와 로그아웃 잠금(2026-10-27)

- 화면 이동: `src/components/app-shell/NavigationProgress.tsx`가 다른 앱 주소로 가는 링크 클릭, `useProgressRouter()`의 `push`·`replace`, GET form 제출에서 위쪽 2px 막대를 켜고 주소가 바뀌면 끈다. 120ms 안에 끝나는 이동은 그리지 않고, 주소가 끝내 바뀌지 않으면 15초 뒤 끈다. 제출 중 이동 막기(`useBusyNavigationGuard`)가 끊은 클릭은 bubble 단계의 window까지 오지 않아 막대가 켜지지 않는다. 사이드바 메뉴는 `useLinkStatus`로 아이콘 자리에 회전 표시를 둔다.
- 버튼: `Button`의 `pending`은 비활성화·`aria-busy`·회전 표시를 함께 준다(움직임을 줄이면 멈춘 모양). 새 질문·새 글은 등록에 성공한 뒤 상세로 넘어갈 때까지 계속 잠근다. 디깅 칸 저장, 캘린더 끌어 옮기기 저장, 링크 정보 가져오기, 새 글 채널 불러오기도 진행 표시를 보인다.
- 로그아웃: `src/lib/account-logout-lock.ts`가 계정별(sha256 키) localStorage 잠금(15초 만료)을 폐기 전송 전에 기록하고 같은 탭 이벤트·다른 탭 `storage` 이벤트로 알린다. `useDocumentServerDraftSync`는 잠금 동안 서버 초안 저장 타이머를 멈추고 전송 직전에도 다시 확인해 막는다. 로그아웃 action이 실패하면 자기 잠금만 풀고 오류를 보이며 다시 누를 수 있다. redirect는 실패로 보지 않는다. 폐기 API는 다른 출처 403(Origin protocol·host 비교) → 미인증 401 → 415 → 400 순서로 판정한다.

## 과제 출제·공용 가이드·캘린더 양방향 동기화(2026-10-27)

### 과제 출제와 정기 과제

- `assignment_tasks`(학생·제목·sanitize된 설명·제출 형식 `MIX`/`TEXT`/`BOTH`·마감·version)는 관리자 출제 과제다. `assignments`에 nullable `task_id`(UNIQUE, 과제 삭제 시 SET NULL)·`text_html`을 더하고 `media_url`을 nullable로 바꿨다(링크 또는 글 중 하나는 CHECK로 필수). `feedbacks.time_marker`는 nullable이 되어 재생 시점 없는 피드백이 글 제출을 포함한 과제 전체에 대한 피드백이 된다. `0015`는 이를 위해 기존 `assignments`·`feedbacks`를 행 보존 table rebuild한다.
- 관리자 action은 `requireStudentTarget`으로 대상 학생을 확인한다. 학생 제출(`submitAssignmentTask`)은 `INSERT … SELECT … WHERE`로 과제 소유와 읽은 제출 형식을 다시 확인해, 그 사이 관리자가 형식을 바꾸거나 과제를 지운 경우를 거부한다. 학생 수정은 피드백이 없을 때만 허용한다. 글은 평문 5,000자, 제목 120자, 설명 2,000자까지다. 한 번 과제를 지워도 제출은 자유 제출로 남고, 정기 회차는 따로 지울 수 없다.
- `assignment_recurrences`(시작일·간격 1~12주·요일 bitmask(bit 0 = 일요일)·KST 마감 `HH:MM`·종료일 또는 최대 520회·멈춤·version)가 정기 과제 규칙이다. 주는 일요일에 시작하고, 시작일이 든 주를 0주차로 간격마다 선택 요일의 날짜가 회차다.
- 회차는 예약 실행 없이 조회할 때 만든다(`ensureRecurringAssignmentTasks`). 오늘(KST)까지와 다음 회차 하나만, 규칙당 최대 60개·호출당 120개를 만들고, 규칙이 마지막으로 바뀐 시각(`updated_at`) 전에 이미 마감된 날짜는 새로 만들지 않는다. 회차 ID는 (규칙, 날짜)의 SHA-256에서 결정되고 UNIQUE(`recurrence_id`, `occurrence_date`)와 `ON CONFLICT DO NOTHING`이 동시 요청의 중복을 막는다. 각 INSERT는 읽은 규칙 version이 그대로이고 멈추지 않았을 때만 행을 만들어, 관리자가 규칙을 바꾸는 사이 옛 규칙으로 읽은 요청이 지운 회차를 되살리지 않는다. 렌더 중에도 부르므로 `revalidatePath`를 호출하지 않는다.
- 규칙 수정·멈춤·삭제는 먼저 옛 규칙으로 밀린 회차를 만든 뒤, 마감 전이고 제출이 없는 회차만 지운다(수정·재개 뒤에는 새 규칙으로 다시 만든다). 제출된 회차와 마감이 지난 회차는 남는다(규칙 삭제 시 `recurrence_id`는 SET NULL).

### 공용 가이드

- `guide_pages`(제목 120자·정렬 순서·sanitize된 본문 800 KiB·version)는 모든 학생이 같은 내용을 본다. 쓰기는 관리자만, 읽기는 로그인 사용자 전부다. 편집은 노트와 같은 로컬·서버 초안(`document_server_drafts` 종류 `guide-page`, `0016`에서 CHECK 확장)과 version CAS·충돌 선택·이탈 보호를 따른다. 삭제도 기준 version을 확인한다.
- 저장할 때 모든 블록 요소에 `data-block-id`를 부여·보존한다(`prepareGuideHtml`). sanitize allowlist는 형식이 제한된 `data-block-id`만 허용한다. 생성 재전송은 블록 ID를 뺀 본문 전체를 비교해 같은 내용이면 기존 결과로 수렴하고, 비교는 본문 텍스트에 들어 있는 `data-block-id` 글자를 지우지 않는다.
- `guide_assets`는 학생 media 수명주기와 분리된 R2 `guide/<uuid>` key의 가이드 이미지다(JPG·PNG·GIF·WebP, 10MB). 업로드는 관리자만, 전달은 로그인 사용자만 받는다. D1 기록에 실패하면 올린 R2 객체를 지운다.
- 가이드 구간 질문은 기존 1:1 Q&A 스레드에 `qna_guide_anchors`(스레드 PK·페이지 ID(SET NULL)·페이지 제목·블록 ID·인용문 500자)를 붙인다. 질문은 스레드 생성과 같은 원자 쓰기에서 저장되고 기존 Q&A 권한을 그대로 따른다: 학생은 본인 질문만, 관리자는 모든 질문의 위치를 가이드 화면에서 본다. 블록이나 페이지가 사라져도 인용문과 페이지 제목으로 질문을 표시한다.
- 가져오기: `npx tsx scripts/guide-import/build.ts [exportDir] [outDir]`가 Claude 문서 export(탭 7개 HTML·사진 23개·다이어그램 JSX)를 읽어 `outDir`(기본 `.wrangler/guide-import`)에 `seed.sql`, 이미지 객체, 로컬 적용 명령을 출력하는 `apply-local.sh`를 만든다. 스크립트는 local·remote D1·R2에 직접 쓰지 않는다. 내부 링크는 포털 가이드 경로로 바꾸고 mention·byline은 지운다. seed는 `INSERT OR IGNORE`라 다시 실행해도 포털에서 고친 내용을 덮어쓰지 않지만, 포털에서 지운 페이지는 되살아나므로 처음 한 번만 적용한다.
- 다이어그램 JSX는 export 원본(다른 사용자가 쓸 수 있는 문서)이라 실행 코드로 신뢰하지 않는다. esbuild로 문법 변환만 한 뒤 `node --permission -` child process에 stdin으로 넘겨 렌더한다. fs 읽기·쓰기·child_process·worker·addon이 막히고 env가 비어 있어 읽거나 내보낼 비밀값이 없다(Node permission model은 네트워크를 막지 않는다). 결과 SVG는 포털 token 색으로 정리한 뒤 이미지로 넣는다.

### 캘린더 양방향 동기화

- 연결 구조: 관리자가 Google 계정(OAuth)과 Apple ID(앱 전용 암호, CalDAV)를 각각 한 번 연결한다(`calendar_connections`, (owner, provider) UNIQUE). 학생마다 연결별로 원격 캘린더 하나를 매핑한다(`calendar_mappings`, (connection, student)·(connection, remote calendar) UNIQUE). 학생마다 provider가 달라도 되고 한 학생에 Google·iCloud를 둘 다 매핑할 수도 있다. 학생은 외부 계정 없이 공유받은 캘린더를 기존 앱에서 본다. 학생 계정 삭제 transaction은 그 학생의 매핑을 지우고 link·반복 일정 사본은 cascade로 함께 지운다.
- 포털이 중심(hub)이다. 레슨·일정 action은 commit 뒤 `schedulePushStudentCalendarChanges`로 응답을 보낸 다음(Next `after`, OpenNext에서는 Workers `waitUntil`) 그 학생 매핑에 push한다(전체 4초 예산). 원격 실패는 포털 저장을 실패시키지 않고 `last_error`에 남으며, 놓친 변경은 다음 동기화가 fingerprint 차이로 보낸다. 캘린더 조회(`syncAndGetExternalItems`)는 표시 전에 매핑별 증분 pull을 실행한다(20초 예산, 매핑별 60초 throttle). 원격 실패는 화면 표시를 막지 않는다.
- 루프 방지: `calendar_sync_links`(매핑·로컬 종류 `LESSON`/`EVENT`·로컬 ID·원격 ID·etag·로컬 fingerprint)와 원격 일정에 숨겨 붙이는 portalRef. 로컬 → 원격은 link(원격 ID NULL)를 먼저 claim하고 원격을 만든 뒤 ID·etag를 기록한다. 원격 생성은 portalRef에서 만든 결정적 ID(Google event id, iCloud 리소스 이름)로 하므로 응답이 유실되거나 lease가 만료된 두 실행이 겹쳐도 사본이 하나다(Google 409·iCloud 412는 기존 리소스를 읽어 덮는다). 남은 NULL link는 다음 동기화가 `findByPortalRef`로 복구한다. 원격에서 온 일정이 link나 portalRef를 가지면 새로 만들지 않는다. portalRef가 있는데 link가 없으면 같은 학생의 로컬 행이 있을 때만 link를 복구한다(`RELINKED`, 다음 push가 로컬 내용으로 원격을 맞춘다).
- 충돌은 웹 우선이다. 원격 쓰기는 If-Match(etag)로 하고, 412이면 link의 원격 ID로 최신 리소스를 다시 읽는다(`get`, 가져온 일정에도 동작). 마지막 동기화 뒤 로컬이 바뀌었으면 로컬 내용으로 다시 쓰고(웹에서 지운 일정은 최신 etag로 다시 지운다), 그대로면 원격 내용을 받아들인다. 원격 값을 로컬 행에 반영·삭제할 때는 읽은 값이 그대로일 때만 쓰는 조건부 문장이라, 그 사이 웹 수정이 있으면 되돌리고 웹 우선으로 다시 판단한다. 전체 재동기화에서 원격 목록에 없는 연결 항목은 `get`으로 확인해 window 밖으로 옮겨졌으면 옮긴 날짜를 반영하고, 없을 때만 삭제한다(실행당 20건, 넘으면 cursor를 저장하지 않고 다음 실행이 이어서 확인). 실행은 원격 쓰기마다 lease를 연장하고 소유를 잃으면 멈춘다. Google token 갱신 결과는 읽었던 암호문이 그대로일 때만 저장(CAS)해 회전된 refresh token을 덮지 않는다. Google 연결 완료는 server action이 아닌 일반 모듈(`google-connection.ts`)이라 봉인된 state를 검증한 callback만 부른다.
- 삭제: 레슨·일정은 hard delete이므로 같은 원자 쓰기에서 link fingerprint를 `DELETED` tombstone으로 바꾸고(`markLinksDeletedStatement`), 원격 remove 성공 뒤 link를 지운다. 원격 삭제는 link가 있는 로컬 행을 지우되, 로컬이 마지막 동기화 뒤 바뀌었으면 원격에 다시 만든다. 전체 재동기화(Google 410, CalDAV token 만료)에서 window 안 로컬 항목의 원격 사본이 보이지 않으면 지우기 전에 portalRef로 먼저 찾아 window 밖으로 옮겨진 사본은 다시 잇는다(실행당 20건, 나머지는 지우지 않고 다음으로 미룬다).
- 원격에서 새로 생긴 일정(portalRef 없음)은 그 학생의 `calendar_events`(NOTE)로 가져온다. 원격 반복 일정은 로컬 행을 만들지 않고 `calendar_remote_series`에 ICS 사본(256 KiB 이하)으로 두어 읽기 전용 외부 항목으로 펼친다. Google은 `singleEvents=false`로 master·예외 instance를 받는다.
- 종일: `calendar_events`에 종일 열이 없으므로 원격 종일 일정은 KST 00:00 ~ 배타적 끝으로 저장하고, 시작·끝이 모두 KST 자정이고 길이가 24시간의 배수면 종일로 보낸다. 레슨은 원격 제목 "레슨", 60분이며 원격에서 옮긴 경우 `scheduledAt`만 반영한다. 끝 시각 없는 포털 일정은 60분으로 보낸다.
- 범위·빈도: window는 지금 -90일 ~ +365일, 실행당 원격 쓰기 60건. 모든 동기화는 조건부 UPDATE lease(`sync_lease_until`, 60초)로 같은 매핑을 동시에 돌리지 않는다. 쓰기 뒤 push는 throttle을 건너뛰지만 lease는 지킨다.
- provider client는 SDK 없이 fetch만 쓴다. Google은 `calendar.events`·`calendar.calendarlist.readonly` scope, `syncToken` 증분(410이면 전체 재동기화), iCloud는 `sync-collection`·`calendar-multiget`(50개씩)과 etag를 쓴다. 허용 host(Google API·OAuth host, `caldav.icloud.com`·`p<N>-caldav.icloud.com`), HTTPS, credential·port 없는 URL만 요청하고 Google redirect는 거부, CalDAV redirect는 같은 허용 host 안에서 3회까지 따른다.
- 보안: 연결·매핑·지금 동기화는 `requireAdmin`(매핑 대상은 `requireStudentTarget`), 학생은 자기 상태와 외부 항목만 본다. Google refresh·access token과 iCloud 앱 암호는 `EXTERNAL_CALENDAR_ENCRYPTION_KEY`로 AES-GCM 암호화하고 AAD `calendar-connection:v1:<연결 ID>:<provider>`로 다른 행·provider로 옮긴 ciphertext를 거부한다(`credentials.ts`). 원문은 응답·화면·로그에 돌려주지 않고 `last_error`에는 짧은 한국어 분류만 남긴다. 인증 실패는 연결을 `NEEDS_REAUTH`로 바꾸고 내부 일정은 그대로 둔다.
- Google OAuth는 PKCE(S256)·`access_type=offline`·`prompt=consent`다. state·code verifier·시작한 관리자·만료(10분)를 서버 저장소 없이 HttpOnly cookie(`portal_google_calendar_oauth`, path `/api/calendar-connections/google`)에 담고, 암호화 key에서 HKDF로 파생한 별도 AES-GCM key로 봉인한다. callback은 봉인 해제·state 상수 시간 비교·같은 관리자·만료를 확인한 뒤 code를 교환하고, code·token·verifier를 log·응답·주소에 남기지 않는다. `calendar.events` scope가 빠지면 연결하지 않는다.

### 캘린더 실시간 반영(2026-10-27 사용자 결정)

`0018`·알림 route(channel id·token·resource id 검증, 실패는 빈 404)·채널 등록·갱신·중지와 `worker.ts` `scheduled`의 캘린더 동기화(유지보수와 `Promise.allSettled`로 분리, 50초 상한, Worker env는 `runWithCalendarSyncEnv`로 전달)는 코드와 fixture·격리 D1 테스트로 구현했다. 운영 Cron 활성화·Google 알림 주소 운영 등록·deploy는 별도 승인 범위이고, Cron이 켜지기 전에는 캘린더 조회 때만 채널이 갱신되어 7일 동안 조회가 없으면 알림이 끊긴다.

- 외부 캘린더를 하나만 연결한 학생: 포털 → 외부는 위의 저장 직후 push(구현 완료). Google → 포털은 Google 변경 알림(`events.watch`, type `web_hook`)으로 포털을 열지 않아도 반영한다. iCloud는 알림 기능이 없어 포털 조회와 예약 동기화 때 반영한다.
- 둘 다 연결한 학생: 포털이 중심이 되어 Worker 예약 실행의 캘린더 동기화가 Google ↔ iCloud 변경을 전달한다. 학생별 연결 수 제한은 두지 않는다.
- `0018_calendar_push_channels`: 매핑 PK(매핑 삭제 시 cascade)·channel ID(UNIQUE)·resource ID·token SHA-256 hex(원문은 Google에만 보낸다)·만료 시각. 채널 수명은 7일로 요청한다.
- 채널 관리: 알림 주소는 Google OAuth redirect URI의 origin + `/api/calendar-connections/google/notify`이고 https일 때만 등록한다(로컬 http는 건너뜀). 채널이 없거나 24시간 안에 만료되면 새 채널을 등록하고 이전 채널은 best-effort로 중지한다. 매핑 저장 뒤 등록, 매핑 해제·연결 해제 전에 중지한다.
- 알림 route는 로그인 없이 `X-Goog-Channel-ID`·`X-Goog-Channel-Token`을 저장된 digest와 상수 시간 비교한다. 실패는 정보 없는 404, `sync` 상태는 200, 그 밖에는 200 응답 뒤 해당 매핑만 lease를 지키며 강제 pull한다. 본문·헤더는 로그에 남기지 않는다.
- 예약 동기화: `worker.ts` `scheduled`가 기존 예약 정리와 독립적으로 모든 활성 매핑을 동기화하고(60초 throttle·lease 동일, 매핑 하나의 실패는 나머지를 막지 않음, 시간 상한 안에서만 새 매핑 시작) Google 채널을 갱신한다. request context가 없으므로 event env를 calendar 설정·암호화 key 읽기에 넘긴다. `wrangler.toml`·`wrangler.scheduled.toml`의 `[triggers]`는 바꾸지 않는다.
