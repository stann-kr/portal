# 디자인 시스템

## 목적

포털의 시각 언어와 상호작용 상태를 일관되게 유지하기 위한 구현 기준이다. 학생과 관리자가 장시간 읽고 기록하는 제품 특성에 맞춰 장식보다 정보 우선순위, 상태 피드백, 키보드 접근성을 우선한다.

## 설계 방향

`Quiet Ledger`를 기본 방향으로 사용한다. 디자인 원본은 Claude Artifact Design 캔버스 "Stann Lumo 포털 미니멀 리디자인"(링크는 `.docs/HANDOFF.md`)이며, 구현 화면은 해당 artboard와 1:1로 맞추고 이 문서의 값은 캔버스 Tokens·MobileSpec 보드와 같게 유지한다.

- 흰 바탕과 먹색 글자, 1px 선으로 구획한다. 면을 겹겹이 쌓지 않고 선과 여백으로 나눈다.
- 강조색은 파랑(`highlight`) 하나로 오늘·선택·초점에만 쓴다. 주 버튼은 강조색이 아니라 먹색이다.
- 일정·노트·디깅·Q&A·과제 같은 유형과 상태는 작은 점(6–8px)으로 구분하고 글자는 먹색을 유지한다.
- success, warning, destructive, info는 의미 전달에만 사용한다.
- 학생과 관리자의 첫 화면은 다음 행동과 그 근거가 되는 시간·상태를 먼저 보여준다.
- 애니메이션은 hierarchy, feedback, state transition을 설명할 때만 사용한다.

## Token

Token은 `src/app/globals.css`의 Tailwind theme layer에 정의한다. 화면 구현에서는 아래 semantic 이름을 사용하고 임의 hex 또는 원색 utility를 추가하지 않는다. `cn()`은 `src/lib/utils.ts`에서 아래 글자·모서리·그림자 토큰을 tailwind-merge에 등록해 같은 종류끼리만 덮어쓴다. 새 토큰을 추가하면 그 목록도 갱신한다.

### Color

| 캔버스 이름 | Token | 라이트 | 다크 | 용도 |
|---|---|---|---|---|
| 배경 | `background`, `canvas`, `surface`, `card` | #FFFFFF | #0F0F11 | 앱 바탕·기본 면 |
| 사이드바 | `sidebar` | #F7F7F6 | #151517 | 데스크톱 사이드바, 옅은 안내 면 |
| 채움 | `muted`, `secondary` | #F1F1EF | #1E1E21 | 채움 면, 목록 행 구분선(`border-muted`), 세그먼트 바탕 |
| 선택 채움 | `selected` | #EAEAE8 | #26262A | 사이드바 현재 메뉴, 아바타 |
| 선 | `border`, `input` | #E8E8E6 | #2A2A2E | 구획선·입력 테두리 |
| 글자 | `foreground`, `primary` | #18181B | #ECECEE | 본문·제목, 주 버튼 면 |
| 글자 2 | `secondary-foreground` | #52525B | #B4B4BB | 보조 글자, 비활성 메뉴, 섹션 머리 |
| 글자 3 | `muted-foreground` | #6B6B73 | #8E8E96 | 날짜·메타·캡션. 읽는 글자는 글자 3까지만 쓴다 |
| 비활성·장식 | `faint` | #B4B4BB | #52525B | 체크 테두리와 구분 기호에만 쓴다 |
| 강조 | `highlight`, `ring` | #2D5BFF | #7B95FF | 오늘·선택·초점 |
| 강조 옅게 | `accent` / `accent-foreground` | #EEF2FF / #2D4BCC | #1C2240 / #A5B4FC | 선택 면과 그 위 파랑 글자 |
| 위험 | `destructive`, `destructive-muted`, `destructive-border` | #B42318 · #FEF3F2 · #F3C7C2 | #F97066 · #2D1513 · #5F2420 | 삭제·오류 |
| 경고 | `warning`, `warning-muted`, `warning-border` | #B54708 · #FFFAEB · #FEDF89 | #F5A65B · #2E2110 · #5C3D14 | 대기·주의 |
| 완료 | `success`, `success-muted` | #0B7A6E · #E7F5F3 | #34C3B0 · #10302C | 완료 상태 |
| 정보 | `info`, `info-muted` | #2D4BCC · #EEF2FF | #A5B4FC · #1C2240 | 안내 |
| 시트 뒤 | `scrim` | rgb(24 24 27 / .32) | rgb(0 0 0 / .5) | 시트·서랍·대화상자 뒤 화면 |

