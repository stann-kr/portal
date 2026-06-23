# 변경 이력 (Change Log)

프로젝트 기획부터 개발, 배포 및 유지보수 전 단계를 아우르는 주요 변경 사항을 기록함.
각 변경 사항은 [버전명] - 날짜 형식으로 작성하며, 추가(Added), 수정(Changed), 제거(Removed), 수정/해결(Fixed) 등으로 분류함.

## [Unreleased] - 2026-06-23

### Fixed — note_date migration + calendar feed access + student portal community create flow

- `drizzle/0007_private_notes_note_date.sql` — `private_notes.note_date` 누락 migration 추가
- `src/lib/calendar-feed.ts` — 학생별 signed `.ics` feed token 생성/검증 유틸 신규
- `src/app/dashboard/admin/students/[id]/page.tsx` — 어드민 학생 상세에서 학생별 signed calendar feed URL 생성 후 OverviewTab에 전달
- `src/components/admin/OverviewTab.tsx` — 하드코딩 `/api/calendar/{studentId}` 대신 signed URL prop 사용
- `src/app/api/calendar/[studentId]/route.ts` — admin/session 또는 signed token으로만 접근 허용하도록 수정. 더 이상 admin-only `getStudentById()`에 의존하지 않음
- `src/lib/actions/posts.ts` — `returnTo=student-portal`일 때 redirect 대신 `{ success, postId }` 반환하도록 분기 추가
- `src/components/student-portal/CommunitySection.tsx` — 포털 내부 글 작성 성공 판정을 `state.success` 기반으로 수정하고 `returnTo=student-portal` hidden field 추가
- 검증:
  - `npm run lint` 통과
  - `npx tsc --noEmit` 통과
  - `npm run build` 통과
  - `npm run build:worker` 통과
  - fresh SQLite 시뮬레이션으로 `0000`~`0007` 순차 적용 성공 확인
- 주의:
  - 현재 로컬 Wrangler D1에는 이미 `note_date` 컬럼이 선반영되어 있어 `npm run db:migrate`는 `duplicate column name: note_date`로 실패. 즉 migration 파일 자체 문제라기보다 로컬 DB 상태와 migration 기록 사이에 차이가 있는 상태

### Added — Q&A 첨부 업로드 + 노트/Q&A 작성 폼 임시저장

- `src/lib/hooks/useFormDraft.ts` — 작성 폼 임시저장(draft) 영속화 훅 신규. localStorage 기반, 마운트 시 1회 복원·변경 시 디바운스(500ms) 저장·제출 성공 시 삭제. 복원을 `useEffect` 내에서만 수행하여 하이드레이션 안전 보장
- `src/components/qna/AttachmentField.tsx` — Q&A 첨부 파일 필드 신규. `FileUploader`(R2 presigned 업로드)로 publicUrl 획득 → `name="attachmentUrl"` hidden input 전송, 업로드 후 파일 칩 + 제거 버튼 노출
- `src/lib/actions/qna.ts` — `parseAttachmentUrl` 헬퍼 추가(http/https + 길이 2048 제한 검증). `createQnaThreadInline`(첫 질문 reply)·`createQnaReply`에 `attachmentUrl` 저장 반영. `CreateReplyState`에 `success` 플래그 추가(답변 등록 성공 시 draft 삭제 신호)
- `src/components/qna/QnaSlideForm.tsx` — 제목/내용 제어형 전환, 첨부 필드 추가, 제목·내용·첨부 URL draft 자동 저장/복원
- `src/components/qna/ThreadDetailClient.tsx` — 답변 폼에 첨부 필드 추가, 내용·첨부 URL 스레드별(`draft:qna:reply:{threadId}`) 자동 저장/복원, 등록 성공 시 폼 초기화(에디터 remount)
- `src/components/notes/NoteSlideForm.tsx` — 제목/날짜 제어형 전환, 제목·날짜·내용 학생별(`draft:note:slide:{studentId}`) draft 자동 저장/복원
- `src/components/notes/PrivateNoteForm.tsx` — 제목/날짜 제어형 전환, 학생별(`draft:note:full:{studentId}`) draft 자동 저장/복원, 저장 성공 시 폼 초기화

### Added — 학생 포털 탭 상태 영속화 + 리스트 검색

- `src/components/student-portal/StudentPortalClient.tsx` — 상단 섹션 탭(공지/캘린더/커뮤니티) localStorage 영속화. 마운트 후 복원 방식으로 하이드레이션 불일치 방지
- `src/components/student-portal/CalendarSection.tsx` — 내부 뷰 탭(캘린더/일별/전체/커리큘럼/과제) 제어형 전환 + localStorage 영속화
- `src/components/student-portal/CommunitySection.tsx` — 제목·작성자 클라이언트 검색 입력 추가 (보드 타입 필터와 결합). 검색 결과 없음/게시물 없음 빈 상태 구분
- `src/components/student-portal/AllItemsView.tsx` — 제목 클라이언트 검색 입력 추가 (타입 토글과 결합). 검색 결과 없음/항목 없음 빈 상태 구분

