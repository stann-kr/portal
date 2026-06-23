# WORK_LOG

## 2026-06-20 07:26 KST — Hermes + Claude Opus portal investigation / implementation

Summary
- Claude Opus 기반 리뷰와 로컬 정적/빌드 검증을 바탕으로 portal 프로젝트의 현재 구현 상태와 주요 위험 지점을 점검했다.
- 이번 라운드에서는 전체 lint 체인을 복구하고, auth/QnA/digging/unifiedItems 영역의 보안/성능 이슈를 실제 코드로 수정했다.
- 이후 4시간 간격으로 자동 재개되는 Hermes cron job을 설정해 주간 세션 초기화 전까지 작업을 이어가도록 했다.

Implemented changes
- eslint.config.mjs
  - FlatCompat 기반으로 Next ESLint flat config를 정상 로드하도록 수정.
- package.json
  - `lint` 스크립트를 `eslint src eslint.config.mjs`로 조정해 OOM 없이 실제 lint 결과를 보게 함.
- src/auth.ts
  - authorize 과정의 과도한 debug logging 제거.
- src/lib/actions/qna.ts
  - Q&A thread/reply 생성 시 서버 측 DOMPurify sanitization 추가.
- src/lib/actions/digging.ts
  - `getOrSeedColumns(userId)`, `getDiggingTracks(userId)`에 auth/ownership 검사 추가.
  - `fetchLinkMeta(url)`에 인증 강제, protocol 제한(http/https), 허용 호스트 allowlist 추가.
- src/lib/actions/unifiedItems.ts
  - feedback 카운트 조회를 현재 학생의 assignment ID 범위로 한정.

Verification
- changed-file eslint:
  - `./node_modules/.bin/eslint src/auth.ts src/lib/actions/qna.ts src/lib/actions/digging.ts src/lib/actions/unifiedItems.ts eslint.config.mjs`
  - exit 0
- typecheck:
  - `npx tsc --noEmit`
  - exit 0
- production build:
  - `npm run build`
  - exit 0
- full lint:
  - `npm run lint`
  - exit 1
  - 현재는 OOM이 아니라 실제 repo-wide lint debt가 노출됨 (23 errors, 1 warning)
- runtime dependency audit:
  - `npm audit --omit=dev --audit-level=moderate`
  - exit 1
  - 주요 항목: drizzle-orm, dompurify, next/postcss, undici, qs, markdown-it, fast-xml-parser 계열

Current findings
- 구현 상태 자체는 빌드/타입체크 기준으로 동작 가능 상태다.
- 기존 lint 실패는 “설정/메모리 문제”와 “실제 코드 부채”가 섞여 있었는데, 이번 작업으로 설정/메모리 문제를 분리했고 실제 코드 부채 목록이 드러났다.
- 보안상 우선순위 높은 지점은 다음 두 축이다:
  1. server action의 auth/ownership 일관성
  2. rich text / external URL 입력 처리의 sanitize/allowlist 일관성
- Claude Opus follow-up review 결과, 지금 가장 ROI가 높은 다음 단계는:
  1. runtime audit 취약점 중 non-breaking 업그레이드 우선 처리 (특히 dompurify, next 관련, undici)
  2. `src/lib/actions/*` 전체에 row-level authz 패턴 점검 확대
  3. sanitize/allowlist 로직 공통 util화

Automation
- Hermes cron job created:
  - job_id: `4ea5759825aa`
  - name: `portal-opus-continue-until-weekly-reset`
  - schedule: every 4h, repeat 3
  - next run: 2026-06-20 11:26:25 KST
- 각 실행은 `/Users/stann/Dev/portal`에서 진행되며, Claude CLI `--model opus` 사용을 강제하도록 프롬프트에 명시했다.

Next recommended actions
1. repo-wide lint debt를 코히어런트한 묶음으로 정리
2. audit non-breaking fixes부터 적용 후 build/typecheck/lint 재검증
3. sanitize/authz 공통 helper 도입으로 패턴 중앙화

## 2026-06-20 07:45 KST — hardening + audit remediation follow-up

Summary
- Claude Opus follow-up 권고(B)를 따라 sanitize/authz 패턴을 공통 helper로 중앙화했다.
- posts 액션의 저장형 XSS 취약점을 실제로 차단했고, assignments/digging/privateNotes/posts의 ownership 검사 코드를 공통 guard로 정리했다.
- non-breaking `npm audit fix`를 적용한 뒤 Next를 15.5.19로 상향해 남은 런타임 취약점을 크게 줄였다.