항목 유형 점(`event-*`, `item-*`): 레슨 #2D5BFF, 연습 #0E9384, 공연 #E8590C, 노트 #8A8A93, 디깅 #7A5AF8, Q&A #CA8A04, 과제 #DD2590. 다크에서는 레슨 #7B95FF, 연습 #34C3B0, 공연 #F2884B, 노트 #A1A1AA(HomeDark 보드)와 디깅 #A48BFA, Q&A #EAB308, 과제 #F472B6로 밝혀 어두운 면에서 3:1 이상을 낸다. 일정 노트와 통합 노트는 같은 점을 쓴다.

운영체제의 `prefers-color-scheme`에 따라 같은 semantic token의 dark 값이 적용된다. 개별 section이 임의로 theme를 반전하지 않는다. 캔버스 다크 보드가 정하지 않은 값(위험·경고·완료·정보·강조 옅게, 디깅·Q&A·과제 점, 다크 주 버튼)은 위 표 값으로 정했고 캔버스 갱신 항목으로 남긴다.

### Typography

글자는 본문 IBM Plex Sans KR(400·500·600), 시간·숫자 IBM Plex Mono(400·500)다. `next/font/google`이 빌드 때 받아 자체 호스팅하고 `--font-sans`·`--font-mono`로 연결한다. 한국어 줄바꿈은 `word-break: keep-all`이다.

| 단계 | Utility | 크기/줄 | 굵기 |
|---|---|---|---|
| Display | `text-display tracking-display` | 28/36 | 600 |
| Title | `text-xl tracking-title` | 20/28 | 600 |
| Dialog | `text-dialog` | 17/24 | 600 |
| 목록 제목 | `text-md` | 15/22 | 400–500 |
| Body | `text-body` | 14/22 | 400 |
| Section·컨트롤 | `text-ui` | 13/20 | 600(섹션 머리, 글자 2) · 400–500(버튼) |
| Caption | `text-xs` | 12/16 | 400, 글자 3 |
| Mono | `font-mono text-xs` | 12/16 | 시간·날짜·BPM·개수 |
| 모바일 제목 | `text-mobile-title` | 22/30 | 600 |

모바일 본문은 15/24(`text-md leading-6`), 보조 13/20, 입력 글자는 16px(확대 방지)이다.

### Shape

| 역할 | Radius |
|---|---|
| 칩·세그먼트 칸 | `xs`/`sm`, 4px |
| 버튼·입력 등 데스크톱 control | `md`, 6px |
| 모바일 control(입력·주 버튼·목록 버튼) | `touch`, 8px |
| 패널·대화상자·메뉴 | `lg`, 10px |
| 시트 위 모서리 | `xl`, 16px |

pill 형태는 오늘 날짜 표시와 개수처럼 모양 자체가 의미를 가질 때만 사용한다.

### Elevation

- 기본 면은 선 또는 여백으로 구분하고 그림자를 쓰지 않는다. 떠 있는 창만 그림자를 쓴다.
- 메뉴·드롭다운 `shadow-floating`, 대화상자 `shadow-overlay`(0 12px 32px / 12%), 아래 시트 `shadow-sheet`, 메뉴 서랍 `shadow-drawer`, 세그먼트 선택 칸 `shadow-segment`.

### Shell