## [Unreleased] - 2026-06-20

### Fixed — 커뮤니티 댓글 저장형 XSS 차단
- `src/lib/actions/comments.ts` — plain-text 댓글 입력을 HTML entity escape 후 `<p>...</p>`로 저장하도록 변경
- 영향: `dangerouslySetInnerHTML`로 렌더링되는 댓글 경로에서 `<script>`, `onerror` 등 사용자 입력 HTML이 실행되지 않고 문자 그대로 표시됨

## [v2.3.0] - 2026-03-30

### Added — 동적 원페이지 포털 + 디깅 인라인 추가 + 노트 날짜 선택

#### Phase 1: 노트 날짜 선택
- `src/db/schema.ts` — `privateNotes` 테이블에 `noteDate` 컬럼 추가 (nullable, 미입력 시 `createdAt` fallback)
- `src/lib/actions/privateNotes.ts` — `createPrivateNote`: `noteDate` FormData 파싱 + INSERT + 반환값 확장 (`note: { id, title, noteDate, createdAt }`)
- `src/lib/actions/unifiedItems.ts` — NOTE 날짜 기준 `noteDate ?? createdAt ?? Date.now()` fallback 적용
- `src/components/notes/NoteFullForm.tsx` — 날짜 선택 input 추가 (제목 옆 레이아웃)
- `src/components/notes/PrivateNoteForm.tsx` — 날짜 선택 input 추가

#### Phase 2: SlidePanel 인라인 작성 + 낙관적 업데이트
- `src/components/notes/NoteSlideForm.tsx` — 신규. SlidePanel 내 노트 인라인 작성 폼 (성공 시 `onSuccess(UnifiedItem)` 콜백)
- `src/components/qna/QnaSlideForm.tsx` — 신규. SlidePanel 내 Q&A 인라인 작성 폼 (성공 시 `onSuccess(UnifiedItem)` 콜백)
- `src/lib/actions/qna.ts` — `CreateThreadInlineState` 반환값 확장 (`thread: { id, title, createdAt }`)
- `src/components/student-portal/SlidePanel.tsx` — `"xl"` 사이즈 추가 (`max-w-3xl`)
- `src/components/student-portal/StudentPortalClient.tsx` — `unifiedItems` → `useState` 승격, `addItem` 콜백 정의, 캘린더 섹션 `display:none` 방식 상시 마운트
- `src/components/student-portal/CalendarSection.tsx` — `onAddItem` prop 수신, 노트/Q&A SlidePanel + NoteSlideForm/QnaSlideForm 통합
- `src/components/student-portal/CreateEntryDropdown.tsx` — `onOpenNotePanel`/`onOpenQnaPanel` prop 추가 (router.push 대체 콜백)

#### Phase 3: 디깅 인라인 추가 행
- `src/components/digging/InlineAddRow.tsx` — 신규. 테이블 하단 트랙 즉시 추가 행 (Enter/+ 버튼, 링크 메타 자동 추출)
- `src/lib/actions/digging.ts` — `createDiggingTrack` 반환값 확장 (`{ id, createdAt }`, 낙관적 업데이트용)
- `src/components/digging/DiggingBoard.tsx` — InlineAddRow 통합, `handleTrackCreated` state 업데이트로 즉시 반영

---

## [v2.2.0] - 2026-03-29

### Added — 풀 페이지 리치텍스트 에디터 + 마크다운 지원

#### 에디터 (FullEditor)
- `src/components/editor/FullEditor.tsx` — 신규. Tiptap v3 기반 풀 사양 에디터
  - 풀 툴바: 실행취소/다시실행, 헤딩(H1-H3), Bold/Italic/Underline/Strikethrough/Highlight, 정렬(Left/Center/Right), 리스트(Bullet/Ordered/Task), 인용구, 코드블록(lowlight 구문강조), 링크, 이미지, 유튜브, 테이블
  - 마크다운 모드 토글: WYSIWYG ↔ 마크다운 textarea 전환 (tiptap-markdown)
- `src/app/globals.css` — ProseMirror 에디터 스타일 추가 (테이블, 코드블록, task-list, 헤딩, 형광펜, 링크 등)

#### 풀 페이지 라우트
- `src/components/notes/NoteFullForm.tsx` — 신규. 노트 작성 클라이언트 폼 (FullEditor 사용)
- `src/app/dashboard/student/notes/new/page.tsx` — 신규. 학생 노트 작성 풀 페이지

