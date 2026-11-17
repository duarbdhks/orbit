#!/usr/bin/env bash
# 배포, 컨테이너, 헬스, CI 러너 상태를 한 번에 보여 준다.
set -uo pipefail

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"

echo "== 배포"
"$ROOT/scripts/deploy.sh" status
echo "== 컨테이너"
docker ps -a --filter name=orbit --format 'table {{.Names}}\t{{.Status}}\t{{.Label "com.docker.compose.project"}}\t{{.Image}}'
echo "== 수집 지연 (초)"
docker exec orbit-pg psql -U orbit -d orbit -At -c "SELECT coalesce(round(extract(epoch FROM now() - min(last_success_at)))::text, '대상 없음') FROM sync_state s JOIN channels c ON c.id = s.channel_id WHERE c.access_state = 'active'" 2>/dev/null || echo "DB 중지 또는 조회 실패"
echo "== 마지막 완전한 백업"
find "$ORBIT_HOME/backups" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' 2>/dev/null | sort | tail -n 1
echo "== CI 러너"
gh api "repos/${ORBIT_REPO:-duarbdhks/orbit}/actions/runners" --jq '.runners[] | "\(.name) \(.status) busy=\(.busy)"'
