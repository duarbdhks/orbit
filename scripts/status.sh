#!/usr/bin/env bash
# 배포, 컨테이너, 헬스, CI 러너 상태를 한 번에 보여 준다.
set -uo pipefail

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"

echo "== 배포"
"$ROOT/scripts/deploy.sh" status
echo "== 컨테이너"
docker ps -a --filter name=orbit --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
echo "== 헬스 (watchdog)"
cat "$ORBIT_HOME/state/health.json" 2>/dev/null || echo "기록 없음"
echo "== CI 러너"
gh api "repos/${ORBIT_REPO:-duarbdhks/orbit}/actions/runners" --jq '.runners[] | "\(.name) \(.status) busy=\(.busy)"'
