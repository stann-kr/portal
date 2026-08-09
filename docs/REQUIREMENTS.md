# 요구사항

## 목적

`portal`은 DJ 레슨 운영자가 학생별 학습 흐름과 피드백을 관리하고, 학생이 레슨 준비·과제·연습 기록·질문을 한 공간에서 이어갈 수 있게 하는 운영 포털이다.

## 범위

포함 범위:

- credentials 로그인과 student/admin 역할 기반 접근 제어
- 학생·관리자 대시보드
- 학생 관리, 커리큘럼, 과제 제출, 타임라인 피드백
- 개인 일정, 노트, 디깅 기록을 묶는 통합 캘린더
- 공지사항, 커뮤니티, 1:1 Q&A
- 캘린더 구독 피드
- R2 presigned URL 기반 미디어 업로드
- 학생 본인 계정 삭제와 다른 기기의 잔여 초안 정리
- Cloudflare D1/R2/OpenNext 배포 구조

제외 범위:

- 결제·정산
- 영상·오디오 스트리밍 플랫폼 자체 구현
- 공개 마케팅 사이트
- 다중 조직·강사 tenant 운영

## 사용자와 역할

| 역할 | 설명 | 주요 행동 |
|---|---|---|
| student | DJ 레슨 수강생 | 일정·커리큘럼 확인, 과제 제출, 노트·디깅 기록, 질문·커뮤니티 참여 |
| admin | 레슨 운영자 | 학생·콘텐츠·일정·과제·피드백·공지 관리 |

## 기능 요구사항

상태는 실제 소스와 자동 검증 수준을 함께 반영한다. `구현`은 현재 동작이 존재함을,
`부분 구현`·`부분 충족`은 동작 또는 자동 검증·상태 처리가 더 필요함을 뜻한다.

| ID | 요구사항 | 검증 기준 | 현재 상태 |
|---|---|---|---|
| FR-001 | 사용자는 credentials로 로그인하고 역할에 맞는 포털로 이동해야 한다. | 비로그인 사용자는 로그인으로 이동하고 student/admin은 서로의 시작 화면에 진입하지 못한다. | 구현 |
| FR-002 | 학생은 오늘, 워크스페이스, 커뮤니티를 하나의 포털 셸에서 전환해야 한다. | 오늘 화면이 다음 일정·피드백·Q&A·최근 공지를 요약하고, 세 섹션의 선택 상태가 유지된다. | 구현 |
| FR-003 | 학생의 일정·노트·디깅·Q&A·과제는 통합된 학습 기록으로 탐색할 수 있어야 한다. | 캘린더, 일별 목록, 전체 목록에서 유형 필터와 상세 진입을 제공한다. | 구현 |
| FR-004 | 학생은 커리큘럼 진도를 확인하고 믹스셋 과제를 제출하며 피드백을 재생 위치와 함께 확인해야 한다. | 완료 토글, 과제 URL 제출, 미디어 재생, 피드백 목록이 동작한다. | 구현 |
| FR-005 | 관리자는 업무함에서 미답변 Q&A, 피드백 대기, 다가오는 레슨을 처리하고 학생별 학습 상태를 관리해야 한다. | 실제 처리 항목을 우선순위대로 제공하고 Q&A·과제 상세, 학생 목록·상세·추가 경로로 연결한다. | 구현 |
| FR-006 | 공지·커뮤니티·1:1 Q&A는 작성, 목록, 상세, 답변 또는 댓글 흐름을 제공해야 한다. | 역할별 작성 권한과 소유권 검사를 서버에서 수행하고 성공·실패 상태를 반환한다. | 구현 |
| FR-007 | 캘린더 피드는 본인·관리자 세션 또는 유효한 opaque token으로만 접근할 수 있어야 한다. | 신규 구독 URL에는 계정 ID를 노출하지 않고, 허용 요청만 `.ics`를 반환하며 token 회전 뒤 이전 URL을 거부한다. | 구현 |
| FR-008 | 미디어 업로드는 서버가 발급한 제한 시간 presigned URL을 사용해야 한다. | 인증된 요청만 URL을 발급하고 허용하지 않은 파일 정책은 서버에서 거부한다. | 부분 구현 |
| FR-009 | 개인 노트는 수정 이력과 휴지통을 제공하고, 재전송·동시 편집·영구 삭제 뒤 늦은 요청에도 일관된 상태를 유지해야 한다. | version 기반 조건부 저장, 불변 revision·operation ledger, 30일 휴지통, 복원·관리자 purge, tombstone 부활 방지를 격리 D1에서 검증한다. | 구현 |
| FR-010 | 커뮤니티 게시물과 1:1 Q&A는 내용·상태 이력과 휴지통을 제공하고, 댓글·답변을 보존한 채 복원할 수 있어야 한다. | 게시물 full-snapshot revision, Q&A append-only event, version 기반 조건부 변경, 30일 휴지통, 관리자 purge와 tombstone 부활 방지를 격리 D1에서 검증한다. | 구현 |
| FR-011 | 학생은 현재 비밀번호와 명시적 확인을 거쳐 본인 계정을 삭제할 수 있어야 한다. | profile·credential·문서 원문·서버 초안을 한 transaction에서 제거하고 기존 session을 즉시 거부한다. 현재 기기는 terminal lock 뒤 직접 정리하고, 사전 등록된 다른 기기만 재접속 때 해당 계정의 로컬 데이터를 정리하며, 저장소 차단 시 수동 정리를 안내한다. | 구현 — production migration·주기 정리 runner 미적용 |

