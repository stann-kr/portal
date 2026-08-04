# Stann Lumo Portal

Stann Lumo의 DJ 레슨 운영을 위한 웹 포털이다. 학생과 관리자가 과제·피드백, 커리큘럼, 일정, 개인 노트, 디깅 기록, 커뮤니티와 1:1 Q&A를 한 곳에서 관리한다.

## 현재 상태

- Next.js 15 App Router와 React 19 기반
- NextAuth credentials 인증과 student/admin 역할 분리
- Drizzle ORM, Cloudflare D1/R2, OpenNext 배포 구조
- 학생·관리자 원페이지 포털과 기존 상세 라우트 병행
- 문서·migration·runtime dependency·로컬 개발 seed 기반 복구 완료
- 인증·권한 회귀 테스트를 보강한 뒤 역할별 핵심 UI/UX를 세로 단위로 개선 예정

## 로컬 실행

요구 사항:

- Node.js 20.18.1 이상
- npm
- `.env.example`을 참고해 작성한 `.env.local`

```bash
npm install
npm run dev
```

개발 서버는 기본적으로 [http://localhost:3004](http://localhost:3004)에서 실행된다.

로컬 관리자 계정이 필요하면 먼저 local D1 migration을 적용하고 `.env.local`에
`.env.example`의 `DEV_ADMIN_*` 값을 설정한다. 명시적 opt-in을 활성화한 뒤 아래
명령을 실행하며, 관리자 비밀번호를 명령행 인자로 전달하지 않는다.

```bash
npm run db:migrate
npm run dev:seed-admin
```

## 주요 검증

```bash
npm run db:check
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run build:worker
```

로컬·원격 D1 migration과 실제 배포는 데이터 및 운영 환경에 영향을 줄 수 있으므로 [배포 가이드](./docs/DEPLOYMENT.md)의 승인·점검 절차를 확인한다.

## 문서

- [프로젝트 문서 허브](./docs/README.md)
- [요구사항](./docs/REQUIREMENTS.md)
- [기술 명세](./docs/TECH_SPEC.md)
- [배포 가이드](./docs/DEPLOYMENT.md)
- [변경 이력](./docs/CHANGE_LOG.md)
- [트러블슈팅](./docs/TROUBLESHOOTING.md)

제품 범위와 검증 기준은 요구사항에서, 실제 route·data·auth 구조와 기술 부채는
기술 명세에서 확인할 수 있다. 설계와 구현의 차이는 두 문서의 현재 상태를 기준으로
관리한다.

## 보안

실제 secret, token, 운영 계정 정보는 저장소와 문서에 기록하지 않는다. 공개된 샘플 값은 개발 환경의 placeholder로만 사용한다.