- 넓은 화면(≥768px): 240px 사이드바(`sidebar` 면, 오른쪽 1px 선, 위아래 16·좌우 12 여백, 묶음 간격 24). 로고 24px, 메뉴 행 32px·r6·14px, 현재 메뉴는 `selected` 면+먹색 500, 나머지는 글자 2. 아래 계정 줄은 위 1px 선, 28px 아바타, 이름 13/500, 역할 12, … 계정 메뉴(이 기기의 초안·비밀번호 변경·(학생) 계정 삭제·구분선·로그아웃).
- 좁은 화면: 52px 위쪽 막대(아래 `border-muted` 선, 44×44 버튼). 왼쪽은 메뉴 또는 뒤로, 가운데 제목, 오른쪽은 화면의 주 행동이다. 기본값은 `resolveMobileTopBar`가 주소에서 정하고 화면은 `MobileTopBar`로 덮어쓴다. 메뉴 서랍은 왼쪽에서 열리는 280px, 메뉴 행 44px·r8·15px, 현재 메뉴 `muted` 면.
- 대화상자는 좁은 화면에서 아래 시트(위 모서리 16, 손잡이 36×4, 뒤 화면 32% 어둡게, 홈 표시줄 위 34), 넓은 화면에서 가운데 r10 패널이다.

### Motion과 layer

- 지속 시간: fast 120ms, standard 200ms, slow 280ms
- easing: `--ease-studio`
- layer: base, sticky, dropdown, overlay, toast 순서
- transform과 opacity만 전환 대상으로 사용한다.
- `prefers-reduced-motion: reduce`에서는 애니메이션과 부드러운 스크롤을 즉시 전환으로 줄인다.
- 공통 overlay는 `components/ui/overlay-motion.css`의 Radix `data-state` 진입·퇴장 스타일을 사용한다. 메뉴는 trigger를 기준으로 열리고, 다음 dialog는 메뉴의 focus scope가 종료된 뒤 열린다.

## 상태 Registry

`src/lib/portal-status.ts`는 사용자 label, semantic tone, icon key를 함께 관리한다.

| Key | Label | Tone |
|---|---|---|
| `qnaOpen` | 답변 대기 | warning |
| `qnaAnswered` | 답변 완료 | success |
| `qnaClosed` | 종료 | neutral |
| `feedbackWaiting` | 피드백 대기 | warning |
| `feedbackReady` | 피드백 도착 | info |
| `lessonUpcoming` | 예정 | info |
| `complete` | 완료 | success |

상태를 추가할 때 label과 색을 화면마다 별도로 만들지 않는다. registry와 관련 테스트를 먼저 갱신한다.

## 공통 Component

