#!/bin/bash

# Stann Lumo Portal - Dev Helper Script

case "$1" in
  "dev")
    echo "🚀 Starting Next.js Dev Server..."
    # 기존 컨테이너 종료 후 재기동 (포트 충돌 방지)
    docker compose down 2>/dev/null || true
    docker compose up
    ;;
  "migrate")
    echo "🌀 Applying D1 Local Migrations..."
    docker compose run --rm web npm run db:migrate
    ;;
  "studio")
    echo "📊 Opening Drizzle Studio..."
    docker compose run --rm -p 4983:4983 web npm run db:studio
    ;;
  "build")
    echo "🏗️ Building for Cloudflare Workers (OpenNext)..."
    docker compose run --rm web npm run build:worker
    ;;
  "shell")
    echo "🐚 Opening Container Shell..."
    docker compose run --rm web sh
    ;;
  "seed")
    # 관리자 정보는 .env.local의 DEV_ADMIN_* 값에서만 읽는다(README "로컬 관리자 계정").
    # 비밀번호가 process 목록과 shell history에 남지 않도록 명령행 인자는 받지 않는다.
    if [ "$#" -gt 1 ]; then
      echo "seed는 인자를 받지 않습니다. .env.local에 DEV_ADMIN_SEED_ENABLED, DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD, DEV_ADMIN_DISPLAY_NAME을 설정하세요." >&2
      exit 1
    fi
    echo "🌱 Seeding local admin from .env.local (DEV_ADMIN_*)..."
    docker compose run --rm web npm run dev:seed-admin
    ;;
  "logs")
    echo "📋 Showing logs..."
    docker compose logs -f web
    ;;
  *)
    echo "Usage: ./dev.sh [dev|migrate|studio|build|shell|seed|logs]"
    echo "       ./dev.sh seed   (.env.local의 DEV_ADMIN_* 값으로 로컬 관리자 계정을 만든다)"
    exit 1
    ;;
esac