#### 진입점 개선
- `src/components/student-portal/CreateEntryDropdown.tsx` — 신규. '+' 버튼 드롭다운 메뉴
  - 노트/Q&A → 풀 페이지 라우팅, 일정/디깅 → 기존 다이얼로그 유지

### Changed — 에디터 마이그레이션 및 팝업 제거

- `src/app/dashboard/qna/new/page.tsx` — TiptapEditor → FullEditor 교체, 에디터 높이 풀 페이지 수준으로 확장
- `src/app/community/new/page.tsx` — TiptapEditor → FullEditor 교체
- `src/components/qna/ThreadDetailClient.tsx` — TiptapEditor → FullEditor 교체
- `src/components/notes/PrivateNoteForm.tsx` — TiptapEditor → FullEditor 교체
- `src/components/student-portal/CalendarSection.tsx` — UnifiedCreateDialog → CreateEntryDropdown 교체

### Removed — 구 팝업/인라인 폼 제거

- `src/components/student-portal/UnifiedCreateDialog.tsx` — 삭제 (CreateEntryDropdown으로 대체)
- `src/components/notes/NoteInlineForm.tsx` — 삭제 (NoteFullForm 풀 페이지로 대체)
- `src/components/qna/QnaInlineForm.tsx` — 삭제 (/qna/new 풀 페이지로 대체)
- `src/components/community/TiptapEditor.tsx` — 삭제 (FullEditor로 전면 교체)

### Dependencies
- 추가: `@tiptap/extension-link`, `@tiptap/extension-table` (+ row/cell/header), `@tiptap/extension-code-block-lowlight`, `@tiptap/extension-placeholder`, `@tiptap/extension-underline`, `@tiptap/extension-text-align`, `@tiptap/extension-highlight`, `@tiptap/extension-typography`, `@tiptap/extension-bubble-menu`, `@tiptap/extension-floating-menu`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `tiptap-markdown`, `lowlight`, `turndown`, `@radix-ui/react-dropdown-menu`

---

## [v2.1.0] - 2026-03-28

### Fixed — 캘린더 디깅/노트/Q&A 추가 불가 버그
- `src/components/student-portal/UnifiedCreateDialog.tsx` — 안내 텍스트 → 실제 인라인 폼으로 교체. 뒤로가기 버튼, 타입별 폼 렌더링
- `src/components/student-portal/CalendarSection.tsx` — `studentId`, `diggingColumns` prop을 UnifiedCreateDialog에 전달. `headerSlot` prop 추가
- `src/components/digging/AddTrackInlineForm.tsx` — 신규. Dialog 없는 순수 디깅 폼 (fetchLinkMeta, StarRating, CamelotPicker 재사용)
- `src/components/digging/AddTrackDialog.tsx` — AddTrackInlineForm 래퍼로 리팩토링
- `src/components/notes/NoteInlineForm.tsx` — 신규. Dialog 없는 순수 노트 폼 (학생 본인/어드민 작성 가능)
- `src/components/qna/QnaInlineForm.tsx` — 신규. Dialog 없는 순수 Q&A 폼
- `src/lib/actions/qna.ts` — `createQnaThreadInline` 추가 (redirect 없이 결과만 반환)

### Added — 어드민 원페이지 전환
- `src/components/admin-portal/AdminPortalClient.tsx` — 신규. 4탭 원페이지 오케스트레이터 (공지/캘린더/커뮤니티/학생관리)
- `src/components/admin-portal/AdminSideRail.tsx` — 신규. 56px 어드민 아이콘 레일
- `src/components/admin-portal/StudentManagementSection.tsx` — 신규. 통계 카드 + 학생 로스터 + 인라인 확장 상세
- `src/components/admin-portal/StudentFilterDropdown.tsx` — 신규. 캘린더 학생 필터 드롭다운
- `src/lib/actions/unifiedItems.ts` — `getUnifiedItemsForStudent(studentId)` 추가 (어드민 전용)
- `src/app/dashboard/admin/page.tsx` — RSC 셸 재구성. AdminPortalClient로 전환
- `src/app/dashboard/layout.tsx` — 어드민 240px 사이드바 → AdminSideRail 레일로 교체

### Changed — 개념 분리 및 UI 현대화
- `src/components/student-portal/CommunitySection.tsx` — "전체 학생 소통 공간" 서브헤딩 추가
- `src/app/globals.css` — Notion 스타일 디자인 토큰 조정 (border, muted, accent 색상)
- `src/components/ui/button.tsx` — 호버 효과 정제, 크기 미세 조정
- `src/components/ui/dialog.tsx` — backdrop blur 적용, shadow 축소
- `src/components/student-portal/StudentPortalClient.tsx` — 탭 바 스타일 Notion화
- `src/components/admin-portal/AdminPortalClient.tsx` — 탭 바 스타일 Notion화

