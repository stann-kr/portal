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
    EMAIL="${2:-admin@stannlumo.com}"
    PASS="${3:-adminpassword123!}"
    DISPLAY_NAME="${4:-Stann}"
    echo "🌱 Seeding admin user: $EMAIL"
    docker compose run --rm web npx tsx src/scripts/setup-admin.ts "$EMAIL" "$PASS" "$DISPLAY_NAME" --exec
    ;;
  "logs")
    echo "📋 Showing logs..."
    docker compose logs -f web
    ;;
  *)
    echo "Usage: ./dev.sh [dev|migrate|studio|build|shell|seed|logs]"
    echo "       ./dev.sh seed [email] [password] [displayName]"
    exit 1
    ;;
esac