Implemented changes
- src/lib/sanitize-html.ts
  - 서버 액션에서 재사용하는 `sanitizeHtml()` helper 추가.
- src/lib/auth-guard.ts
  - `AuthSession` export, `assertOwnerOrAdmin()` helper 추가.
- src/lib/actions/posts.ts
  - community post 생성 시 서버측 sanitize 적용.
  - delete 권한 검사를 row fetch + `assertOwnerOrAdmin()`으로 정리.
  - category 입력을 runtime allowlist로 검증.
- src/lib/actions/qna.ts / privateNotes.ts
  - DOMPurify 직접 호출 대신 공통 `sanitizeHtml()` 사용.
- src/lib/actions/assignments.ts / digging.ts / privateNotes.ts
  - 반복되던 ownership/admin 검사 로직을 공통 helper로 치환.
- package-lock.json
  - `npm audit fix`로 transitive/runtime deps 대거 업데이트.
- package.json
  - `next`, `eslint-config-next`를 15.5.19로 상향.

Verification
- after helper extraction:
  - `npm run lint` → exit 0
  - `npx tsc --noEmit` → exit 0
  - `npm run build` → exit 0
- after `npm audit fix` + Next upgrade to 15.5.19:
  - `npm run lint` → exit 0
  - `npx tsc --noEmit` → exit 0
  - `npm run build` → exit 0 (Edge-runtime warning 2건: jose/next-auth의 CompressionStream/DecompressionStream 경고)
  - `npm audit --omit=dev --audit-level=moderate` → exit 1
    - 남은 항목: next 내부 `postcss` advisory 2 moderate only

Current findings
- repo 전체 lint/typecheck/build는 현재 모두 통과한다.
- 저장형 HTML 입력 경로 중 posts가 빠져 있었는데, 이번에 서버측 sanitize를 추가해 실제 취약 경로를 닫았다.
- 남은 audit 이슈는 사실상 Next 내부 postcss advisory 1종이며, npm 출력상 자동 fix는 breaking downgrade/force 경로만 제안한다.
- Next 15.5.19 빌드는 성공하지만 jose/next-auth 관련 Edge Runtime warning이 새로 보이므로, 다음 라운드에서는 middleware/runtime 경계를 점검해 warning 원인 격리를 검토할 가치가 있다.

## 2026-06-20 08:00 KST — 추가 기능/버그 수정 라운드

Summary
- 사용자의 요청대로 세션을 더 활용해 저위험 기능 개선과 실제 사용자 플로우 버그 수정을 계속 진행했다.
- Q&A 목록에 상태 필터 탭을 추가했고, 학생 포털 커뮤니티 작성/댓글 표시 플로우의 실제 버그 2건을 수정했다.

Implemented changes
- src/lib/qna-status.ts
  - Q&A 상태 라벨/색상/필터 탭 정의를 공통 상수로 분리.
- src/components/qna/ThreadList.tsx
  - 클라이언트 상태 필터(전체/미답변/답변완료/종료) 추가.
  - 상태별 개수 표시와 빈 필터 결과 empty state 추가.
- src/components/qna/ThreadDetailClient.tsx
  - 상태 라벨을 공통 상수 사용으로 정리.
- src/components/student-portal/CommunitySection.tsx
  - 학생 포털의 간이 커뮤니티 작성 다이얼로그가 `contentHtml` 대신 `content`를 보내던 버그 수정.
  - 이 버그는 기존 createPost 서버 액션과 필드명이 어긋나 실제 작성이 막히는 문제였다.
- src/components/student-portal/PostDetailPanel.tsx
  - 슬라이드 패널 댓글이 HTML 문자열을 그대로 텍스트 출력하던 문제를 수정해 실제 서식대로 렌더링.

Verification
- feature round validation:
  - `npm run lint` → exit 0
  - `npx tsc --noEmit` → exit 0
  - `npm run build` → exit 0
- Opus spot-check:
  - CommunitySection 작성 폼의 `name="content"` vs `createPost(formData.get("contentHtml"))` 불일치를 실제 blocker bug로 재확인함.

Current findings
- Q&A 목록은 이제 fetched data만으로 즉시 상태 필터링 가능해져, 미답변 스레드 triage가 쉬워졌다.
- 학생 포털 커뮤니티 작성 다이얼로그는 이전에는 사실상 실패 경로였고, 지금은 서버 액션 계약에 맞춰 동작 가능 상태다.
- 댓글 슬라이드 패널도 이제 DB에 저장된 HTML 포맷을 detail page와 일관되게 표시한다.