## [v2.0.0] - 2026-03-27

### Added — 학생 원페이지 포털 (Notion 스타일 리디자인)

- `src/lib/actions/unifiedItems.ts` — 5개 테이블 병렬 집계 `UnifiedItem[]` 정규화 서버 액션
- `src/lib/actions/feedbacks.ts` — `getMyFeedbacksMap()` 추가
- `src/components/student-portal/StudentSideRail.tsx` — 56px 아이콘 레일
- `src/components/student-portal/StudentPortalClient.tsx` — Framer Motion 3섹션 탭 전환 오케스트레이터
- `src/components/student-portal/AnnouncementSection.tsx` — 공지사항 섹션
- `src/components/student-portal/CalendarSection.tsx` — 5개 뷰 탭 캘린더 섹션
- `src/components/student-portal/UnifiedCalendar.tsx` — FullCalendar 통합 뷰
- `src/components/student-portal/DailyListView.tsx` — 날짜별 그룹핑 리스트
- `src/components/student-portal/AllItemsView.tsx` — 전체 항목 플랫 리스트 + 타입 필터
- `src/components/student-portal/CurriculumView.tsx` — 커리큘럼 낙관적 완료 토글 뷰
- `src/components/student-portal/AssignmentView.tsx` — 과제 제출 폼 + 리스트
- `src/components/student-portal/AssignmentDetailPanel.tsx` — VideoPlayer + 타임라인 피드백
- `src/components/student-portal/UnifiedCreateDialog.tsx` — 통합 엔트리 생성 다이얼로그
- `src/components/student-portal/SlidePanel.tsx` — 우측 슬라이드인 상세 패널 (Radix Dialog)
- `src/components/student-portal/UnifiedItemDetail.tsx` — 타입별 아이템 상세 뷰
- `src/components/student-portal/CommunitySection.tsx` — 커뮤니티 섹션 + 글 작성 다이얼로그
- `src/components/student-portal/PostDetailPanel.tsx` — 게시물 상세 + 댓글 폼

### Changed

- `src/app/dashboard/layout.tsx` — 학생/어드민 사이드바 분기 (student → 56px rail, admin → 240px)
- `src/app/dashboard/student/page.tsx` — RSC 원페이지 셸 재작성 (6개 병렬 패치)
- `src/lib/actions/digging|privateNotes|qna|calendarEvents|assignments.ts` — `revalidatePath("/dashboard/student")` 추가
- `src/app/dashboard/student/{digging,notes,curriculum,assignments}/page.tsx` — 원페이지로 리다이렉트

### Fixed

- `src/auth.config.ts` — `providers: [Credentials({})]` → `providers: []` 변경 (NextAuth v5 provider merge로 authorize 함수 미호출 버그 수정, 로그인 불가 문제 해결)
- `src/lib/actions/unifiedItems.ts` — `export { getUnifiedItemColor }` 제거 (`"use server"` 파일에서 동기 함수 export 불가 컴파일 에러 수정)
- `src/lib/utils/unifiedItemUtils.ts` — 신규 생성 (타입·색상 헬퍼 분리, 클라이언트 컴포넌트 임포트 경로 안정화)
- `src/auth.ts` — 디버그 `console.error` 제거 (catch 블록 정리)

---

## [v1.5.0] - 2026-03-27

### Fixed

- `src/app/dashboard/admin/students/[id]/page.tsx` — `|| true` 오타 제거 (노트 삭제 버튼 권한 버그 수정 — 모든 노트에 삭제 버튼 노출되던 보안 버그)
- `src/lib/actions/digging.ts` — `getDiggingTracks` / `updateDiggingTrackValue` JSON.parse try-catch 추가 (손상된 JSON으로 인한 서버 크래시 방지)
- `src/lib/actions/feedbacks.ts` — `timeMarkerStr` null 참조 오류 수정 (`?? ""` 적용)
- `src/app/dashboard/admin/students/[id]/page.tsx` — `toLocaleDateString` → `toLocaleString` 변경 (시간 표시 옵션 미적용 버그 수정)
- `src/components/calendar/PersonalCalendar.tsx` — 이벤트 삭제 `handleDelete` try-catch 추가 (삭제 실패 시 UI/DB 상태 불일치 방지)

### Changed

- `src/app/dashboard/qna/page.tsx` — `any[]` 캐스트 제거, `Awaited<ReturnType<...>>` 패턴 적용

### Docs