| Component | 책임 |
|---|---|
| `Button` | variant, size, focus, disabled, active feedback |
| `Input` | label과 조합되는 입력 surface, focus, disabled |
| `PortalNavigation` | 역할별 section 이동, 현재 위치, horizontal mobile fallback |
| `PortalShell` | 역할별 navigation, URL·section별 스크롤 복원, viewport 안의 공통 content frame |
| `CalendarSection` | 세션 내 날짜·월/주 보기·필터 유지, 수동 키보드 탭 활성화, 활성 시 크기 재측정 |
| `UnifiedCalendar` | 노션식 자체 툴바(제목·이전/오늘/다음·월/주/목록), 타입 필터, KST 벽시계 칸(UTC 모드), 권한 있는 일정·레슨·노트 끌어 옮기기와 저장 전 반영·실패 원위치·되돌리기, 잠긴 항목 끌기 시 이유 안내, 칸 클릭·끌어 선택·터치 탭으로 빠른 만들기 |
| `CalendarQuickCreate` | 캘린더·일별·전체 보기가 공유하는 빠른 만들기 창(좁은 화면은 아래 시트). 노트는 제목·날짜를 채운 작성 화면으로, 일정·레슨은 그 자리에서 저장. 라디오 키보드 규칙, Esc 닫기, 제목이 있으면 바깥 클릭에도 유지 |
| `CalendarEventChip` | 타입 색 왼쪽 막대·옅은 배경·아이콘·시각·제목의 캘린더 칩. 목록 보기와 선택 미리보기는 FullCalendar 기본 렌더 |
| `DailyListView`·`AllItemsView` | 날짜별 노션식 목록(오늘·내일 표시, 하루 안 종일→시간순, 날짜별 추가 행)과 유형 칩·검색·정렬·새 항목이 있는 전체 항목 표 |
| `NotesDatabase` | 노트 목록의 표/목록 전환(계정별 기억), 열 머리 정렬(aria-sort), 서버 본문 검색, 맨 아래 빠른 새 노트 행 |
| `StatusBadge` | registry 기반 label·icon·tone 표시 |
| `UnifiedItemTypeBadge` | 통합 기록의 일정·노트·디깅·Q&A·과제 type icon·label |
| `UnifiedItemSpaceBadge` | 통합 기록의 학생 스페이스·포털 출처 label과 접근성 문맥 |
| `UnifiedItemDetailPanel` | 캘린더·일별·전체 보기의 공통 상세 패널, 변경 중 닫힘 잠금. 노트는 넓은 패널에서 수정 권한이 있으면 `NoteEditorForm`으로 바로 편집 |
| `CalendarEventFields` | 일정 생성 dialog와 상세 수정 form이 공유하는 유형·제목·시간·메모 입력 |
| `CalendarEventActions` | 학생 본인 포털 일정의 상세 패널 수정과 취소 우선 2단계 삭제 |
| `LessonScheduleDialog` | 관리자 일정 캘린더의 날짜 선택에서 시작하는 레슨 예약 |
| `ConfirmPanel`·`useConfirmAction` | 휴지통 이동·영구 삭제·이력 복원·댓글/피드백/모듈/레슨/트랙/컬럼/채널 삭제 등 되돌리기 어려운 동작의 공통 취소 우선 2단계 확인. hook이 확인 대상과 연 버튼으로의 초점 복귀를, 패널이 열릴 때 취소 초점·Esc 취소·확인 뒤 진행 문구·작업 종료 시 닫힘을 소유한다. 실패 안내는 호출 화면의 기존 오류 영역이 맡는다. 삭제·만료처럼 되돌릴 수 없으면 destructive, 이력이 남는 버전 복원은 neutral 톤을 쓴다 |
| `LessonActions` | 관리자 레슨 상세의 시간 변경과 취소 우선 2단계 삭제 |
| `AssignmentDeleteAction` | 피드백 전 학생 본인 제출의 취소 우선 2단계 삭제, 거부 사유를 확인 영역 안에서 표시 |
| `ExternalCalendarConnection` | 주소로 제공자를 판별하는 공개 레슨 캘린더 연결·교체·해제, 거부된 주소 유지와 live status |
| `PrivateNoteList` | 저장 HTML을 직접 렌더하지 않는 노트 메타데이터·평문 미리보기·열기 링크 목록 |
| `NoteFullForm` | 대상 학생 스페이스와 선택 날짜 문맥을 표시하는 전체 화면 노트 작성 폼 |
| `SectionHeader` | section 제목·설명·단일 보조 action |
| `EmptyState` | 비어 있는 이유와 가능한 다음 행동 |
| `FullEditor` | rich text·Markdown 작성, block command, inline 삽입, keyboard save 경계 |
| `BlockCommandMenu` | `/` 검색과 keyboard로 실행하는 block 삽입 목록 |
| `EditorInsertPanel` | 링크·이미지·YouTube URL을 검증하고 selection에 삽입하는 panel |
| `DraftStatus` | 로컬·계정 초안 저장 상태, 복구본과 다중 기기 충돌의 명시적 선택 |
| `ServerDraftStatus` | 오프라인 재시도·서버 저장 시각·다른 기기 비교·원문 복사·2단계 서버본 폐기 |
| `LocalDraftManager` | 현재 계정의 기기 초안 목록, 안전한 미리보기와 문서별·전체 2단계 폐기 |
| `AccountMenu` | 사이드바·메뉴 서랍 계정 줄의 … 메뉴. 메뉴 focus scope가 끝난 뒤 초안·비밀번호·계정 삭제 대화상자를 열고, 로그아웃은 로컬 초안을 먼저 정리한 뒤 세션을 종료한다 |
| `PasswordChangeControl` | 계정 메뉴의 본인 비밀번호 변경 dialog. 거부된 필드로 초점과 `aria-invalid`를 옮기고 성공 화면에는 입력값을 남기지 않으며 다음 행동 버튼으로 초점을 옮긴다. 같은 `PasswordChangeForm`의 `required` variant가 임시 비밀번호 로그인 뒤 `/account/password` 화면을 맡고, 저장되면 결과 버튼 없이 바로 포털로 이동한다 |
| `StudentPasswordResetControl` | 관리자 학생 상세 계정 영역의 임시 비밀번호 발급. 항상 취소 우선 확인을 거치고 원문은 발급 직후 한 번만 복사 버튼과 함께 보이며, 학생이 아직 바꾸지 않은 상태만 다시 알린다 |
| `StudentInviteControl` | 가입 전 학생의 가입 링크 재발급. 쓸 수 있는 링크가 남아 있으면 취소 우선 확인을 거치고, 만료된 링크는 바로 다시 발급한다 |
| `OneTimeSecret` | 발급 직후 한 번만 보이는 임시 비밀번호·가입 링크 표시와 복사. 자동 복사가 막히면 값을 직접 선택하라고 안내한다 |
| `InviteSignup` | `/invite`의 가입 화면. 링크 확인 중·사용 불가(잘못됨·만료·시도 한도)·비밀번호 설정 상태를 구분하고, 상태가 바뀌면 제목으로 초점을 옮긴다 |
| `CreationConflictActions` | 같은 생성 초안의 payload 충돌에서 기존 문서 열기와 별도 문서 분리 선택 |
| `RichTextContent` | 저장된 rich text의 공통 typography·embed 렌더 경계 |