## 2026-06-20 08:15 KST — Q&A 권한 보강 라운드

Summary
- Q&A 서버 액션을 다시 점검해 학생이 다른 학생의 스레드에 reply를 주입할 수 있는 IDOR/RBAC 누락을 찾아 수정했다.
- 문서상 학생 전용인 스레드 생성 액션도 어드민 호출을 막도록 일치시켰다.

Implemented changes
- src/lib/actions/qna.ts
  - `getQnaThreadOwner(threadId)` helper 추가.
  - `createQnaReply()`에서 스레드 존재 여부 및 비어드민 호출자의 ownership 검증 추가.
  - 타인 스레드 또는 없는 스레드에 대한 reply 작성 시 오류 반환.
  - `createQnaThread()` / `createQnaThreadInline()`에 학생 전용 guard 추가.

Why this mattered
- 기존에는 `getQnaThread()` 읽기 경로는 본인 스레드만 보게 막고 있었지만, `createQnaReply()` 쓰기 경로는 `threadId`만 알면 reply insert와 상태 변경이 가능했다.
- 그 결과 학생이 다른 학생의 private Q&A 스레드를 임의로 재오픈하거나 내용 주입할 수 있는 권한 우회가 가능했다.

Verification
- `npm run lint` → exit 0
- `npx tsc --noEmit` → exit 0
- `npm run build` → exit 0

## 2026-06-20 15:32 KST — Claude Opus 리뷰 기반 댓글 XSS 차단

Summary
- 현재 워킹트리를 Claude Opus(`--model opus`)로 재검토해, 가장 가치 높은 안전한 후속 수정으로 커뮤니티 댓글 경로의 저장형 XSS를 식별했다.
- Hermes는 그 권고를 실제 코드에 반영해 plain-text 댓글을 HTML escape 후 저장하도록 수정했고, lint/typecheck/build 재검증까지 완료했다.

Claude Opus findings
- `src/lib/actions/comments.ts`의 `createComment()`는 사용자 `content`를 그대로 `<p>${content}</p>`에 삽입해 저장하고 있었다.
- 이 값은 `dangerouslySetInnerHTML`로 렌더링되는 댓글 sink에서 사용되므로, `<img onerror=...>` 같은 입력이 저장형 XSS가 될 수 있었다.
- Opus는 이 경로가 rich text가 아니라 plain-text 댓글 입력이므로 DOMPurify보다 HTML entity escaping이 더 적합하다고 판단했다.

Implemented changes
- `src/lib/actions/comments.ts`
  - `escapeHtml()` helper 추가 (`&`, `<`, `>`, `"`, `'` escape)
  - 댓글 저장 시 `contentHtml: \`<p>${escapeHtml(content)}</p>\`` 사용
- `.docs/CHANGE_LOG.md`
  - Unreleased 항목에 커뮤니티 댓글 저장형 XSS 차단 기록 추가

Verification
- Claude Opus smoke:
  - `/Users/stann/.local/bin/claude -p 'Reply with exactly: OPUS_SMOKE_OK' --model opus --output-format json`
  - exit 0
- Claude Opus review:
  - `/Users/stann/.local/bin/claude -p '<deep review prompt>' --model opus --output-format json`
  - exit 0
- lint:
  - `npm run lint`
  - exit 0
- typecheck:
  - `npx tsc --noEmit`
  - exit 0
- build:
  - `npm run build`
  - exit 0

Current findings
- 이전 라운드에서 복구한 lint/typecheck/build green 상태는 유지된다.
- 런타임 `npm audit`의 남은 moderate 이슈는 여전히 Next 내부 `postcss` advisory뿐이며, 이번 수정과는 무관한 pre-existing blocker다.
- 댓글은 plain-text UX를 유지하면서도 HTML/스크립트 실행이 차단되도록 저장 경로가 안전해졌다.

Next recommended actions
1. 실제 댓글 작성 E2E 또는 최소 수동 확인으로 `<img src=x onerror=...>` 입력이 문자 그대로 보이는지 확인
2. `src/lib/actions/comments.ts` 삭제 경로도 `assertOwnerOrAdmin()` 패턴으로 일원화할지 검토
3. 남은 pre-existing audit 이슈는 Next upstream/postcss 패치 여부 모니터링 중심으로 관리