- `.docs/README.md` — 개인 캘린더, 디깅 게시판, 1:1 프라이빗 노트, Q&A 기능 추가 (Phase 4–6 누락 항목 현행화)
- `.docs/README.md` — 기술 스택 표에 FullCalendar, TanStack Table, isomorphic-dompurify 추가
- `.docs/README.md` — 스키마 섹션에 categories, privateNotes, calendarEvents, diggingColumns, diggingTracks, qnaThreads, qnaReplies 추가
- `.docs/README.md` — 라우트 구조에 calendar, digging, notes, qna 관련 7개 경로 추가

---

## [v1.4.0] - 2026-03-26

### Added

- `src/lib/auth-guard.ts` — 공통 인증/인가 가드 유틸 (`requireAuth`, `requireAdmin`) 추출
- `isomorphic-dompurify` 의존성 추가 — 서버사이드 HTML 새니타이징

### Changed

- `src/lib/actions/` 전체 12개 파일 — 중복 `requireAuth/requireAdmin` 제거, `auth-guard.ts` 임포트로 대체
- `src/lib/actions/privateNotes.ts` — 노트 저장 시 서버사이드 XSS 방어 적용 (이중 새니타이징)
- `src/app/community/[postId]/PostDetailClient.tsx` — `any` 타입 → `ReturnType` 기반 명시적 타입 정의
- `src/app/api/calendar/[studentId]/route.ts` — `any` 타입 → `Awaited<ReturnType<...>>` 패턴 적용
- `src/components/player/VideoPlayer.tsx` — `any` 타입 제거, `ReactPlayerInstance` 인터페이스 정의
- `src/lib/actions/students.ts` — `any` 타입 제거, Drizzle 추론 타입 활용
- `src/db/client.ts` — `catch (e: any)` → `catch (e: unknown)`, 프로덕션 민감 정보 로깅 제거
- `src/auth.ts` — 인증 디버그 로그(이메일 노출 포함) 제거
- `src/lib/actions/upload.ts` — 에러 핸들러 내 `console.error` 제거
- `src/components/dashboard/ProgressCharts.tsx` — 스파크라인 데이터 `useMemo` 최적화 적용
- `src/components/digging/StarRating.tsx` — `role="radiogroup"`, `aria-label`, `aria-pressed` 접근성 속성 추가
- `src/components/player/VideoPlayer.tsx` — 플레이/일시정지 버튼 `aria-label` 추가
- `src/components/qna/ThreadDetailClient.tsx` — 상태 변경 버튼 `aria-current` 추가
- `src/components/community/TiptapEditor.tsx` — 툴바 `role="toolbar"`, 버튼 `aria-label`/`aria-pressed` 추가

### Fixed

- `src/lib/actions/categories.ts` — `requireAdmin()` 반환값 누락 버그 수정 (`return session` 추가)

---

## [v1.3.0] - 2026-03-25

### Added

- `src/components/qna/ThreadList.tsx` — Q&A 스레드 목록 (OPEN/ANSWERED/CLOSED 상태 뱃지)
- `src/components/qna/ReplyCard.tsx` — 답변 카드 (어드민 우측/학생 좌측 스타일 구분)
- `src/components/qna/ThreadDetailClient.tsx` — 답변 작성 폼 + 어드민 상태 변경 버튼
- `src/lib/actions/qna.ts` — Q&A CRUD 서버 액션 (스레드/답변 생성, 상태 변경, 미답변 카운트)
- `drizzle/0006_qna_board.sql` — qna_threads / qna_replies 마이그레이션
- `src/app/dashboard/qna/page.tsx` — Q&A 목록 페이지
- `src/app/dashboard/qna/new/page.tsx` — 새 질문 작성 페이지
- `src/app/dashboard/qna/[threadId]/page.tsx` — 스레드 상세 페이지

### Changed

- `src/db/schema.ts` — qnaThreads, qnaReplies 테이블 추가
- `src/app/dashboard/layout.tsx` — Q&A 메뉴 + 미답변 뱃지 추가 (admin/student 모두)
- `src/app/community/CommunityClient.tsx` — 사이드바에 '대시보드로' 뒤로가기 링크 추가

### Fixed

- 커뮤니티 페이지 진입 시 홈/대시보드로 이동 불가 문제 수정

---

## [v1.2.0] - 2026-03-25

### Added

