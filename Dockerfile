# Cloudflare Wrangler(workerd)는 glibc 환경을 필요로 하므로 Debian 계열 이미지를 사용함
FROM node:22-bookworm-slim

# 필요한 의존성 패키지 설치 (선택 사항)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 컨테이너 실행 시 의존성 설치 및 개발 서버 구동
CMD npm install && npm run dev
