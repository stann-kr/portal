# 요구사항

## 목적

`portal`은 DJ lesson 운영자가 학생별 학습 흐름, 과제, 피드백, 커뮤니케이션, 캘린더, 자료를 한 곳에서 관리할 수 있게 하는 lesson portal이다.

## 범위

포함 범위:

- credentials login과 role 기반 dashboard redirect
- student dashboard와 admin dashboard
- 학생 관리, 과제, 커리큘럼, private notes, digging board
- Q&A board와 community board
- calendar feed와 personal calendar event
- media upload를 위한 R2/presigned URL 구조
- Cloudflare D1/R2/OpenNext 배포 구조

제외 범위:

- 결제/정산 시스템
- 영상 스트리밍 플랫폼 자체 구현
- public marketing site 기능
- private audit/phase log의 public docs 노출

## 사용자와 역할

| 역할 | 설명 | 주요 행동 |
|---|---|---|
| student | 수강생 | 과제, 커리큘럼, 노트, Q&A, 커뮤니티 확인 |
| admin | 레슨 운영자 | 학생/콘텐츠/과제/피드백/캘린더 관리 |
| developer | 앱 유지보수자 | schema, action, auth, Cloudflare deployment 관리 |

## 기능 요구사항

| ID | 요구사항 | 검증 기준 |
|---|---|---|
| FR-001 | 로그인한 사용자는 role에 따라 admin 또는 student dashboard로 이동해야 한다. | root route가 `session.user.role` 기준으로 redirect한다. |
| FR-002 | admin은 학생 목록과 개별 학생 상세를 관리할 수 있어야 한다. | `/dashboard/admin`, `/dashboard/admin/students/[id]` route가 존재한다. |
| FR-003 | student는 과제, 커리큘럼, 노트, digging 자료를 확인할 수 있어야 한다. | `/dashboard/student/**` route가 존재한다. |
| FR-004 | Q&A와 community board는 작성/상세/목록 flow를 제공해야 한다. | `/dashboard/qna/**`, `/community/**` route가 존재한다. |
| FR-005 | calendar feed는 학생별 calendar route로 제공되어야 한다. | `src/app/api/calendar/[studentId]/route.ts`가 존재한다. |
| FR-006 | rich text와 media workflow는 sanitizer와 upload action을 통해 보호되어야 한다. | `sanitize-html`, upload/r2 action이 존재한다. |

## 비기능 요구사항

| ID | 요구사항 | 검증 기준 |
|---|---|---|
| NFR-001 | D1 migration을 local/remote에 적용할 수 있어야 한다. | `npm run db:migrate`, `npm run db:migrate:remote`가 존재한다. |
| NFR-002 | Cloudflare worker build가 가능해야 한다. | `npm run build:worker`가 존재한다. |
| NFR-003 | lint는 src와 eslint config를 대상으로 실행되어야 한다. | `npm run lint`가 존재한다. |
| NFR-004 | public docs에는 private audit/phase log와 작업 도구 흔적이 없어야 한다. | residue scan이 0건이다. |

## 미해결 질문

- production 배포 전 필수 smoke test 계정과 test data set.
- admin 권한 정책과 student data isolation의 최종 운영 문서화 범위.
- R2 media retention/cleanup 정책.