- `src/components/digging/DiggingBoard.tsx` — TanStack Table + 날짜 범위 필터 + 날짜별 그룹핑 + 인라인 셀 편집
- `src/components/digging/AddTrackDialog.tsx` — 트랙 추가 다이얼로그 (링크 oEmbed 자동 추출)
- `src/components/digging/ColumnManager.tsx` — 컬럼 추가/삭제 관리 다이얼로그
- `src/components/digging/StarRating.tsx` — 호버/클릭 별점 컴포넌트
- `src/components/digging/CamelotPicker.tsx` — 카멜롯 휠 키 선택기
- `src/lib/actions/digging.ts` — 디깅 CRUD + fetchLinkMeta (YouTube/SoundCloud oEmbed, OG 파싱)
- `drizzle/0005_digging_board.sql` — digging_columns / digging_tracks 마이그레이션
- `src/app/dashboard/student/digging/page.tsx` — 학생 개인 디깅 보드 페이지
- `src/app/dashboard/admin/students/[id]/digging/page.tsx` — 어드민 읽기 전용 뷰

### Changed

- `src/db/schema.ts` — diggingColumns, diggingTracks 테이블 추가
- `src/app/dashboard/layout.tsx` — 학생 사이드바에 Digging 메뉴 추가
- `src/app/dashboard/admin/students/[id]/page.tsx` — 학생 상세에 Digging 보드 링크 추가

### Dependencies

- `@tanstack/react-table` 추가

---

## [v1.1.0] - 2026-03-25

### Added

- `src/components/calendar/PersonalCalendar.tsx` — FullCalendar 기반 개인 캘린더 (월/주/일/목록 뷰, 드래그&드롭)
- `src/components/calendar/EventFormDialog.tsx` — 이벤트 생성 다이얼로그 (유형/제목/시작/종료/메모)
- `src/components/ui/dialog.tsx` — Radix UI Dialog 래퍼
- `src/lib/actions/calendarEvents.ts` — 캘린더 이벤트 CRUD 서버 액션
- `drizzle/0004_personal_calendar_events.sql` — calendar_events 테이블 마이그레이션

### Changed

- `src/app/dashboard/calendar/page.tsx` — 기존 정적 캘린더 → FullCalendar 기반 동적 캘린더로 교체
- `src/db/schema.ts` — calendarEvents 테이블 추가 (LESSON/PRACTICE/GIG/NOTE)
- `src/app/globals.css` — FullCalendar 테마 오버라이드 CSS 추가

### Dependencies

- `@fullcalendar/react`, `@fullcalendar/core`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`, `@fullcalendar/list` 추가
- `@radix-ui/react-dialog` 추가

---

## [v1.0.0] - 2026-03-25

### Added

- `src/components/community/AnnouncementList.tsx` — Radix UI Accordion 기반 공지 아코디언 UI, 어드민 핀 고정/해제
- `src/components/community/MixsetFeedbackCard.tsx` — 믹스셋 리치 미디어 카드, HTML5 인라인 오디오 플레이어
- `src/components/ui/accordion.tsx` — Shadcn 스타일 Accordion 컴포넌트
- `src/components/ui/tabs.tsx` — Shadcn 스타일 Tabs 컴포넌트
- `drizzle/0003_community_board_type.sql` — posts 테이블 board_type/is_pinned/media_url 마이그레이션

### Changed

- `src/db/schema.ts` — posts 테이블에 boardType(ANNOUNCEMENT/GENERAL/FEEDBACK), isPinned, mediaUrl 컬럼 추가
- `src/lib/actions/posts.ts` — getPostsByBoardType(), togglePinPost() 추가; deletePost() category 파라미터 제거
- `src/app/community/CommunityClient.tsx` — 3탭 UI(공지/자유/믹스셋) 전면 재작성
- `src/app/community/new/page.tsx` — boardType 선택 탭 + FEEDBACK R2 오디오 업로드 UI 추가
- `src/app/community/[postId]/PostDetailClient.tsx` — deletePost 호출 시그니처 수정
- `src/app/globals.css` — accordion-down/up 애니메이션 keyframe 추가

### Fixed

- `PostDetailClient.tsx`: deletePost()에 category 파라미터 전달하던 코드 제거 (시그니처 불일치 해소)

### Dependencies

- `@radix-ui/react-accordion` 추가
- `@radix-ui/react-tabs` 추가

---

## [v0.9.0] - 2026-03-25

### Added

- `src/components/dashboard/ProfileCourseWidget.tsx` — 프로필 + 티어 뱃지 + 진도 바 위젯
- `src/components/dashboard/UpcomingLessonsWidget.tsx` — D-day 알림 + .ics 다운로드 위젯
- `src/components/dashboard/DiggingAnalyticsWidget.tsx` — Recharts BarChart 주간 트랙 통계 (목데이터)
- `src/components/dashboard/PendingQnaWidget.tsx` — Q&A 미답변 알림 위젯 (목데이터)
- `.docs/phases/PHASE_PROGRESS.md` — 고도화 단계별 진행 현황 추적 문서 신규 생성

### Changed

- `src/components/dashboard/ProgressCharts.tsx` — Recharts AreaChart 스파크라인 추가, 레이아웃 개선
- `src/app/dashboard/student/page.tsx` — 3컬럼 반응형 위젯 그리드 + 독립 Suspense 병렬 스트리밍
- `src/app/dashboard/admin/page.tsx` — 헤더 아이콘 추가, 반응형 개선
- `src/components/admin/StatsCards.tsx` — 이번 주 레슨 수/미답변 피드백 실데이터 연동, 아이콘 + 색상 체계 추가

### Dependencies

- `recharts` 추가

---

## [v0.8.0] - 2026-03-25

### Added

- `src/lib/r2.ts` — Cloudflare R2 S3 클라이언트 초기화, `generatePresignedUploadUrl()`, `deleteR2Object()` 구현
- `src/lib/actions/upload.ts` — Presigned URL 발급 서버 액션 (인증 검증 포함)
- `src/components/upload/FileUploader.tsx` — 범용 파일 업로드 컴포넌트 (진행률 표시, R2 직접 PUT)
- `src/modules/` — Feature-Sliced 디렉토리 구조 (auth/, digging/, calendar/, qna/) 초기 생성
- `src/app/community/CommunityClient.tsx` — 커뮤니티 페이지 클라이언트 컴포넌트 분리

### Changed

- `src/app/community/page.tsx` → RSC 래퍼 패턴으로 전환 (`force-dynamic`, 서버 액션 직접 임포트 제거)
- `src/app/layout.tsx` — `export const dynamic = "force-dynamic"` 추가 (인증 앱 전체 동적 렌더링)
- `src/pages/_document.tsx`, `_app.tsx`, `_error.tsx` 신규 생성 (App Router + Pages Router 공존 필수 파일)
- `next.config.ts` — `@cloudflare/next-on-pages/next-dev` 제거, ESLint 빌드 비활성화
- `.env.example` — R2 환경 변수 (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`) 추가

