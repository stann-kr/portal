# 디자인 시스템

## 목적

포털의 시각 언어와 상호작용 상태를 일관되게 유지하기 위한 구현 기준이다. 학생과 관리자가 장시간 읽고 기록하는 제품 특성에 맞춰 장식보다 정보 우선순위, 상태 피드백, 키보드 접근성을 우선한다.

## 설계 방향

`quiet studio console`을 기본 방향으로 사용한다.

- 따뜻한 graphite 계열 중립색 위에 copper 한 가지를 주요 행동 강조색으로 사용한다.
- success, warning, destructive, info는 의미 전달에만 사용한다.
- 모든 내용을 card로 감싸지 않고 section, list row, inset panel, overlay를 역할별로 구분한다.
- 학생과 관리자의 첫 화면은 다음 행동과 그 근거가 되는 시간·상태를 먼저 보여준다.
- 애니메이션은 hierarchy, feedback, state transition을 설명할 때만 사용한다.

## Token

Token은 `src/app/globals.css`의 Tailwind theme layer에 정의한다. 화면 구현에서는 가능한 한 아래 semantic 이름을 사용하고 임의 hex 또는 원색 utility를 추가하지 않는다.

### Color

| 역할 | Token | 용도 |
|---|---|---|
| Canvas | `background`, `canvas` | 앱 전체 배경 |
| Surface | `surface`, `surface-elevated`, `card` | 기본 내용·떠 있는 면 |
| Text | `foreground`, `muted-foreground` | 기본·보조 텍스트 |
| Structure | `border`, `input`, `ring` | 경계·입력·focus |
| Action | `primary`, `primary-foreground`, `accent`, `accent-foreground` | 주요 행동·선택 상태 |
| Semantic | `success`, `warning`, `destructive`, `info`와 각 `*-muted` | 완료·대기·오류·정보 |

운영체제의 `prefers-color-scheme`에 따라 같은 semantic token의 dark 값이 적용된다. 개별 section이 임의로 theme를 반전하지 않는다.

### Shape

| 역할 | Radius |
|---|---|
| 작은 label·보조 control | `sm`, 6px |
| button·input·일반 control | `md`, 8px |
| section container·inset panel | `lg`, 12px |
| dialog·sheet·overlay | `xl`, 16px |

pill 형태는 filter와 count처럼 모양 자체가 의미를 가질 때만 사용한다.

### Elevation

- 기본 surface는 border 또는 여백으로 구분한다.
- dropdown에는 `shadow-floating`, dialog·sheet에는 `shadow-overlay`를 사용한다.
- 정보 그룹을 구분하기 위한 일반 card에는 shadow를 사용하지 않는다.

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
| `StatusBadge` | registry 기반 label·icon·tone 표시 |
| `UnifiedItemTypeBadge` | 통합 기록의 일정·노트·디깅·Q&A·과제 type icon·label |
| `UnifiedItemSpaceBadge` | 통합 기록의 학생 스페이스·포털 출처 label과 접근성 문맥 |
| `UnifiedItemDetailPanel` | 캘린더·일별·전체 보기의 공통 상세 패널, 변경 중 닫힘 잠금 |
| `CalendarEventFields` | 일정 생성 dialog와 상세 수정 form이 공유하는 유형·제목·시간·메모 입력 |
| `CalendarEventActions` | 학생 본인 포털 일정의 상세 패널 수정과 취소 우선 2단계 삭제 |
| `ExternalCalendarConnection` | 공개 레슨 캘린더 provider 선택·연결·교체·해제와 live status |
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
| `AccountLogoutButton` | 로컬 초안을 먼저 정리하고 인증 세션을 종료하는 공통 로그아웃 control |
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

- native button, link, input을 우선한다.
- icon-only button은 `aria-label` 또는 보이는 label을 가진다.
- portal navigation의 현재 section은 `aria-current="page"`로 전달한다.
- 모든 form control은 placeholder가 아닌 별도 label을 가진다.
- 오류는 문제가 발생한 영역 안에서 설명하고, 일시적 상태 변화는 live region으로 알린다.
- 클릭 가능한 행은 Tab과 Enter 또는 Space로 동작해야 한다.
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

대시보드 route는 최종 화면 구조를 닮은 `loading.tsx` skeleton과 맥락 안에서 재시도하는 `error.tsx`를 공통 fallback으로 사용한다.

## 변경 점검

- 임의 hex와 raw red, green, blue, orange 계열 status class가 새로 추가되지 않았는가
- 한 화면의 주요 accent가 하나로 유지되는가
- radius가 control, container, overlay 규칙을 따르는가
- button·input·focus·placeholder 대비가 충분한가
- keyboard, mobile 1열, empty·loading·error 상태가 있는가
- 실제 데이터가 없는 상태를 추정한 문구가 없는가
- 보이는 문구가 짧고 구체적인 한국어로 통일되었는가
- 날짜·시각을 `src/lib/kst-format.ts`의 `formatKst`·`formatKstShortDate`로만 표시하는가. Worker SSR은 UTC로 실행되므로 `toLocale*String`·`Intl.DateTimeFormat`·`date-fns` 직접 호출은 `npm run check:ui`가 거부한다.
