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
| `PortalShell` | 역할별 navigation, section 상태 복원, 공통 content frame |
| `StatusBadge` | registry 기반 label·icon·tone 표시 |
| `SectionHeader` | section 제목·설명·단일 보조 action |
| `EmptyState` | 비어 있는 이유와 가능한 다음 행동 |

공통 component를 우회해 같은 패턴을 다시 만들지 않는다. 의미나 책임이 다른 경우에는 억지로 variant에 합치지 않는다.

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
- portal navigation은 한 줄을 유지하고 필요한 경우 가로 스크롤한다.
- 넓은 표는 mobile에서 핵심 label-value list로 대체한다.
- CTA 문구는 desktop에서 줄바꿈되지 않게 짧고 구체적으로 작성한다.
- 전체 높이는 `100dvh` 기반 최소 높이를 사용한다.

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