### Fixed

- `npm run build` 정적 생성 단계 `TypeError: Cannot read properties of undefined (reading 'env')` 해결 (RSC 래퍼 패턴 + force-dynamic 전환)
- `VideoPlayer.tsx` — `react-player` SSR 충돌 해결 (`dynamic()` ssr:false 로 전환)

---

## [v0.6.0] - 2026-03-24

### Changed

- Cloudflare 배포 어댑터를 `@cloudflare/next-on-pages` → `@opennextjs/cloudflare`로 전환함. (모든 라우트에 Edge Runtime 강제 선언 제거 가능, Node.js 호환성 확보)
- `package.json`의 빌드 스크립트를 `build:pages` → `build:worker`로 변경하여 OpenNext CLI를 직접 호출함
- `wrangler.toml`의 진입점을 `.vercel/output/static/_worker.js` → `.open-next/worker.js`로, 에셋 경로를 `.open-next/assets`로 변경함
- `open-next.config.ts` 파일 신규 추가 (OpenNext 빌더 최소 설정)
- `.gitignore`에 `.open-next/` 빌드 산출물 경로 추가

## [v0.7.0] - 2026-03-24

### Added

- **관리자 계정 생성 유틸리티**: `src/scripts/setup-admin.ts` 추가 (bcrypt 해싱 기능 포함).
- **커스텀 도메인**: `portal.stann.kr` 연결 및 `wrangler.toml` 라우트 설정 완료.
- **인증 안정화**: `AUTH_URL` 환경변수 주입 및 `trustHost: true` 설정을 통한 리다이렉트 루프 방지.

### Fixed

- **D1 바인딩 런타임 오류**: OpenNext 환경에서 `process.env.DB` 접근 불가 문제를 `getCloudflareContext().env.DB` 방식으로 전면 수정하여 `CallbackRouteError` 해결.
- **미들웨어 루프**: 인증 콜백 경로(`/api/auth`)를 미들웨어 `matcher`에서 제외하여 무한 리다이렉트 원천 차단.
- **개발 서버 크래시**: `next-on-pages` 관련 구식 참조 코드를 제거하여 로컬 Docker 환경 안정화.

### Fixed

- 기존 배포 어댑터가 요구하던 모든 라우트 파일(SSR 페이지, API 라우트 등)에 `export const runtime = 'edge'` 강제 선언 문제 해소

---

## [v0.5.0] - 2026-03-24


### Changed

- `assignments/[id]/page.tsx` 등 다수의 Client Component 안티패턴을 Server Component 데이터 패칭 구조로 개편함 (Next.js 15 App Router 권장 패턴 적용)
- `admin/page.tsx`의 비대해진 로직을 `StatsCards`, `StudentRoster` 모듈로 분리하여(SoC) 유지보수성 향상함
- `next.config.ts`에 `serverExternalPackages: ["better-sqlite3", "bcryptjs"]`를 선언하여 서버/클라이언트 번들링 충돌 현상을 해결함