공통 component를 우회해 같은 패턴을 다시 만들지 않는다. 의미나 책임이 다른 경우에는 억지로 variant에 합치지 않는다.

## 문서 작성 상호작용

- 에디터 placeholder에 노출한 command는 실제 keyboard 동작과 일치해야 한다.
- 제목·본문·첨부 등 문서를 구성하는 값은 하나의 draft payload로 저장하고 작성자·문서 ID로 격리한다.
- 각 작성 흐름은 canonical보다 먼저 raw 내용에 결합된 불변 shadow를 기록하고, 다음 안전본이 기록된 뒤 이전 자기 shadow를 정리한다. 다른 흐름과 충돌하면 현재 입력, 선택 복구본과 밀려난 canonical을 각각 보존한다.
- draft 저장 상태와 복원 여부를 에디터 아래에 보인다. 충돌 복구본은 전체 저장 시각, 길이가 제한된 제목·본문 미리보기, 현재 화면본 여부로 식별하고 사용자가 복원하거나 2단계 확인 뒤 삭제할 수 있게 한다. 저장소 오류가 나면 제출 잠금 여부와 모순되지 않는 복구 행동을 안내한다.
- 계정 초안은 사용자·문서별 최신본 하나를 30일 보존하고 이 기기 상태와 별도 줄로 표시한다. 오프라인 저장 의도는 연결 복구 뒤 같은 operation으로 재시도하며, 대기·동기화·성공은 live status, 오류는 복구 행동이 있는 alert로 알린다.
- 다른 기기 작성본과 현재 입력이 다르면 자동 병합하거나 덮어쓰지 않는다. 두 작성본의 안전한 평문 미리보기와 저장 기기를 구분하고, 계정 작성본 사용 또는 내 초안으로 계속을 native button으로 명시 선택하게 한다. 선택 전 추가 입력은 로컬에만 보존하고 서버 전송을 잠근다. 계정 원문 복사와 서버본 삭제를 제공하며 삭제는 취소에 먼저 focus하는 2단계 확인을 거친다.
- portal side rail에서 현재 계정의 기기 초안을 문서별로 확인하고 하나씩 또는 전체를 2단계 확인 뒤 폐기할 수 있게 한다. 이 목록은 제출 tombstone이 숨긴 ghost를 다시 노출하지 않으며, 미래·손상 표현은 내용을 잘못 해석하지 않고 폐기 가능 상태로만 표시한다.
- 로그아웃은 해당 계정의 로컬 canonical·recovery·future·legacy·marker와 메모리 pending을 먼저 지운 뒤 세션을 종료한다. 계정 전환 뒤 dashboard 진입에서는 현재 계정과 다른 owner namespace를 다시 정리한다.
- 제출 완료 tombstone은 문서·내용 서명별 entry를 복구본과 같은 30일 동안 개수 제한 없이 보존한다. 지연된 탭이 여러 번의 연속 제출 전 초안을 되살리지 않게 하되, 각 제출 뒤 새로 작성한 같은 내용은 지우지 않는다.
- 생성 form은 작업 nonce를 draft payload와 함께 저장하고 submit 직전에 같은 snapshot을 flush한다. 동일 작업의 다른 payload가 먼저 처리된 경우 현재 초안을 지우지 않고 기존 문서 열기 또는 별도 문서 분리를 명시적으로 선택하게 한다.
- 저장공간 오류가 재시도 뒤에도 계속되면 작성 흐름별 메모리 안전본을 유지하고 페이지 이탈 전에 경고한다. 저장소가 회복되면 더 최신인 안전본만 이어 쓰고 나머지는 복구 목록으로 옮긴다. 현재 입력이 없어도 page hide·flush에서 남은 안전본의 영속화를 다시 시도하며, 제출 완료 신호와 page-session cutoff는 열린 탭·재진입에 함께 적용한다. durable tombstone과 cutoff 정리가 확인되기 전에는 이탈 경고를 유지한다.
- `Cmd/Ctrl+S`는 브라우저 저장 dialog 대신 현재 form의 저장 의미를 실행한다. 새 게시물·Q&A 질문·답변에서는 로컬 초안만 즉시 저장하며 게시·등록은 명시적인 버튼으로 분리한다. 노트 저장과 기존 문서 편집에서는 검증을 거친 서버 저장을 실행한다.
- 저장 단축키는 editor뿐 아니라 같은 문서 form의 제목·날짜·첨부 입력에서도 동작해야 한다. 삽입 panel 안에서는 주소 적용과 문서 저장을 분리하고 Enter가 상위 form을 제출하지 않게 한다.
- editor는 매 입력마다 전체 HTML을 만들지 않는다. 입력 시 최신 reader를 draft pending에 연결하고, 화면 표시·초안 flush·submit 경계에서 revision당 한 번만 직렬화한다. 입력이 계속돼 trailing 저장이 미뤄져도 첫 pending 뒤 최대 5초에는 최신 snapshot을 checkpoint한다.
- slash command는 커서 앞의 제한된 검색어 범위만 읽어 긴 단일 문단에서도 입력 transaction 비용이 문단 전체 길이에 비례하지 않게 한다.
- draft hydration 전에는 form 입력을 비활성화해 초기 사용자 입력이 복원값으로 덮이지 않게 한다. 종료된 Q&A도 미전송 초안이 있으면 읽기 전용 상태로 본문과 복구 행동에 접근할 수 있어야 한다.
- 현재 앱이 해석할 수 없는 미래 version의 canonical draft는 수정·삭제하지 않는다. 현재 화면의 새 입력은 별도 복구본으로 격리하고, 최신 앱으로 다시 열기 전까지 서버 제출을 막는다.
- 첨부 업로드·제출 중에는 제목·분류·첨부 입력, editor command, inline menu, 삽입 panel, 저장 단축키, 상위 링크·취소 control과 panel 닫기가 내용을 바꾸거나 작업 화면을 해제하지 않아야 한다.
- 저장된 본문의 heading, list, task, quote, code, table, link, image와 허용된 embed는 편집 화면과 읽기 화면에서 같은 hierarchy를 유지한다.
- 편집 저장은 선행 변경을 조용히 덮지 않는다. 충돌을 감지하면 로컬 draft를 보존하고 서버 최신본 사용 또는 현재 초안 계속을 명시적으로 선택하게 한다.
- 문서 상세에서 변경 이력과 휴지통 이동은 현재 version을 기준으로 실행한다. 휴지통 문서는 읽기 전용으로 표시하고 기본 작성 control을 숨기거나 비활성화하며, 복원과 이력 조회를 다음 행동으로 제공한다.
- 영구 삭제는 관리자에게만 30일 만료 시각과 함께 노출하고 명시적인 확인을 요구한다. 이력 복원·휴지통 복원·영구 삭제의 성공 또는 충돌은 해당 control 가까이에서 live status나 alert로 알린다.

