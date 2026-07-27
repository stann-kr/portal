# 트러블슈팅

## 2026-07-28 — private audit/phase progress가 public docs와 섞임

### 증상

공개 문서로 사용할 파일에 audit, deployment readiness, phase progress 등 private 작업 문서 성격의 내용이 섞여 있었다.

### 원인

기존 `.docs` 중심 문서 구조를 public `docs/`로 전환하는 과정에서 작업 로그 성격의 파일까지 함께 승격될 수 있었다.

### 해결

- public docs는 현재 제품/기술/배포 기준으로 재작성했다.
- private audit, phase progress, handoff/work log는 `.docs/` 레이어에 보존한다.
- 이전 상세 원본은 `.docs/원본/2026-07-28/docs/`와 `dotdocs_snapshot/`에 보존했다.

### 검증

```bash
grep -RInE '<private-marker>|<local-user-path>' docs/ || true
```

## 재발 가능한 이슈 분류

- NextAuth credentials provider와 route guard mismatch.
- D1 migration 미적용으로 schema mismatch 발생.
- R2 presigned upload 권한/환경 변수 불일치.
- Tiptap SSR hydration 또는 sanitizer 정책 변경.
- OpenNext/Wrangler deployment binding 불일치.

이전 상세 트러블슈팅 이력은 원본 snapshot을 참고하고, public docs에는 재발 가능성이 높은 운영 이슈만 다시 정리한다.