### Fixed

- 프로젝트 전역의 `any` 암시적 타입 할당 에러(map 파라미터 등)를 모두 명시적 타입으로 수정해 strict 모드 타입 안전성을 확보함
- `docker-compose.yml` 내부의 하드코딩된 `NODE_ENV=development`로 인해 Next.js 프로덕션 빌드 과정에서 `setupDevPlatform` 기반의 Edge 라우터 패치가 개입되어 발생하는 `<Html>` 렌더링 충돌 빌드 에러를 원천 차단함
- Client Component 내부의 `useSearchParams` 훅을 `Suspense` 바운더리로 래핑하여 PRERENDER_ERROR(CSR Bailout) 빌드 에러 현상을 수정함

---

## [v0.4.0] - 2026-03-10

### Added

- **Phase 1 — 학생 계정 관리**: `students.ts` 서버 액션(createStudent, getStudents, deleteStudent), `StudentCard` 컴포넌트, `/dashboard/admin/students/new` 폼 페이지, Admin Dashboard DB 연동(Suspense 스트리밍)
- **Phase 2 — 커리큘럼/레슨/캘린더**: `curriculum.ts`(createModule, toggleComplete), `lessons.ts`(createLesson), 학생 상세 페이지(`/admin/students/[id]`), Student Dashboard DB 연동, 커리큘럼 목록 페이지(진행률 바), `/api/calendar/[studentId]` `.ics` 파일 API
- **Phase 3 — 과제/피드백**: `assignments.ts`(submitAssignment, getMyAssignments), `feedbacks.ts`(createFeedback, MM:SS 파싱), `TimelineFeedback` 컴포넌트(타임스탬프 클릭→VideoPlayer seekTo), 과제 목록/상세 페이지, VideoPlayer `seekToSeconds` prop 리팩터
- **Phase 4 — 커뮤니티 게시판**: `posts.ts`/`comments.ts` CRUD 서버 액션, 커뮤니티 메인 페이지 전면 DB 연동(Sci-Fi 제거, 클린 테마), 게시물 상세/작성 페이지, 댓글 기능
- 사이드바 네비게이션 역할별 분기(Admin: Students, Community / Student: Curriculum, Assignments, Community)
- `ics` npm 패키지 설치

### Fixed

- `[student_id]` vs `[studentId]` dynamic route slug 충돌 해소(기존 목업 폴더 제거)

---

## [v0.3.0] - 2026-03-10

### Fixed

- 인증 미들웨어 미작동 결함 해결: `proxy.ts` → `middleware.ts`로 파일명 변경 (Next.js 파일 규약 준수)
- Docker 의존성 설치 누락 결함 해결: `docker-compose.yml`의 `command: npm run dev` 제거, Dockerfile CMD 복원
- Docker 환경변수 누락 해결: `env_file: .env.local` 추가로 `AUTH_SECRET` 등 환경변수 컨테이너에 정상 주입

### Changed

- Sci-Fi/neon 테마 잔존 요소 전면 정리: Orbitron 폰트, neon glow shadow, cyan grid 배경 제거
- `(as any)` 타입 캐스팅 전량 제거: `next-auth.d.ts` 타입 모듈 확장으로 `role` 필드 타입 안전화
- Dashboard 레이아웃 클린/미니멀 디자인으로 교체
- `auth.ts`: `(process.env as any).DB` → `getRequestContext().env.DB` Cloudflare 공식 패턴으로 교체
- `types/` 디렉토리 신설: `next-auth.d.ts`, `user.ts` 타입 선언 파일 추가

## [v0.2.0] - 2026-03-10

### Changed

- 기획 변경에 의한 백엔드 인프라 전면 교체 적용 완료 (Supabase -> Cloudflare D1/R2 마이그레이션)
- NextAuth.js (Auth.js v5) 및 Drizzle ORM 어댑터 연동으로 인증 로직 갱신함
- 전체 `.docs` 문서 시스템 (REQUIREMENTS.md 추가 등) 및 Task 체크리스트 최신화함

## [v0.1.0] - 2026-03-10

### Added

- Stann Lumo - DJ Lesson Portal 기획안 기반 프로젝트 설정 정의함
- `task.md` 및 `implementation_plan.md`를 포함한 프로젝트 초기 문서화 작성 완료
- M1 Mac 환경을 고려한 100% Docker 기반 전역 환경 지침(Global Prompt) 적용함
- `README.md`, `CHANGE_LOG.md`, `TROUBLESHOOTING.md` 등 코어 문서 생성 완료

### Changed

- (현재 단계에서 Supabase 기반 코드들은 삭제 후 v0.2.0으로 롤오버됨)
