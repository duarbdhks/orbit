#!/bin/bash
# launchd 가 부르는 진입점. launchd 의 PATH 에는 docker, gh, Node 가 없어서 여기서 잡아 준다.
# 사용법: scripts/mac/agent.sh deploy|watchdog
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
export PATH="$HOME/.nvm/versions/node/v$(cat "$ROOT/.node-version")/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# 재부팅 직후에는 Docker Desktop 이 아직 없다. 띄워 두고 다음 주기를 기다린다.
if ! docker version >/dev/null 2>&1; then
  open -ga Docker
  exit 0
fi

case "${1:-}" in
  deploy) exec "$ROOT/scripts/deploy.sh" --auto ;;
  watchdog) exec "$ROOT/scripts/watchdog.sh" ;;
  *) echo "사용법: $0 deploy|watchdog" >&2; exit 2 ;;
esac
