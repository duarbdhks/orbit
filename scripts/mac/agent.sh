#!/bin/bash
# launchd 가 부르는 진입점. launchd 의 PATH 에는 docker, gh, Node 가 없어서 여기서 잡아 준다.
# 사용법: scripts/mac/agent.sh deploy|backup
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
export PATH="$HOME/.nvm/versions/node/v$(cat "$ROOT/.node-version")/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Docker Desktop의 로그인 자동 시작을 기다린다. 수동 종료를 되돌리지 않는다.
docker version >/dev/null 2>&1 || exit 0

case "${1:-}" in
  deploy) exec "$ROOT/scripts/deploy.sh" --auto ;;
  backup) exec "$ROOT/scripts/backup.sh" --auto ;;
  *) echo "사용법: $0 deploy|backup" >&2; exit 2 ;;
esac