## 접근성

- 화면을 렌더하는 route는 page 또는 segment layout의 `metadata`로 고유한 제목을 둔다. 브라우저 탭과 보조기기가 화면을 구분하며 `npm run check:ui`가 누락을 거부한다.
- native button, link, input을 우선한다.
- icon-only button은 `aria-label` 또는 보이는 label을 가진다.
- portal navigation의 현재 section은 `aria-current="page"`로 전달한다.
- 모든 form control은 placeholder가 아닌 별도 label을 가진다.
- 오류는 문제가 발생한 영역 안에서 설명하고, 일시적 상태 변화는 live region으로 알린다.
- 클릭 가능한 행은 Tab과 Enter 또는 Space로 동작해야 한다.
- 통합 기록 행의 accessible name은 제목·유형·시각과 필요한 경우 학생 스페이스·외부 출처를 함께 읽는다. 좁은 화면에서는 배지와 시각을 제목 아래 줄로 내려 제목을 보존한다.
- 토글 버튼은 상태를 `aria-pressed`로 전달하고 이름에는 행동이 아니라 대상(예: "비트 매칭 완료")을 쓴다.
- focus indicator를 제거하지 않으며 foreground와 focus ring은 배경에 충분한 대비를 유지한다.

## 반응형

- 768px 미만에서는 다단 콘텐츠를 한 열로 접는다.
- 전체 화면 route는 `mx-auto max-w-* px-4 sm:px-6` gutter를 사용해 좁은 화면에서도 side rail이나 화면 끝에 붙지 않는다.
- 독립 route(`/community` 등)는 모바일에서도 포털 복귀·휴지통 같은 상위 이동 경로를 숨기지 않는다.
- portal navigation은 한 줄을 유지하고 필요한 경우 가로 스크롤한다.
- 넓은 표는 mobile에서 핵심 label-value list로 대체한다.
- CTA 문구는 desktop에서 줄바꿈되지 않게 짧고 구체적으로 작성한다.
- 문서 페이지는 `100dvh` 기반 최소 높이를 사용한다. 포털 shell은 `100dvh` 안에 navigation과 스크롤 영역을 두고, 캘린더는 헤더를 제외한 남은 공간을 사용한다.
- 공개 캘린더 연결 설정은 접힌 disclosure 안에 둔다. 관리자 학생 선택은 가로 스크롤하는 뷰 탭과 분리해 학생 문맥 옆에 표시한다.