## 비기능 요구사항

| ID | 요구사항 | 검증 기준 | 현재 상태 |
|---|---|---|---|
| NFR-001 | 모든 server action은 인증·역할·소유권 경계를 자체적으로 검증해야 한다. | 매 server 인증 경계에서 profile 존재와 DB role을 다시 확인하고, 허용·거부 경로를 자동 테스트하며 타 학생 데이터 접근을 차단한다. | 부분 충족 |
| NFR-002 | 사용자 입력과 rich text는 저장·렌더 경계에서 안전하게 처리해야 한다. | sanitize, protocol·host allowlist, 파일 크기·MIME 정책을 자동 테스트한다. | 부분 충족 — HTML sanitize 자동화 |
| NFR-003 | 핵심 흐름은 키보드만으로 조작 가능하고 명확한 focus·상태 정보를 제공해야 한다. | semantic control, focus indicator, label, reduced-motion 대응이 정적·컴포넌트 테스트를 통과한다. | 부분 충족 |
| NFR-004 | 360px 이상의 화면에서 주요 탐색과 작성 흐름이 가로 잘림 없이 동작해야 한다. | 탭·테이블·캘린더에 좁은 화면용 layout 또는 overflow 전략이 있다. | 부분 충족 |
| NFR-005 | 변경은 lint, typecheck, build와 핵심 회귀 테스트를 통과해야 한다. | `npm run lint`, `npx tsc --noEmit`, `npm run build`, unit/integration test가 성공한다. | 부분 충족 |
| NFR-006 | D1 migration과 Cloudflare Worker build는 재현 가능해야 한다. | `npm run db:check`가 SQL·journal·snapshot·현재 schema, CHECK·trigger, 기존 schema upgrade를 확인하고 local/remote 적용 이력이 정합하며 `npm run build:worker`가 성공한다. | 부분 충족 |
| NFR-007 | 로딩·빈 상태·오류·성공 피드백은 사용자가 다음 행동을 알 수 있게 해야 한다. | route와 주요 mutation마다 상태 UI와 복구 행동을 제공한다. | 부분 충족 — 대시보드·과제·Q&A 보강 |
| NFR-008 | 문서 작성은 새로고침·화면 이동·일시적 저장 실패 뒤에도 이어갈 수 있어야 한다. | 노트·게시물·Q&A의 사용자·문서별 로컬·서버 초안, 식별 가능한 복구본, 미래 version 제출 잠금, 안정 URL, 최대 5초 checkpoint, 오프라인 재시도, version 충돌 감지와 명시적 작성본 선택이 동작한다. | 부분 충족 — 로컬 복구·계정 경계, 사용자·문서별 30일 서버 최신본, CAS·재전송 receipt, 오프라인 queue·다중 기기 비교와 서버 revision·휴지통 구현. 실제 브라우저·강제 종료 E2E 미검증 |
| NFR-009 | 운영 데이터는 검증 가능한 백업과 복구 절차를 가져야 한다. | D1 export의 무결성을 확인하고 격리 환경 복구 rehearsal을 정기적으로 수행하며 결과를 기록한다. | 부분 충족 — 절차 문서화, 원격 rehearsal 미실행 |

## 문서 수명주기와 개인정보 정책

| 항목 | 확정 정책 | 현재 적용 상태 |
|---|---|---|
| revision 보존 | 개인 노트와 게시물의 full-snapshot revision은 문서가 active이거나 휴지통에 있는 동안 모두 보존한다. Q&A는 질문 상태·삭제 상태의 불변 event와 답변을 보존한다. 과거 이력을 개별 삭제·수정하지 않으며 영구 삭제 또는 승인된 계정 삭제 때 본문과 함께 제거한다. | 개인 노트·게시물·Q&A 적용 |
| 휴지통 | 삭제 시점부터 30일 동안 복원할 수 있다. 30일이 지나도 자동 삭제하지 않으며 관리자만 명시적으로 영구 삭제할 수 있다. 게시물 댓글과 Q&A 답변은 휴지통 이동·복원 동안 함께 보존한다. 복원 후 다시 삭제하면 새 삭제 시각부터 계산한다. | 개인 노트·게시물·Q&A 적용 |
| 영구 삭제 | 관리자, 30일 만료, 현재 version 일치를 모두 요구한다. head와 revision·event·하위 댓글 또는 답변을 제거하고 최소 operation ledger와 tombstone을 남겨 늦은 요청의 부활을 막는다. | 개인 노트·게시물·Q&A 적용 |
| 문서 최대 크기 | sanitize가 끝난 개인 노트 HTML 본문은 800 KiB, 제목은 200자까지 허용한다. Server Action 기본 body에 action/form envelope 여유를 남긴 값이다. 초과 요청은 head·revision·receipt를 쓰지 않고 로컬 초안을 유지한다. | 개인 노트 적용 |
| 사용자 저장공간 | 사용자별 active/trash head와 내용 변경 revision을 합쳐 100 MiB를 허용한다. `TRASH`·`RESTORE_TRASH` 상태 snapshot은 사용자 quota에서 제외하되 실제 DB 사용량에는 포함해 별도 관측한다. 한도 초과 시 내용 저장·과거 revision 복원을 막고 휴지통 이동·영구 삭제는 허용한다. | 개인 노트 적용, 운영 경보 미구현 |
| 서버 초안 | 사용자·문서별 최신 서버 초안은 마지막 저장 뒤 30일 보존한다. 게시 완료와 명시적 폐기는 즉시 삭제를 요청하고 실패 시 같은 operation으로 재시도하며, profile 삭제는 payload와 receipt를 cascade한다. | 노트·게시물·Q&A 작성·편집 적용 |
| 충돌 처리 | revision/version 기반 충돌을 감지하며 자동 병합하지 않는다. 현재 초안은 유지하고 서버 최신본을 확인·복사한 뒤 서버본 사용 또는 내 초안으로 계속을 명시적으로 선택한다. | 문서 저장 충돌과 다중 기기 서버 초안 비교 적용 |
| 로그아웃·계정 전환 | 해당 계정의 canonical·recovery·future·legacy 로컬 초안과 서버 재시도 queue를 즉시 지운다. 삭제 신호를 사전 등록한 오프라인 기기는 익명 상태 동기화 뒤 해당 owner 데이터만 정리한다. | 로그아웃·계정 전환·삭제 신호 정리 적용 |
| 계정 삭제 | 학생 본인, 현재 비밀번호, persistent 또는 memory-only 기기 digest와 단일 operation을 요구한다. persistent token은 모두 deletion job에 결합하고 memory-only digest는 token quota와 분리된 initiating receipt로 같은 transaction에 기록하며, 실패하면 job과 함께 rollback한다. profile·credential·문서 본문·revision·event·서버 초안은 즉시 제거하고 managed media는 durable outbox로 삭제한다. anti-replay용 raw 계정 식별자는 30일 보존 경계 뒤 alias 수렴 대상이 된다. | 전용 삭제·현재 기기 직접 정리·30일 alias source 구현, production migration·scheduler 미적용 |

## 향후 결정 사항

- 과제 배정·마감일·읽음 상태를 추가해 학생 `오늘`을 실제 할 일과 새 응답 중심으로 확장할지.
- 디깅 보드와 과제 피드백을 장기적으로 오디오 파형 기반 작업 공간까지 확장할지.
- 알림 채널을 앱 내부, 이메일, 캘린더 중 어디까지 지원할지.
- production smoke test 계정·fixture와 게시물·계정 영구 삭제 뒤 R2 media retention·고아 객체 정리를 어떻게 운영할지.
- media deletion outbox와 30일 raw-ID erasure를 실행할 production scheduler·backlog 경보 주기와 책임자를 확정할지.