## 상태 완결성 점검

새 데이터 영역은 다음을 함께 구현한다.

1. 최종 모양을 반영한 loading 상태
2. 비어 있는 이유와 가능한 다음 행동
3. 맥락 안의 error와 재시도 경로
4. pending control의 disabled와 진행 문구
5. 성공 결과의 즉시 반영과 필요한 상태 안내

대시보드 route는 최종 화면 구조를 닮은 `loading.tsx` skeleton과 맥락 안에서 재시도하는 `error.tsx`를 공통 fallback으로 사용한다. 그 밖의 route(로그인 등)는 앱 루트 `error.tsx`가, root layout 자체의 실패는 `global-error.tsx`가 같은 한국어 재시도 화면으로 받는다.

## 변경 점검

- 임의 hex와 raw red, green, blue, orange 계열 status class가 새로 추가되지 않았는가
- 되돌리기 어려운 동작이 브라우저 기본 `confirm`·`alert`·`prompt` 대신 화면 안의 `ConfirmPanel`을 쓰는가. `npm run check:ui`가 기본 대화상자 호출을 거부한다.
- 색 utility가 `globals.css`에 정의된 token만 참조하는가. Tailwind 4는 없는 token의 class를 조용히 버리므로 `*-foreground` 누락은 `npm run check:ui`가 거부한다.
- 한 화면의 주요 accent가 하나로 유지되는가
- radius가 control, container, overlay 규칙을 따르는가
- button·input·focus·placeholder 대비가 충분한가
- keyboard, mobile 1열, empty·loading·error 상태가 있는가
- 실제 데이터가 없는 상태를 추정한 문구가 없는가
- 보이는 문구가 짧고 구체적인 한국어로 통일되었는가
- 날짜·시각을 `src/lib/kst-format.ts`의 `formatKst`·`formatKstShortDate`로만 표시하는가. Worker SSR은 UTC로 실행되므로 `toLocale*String`·`Intl.DateTimeFormat`·`date-fns` 직접 호출은 `npm run check:ui`가 거부한다.
