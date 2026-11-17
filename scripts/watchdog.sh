#!/usr/bin/env bash
# 컨테이너 상태와 수집 지연을 ${ORBIT_HOME}/state/health.json 에 남기고, 멈춘 컨테이너를 다시 올린다.
# 하루가 지난 백업이 없으면 백업도 만든다. launchd 가 300초마다 실행한다.
# 컨테이너를 일부러 멈춰 둘 때는 먼저 scripts/mac/service.sh uninstall 을 한다.
set -uo pipefail

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
export ORBIT_HOME
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
STATE="$ORBIT_HOME/state"
NOW="$(date '+%FT%T%z')"
mkdir -p "$STATE"

write() { printf '%s\n' "$1" > "$STATE/health.json.tmp" && mv "$STATE/health.json.tmp" "$STATE/health.json"; }

if ! docker version >/dev/null 2>&1; then
  write "{\"at\":\"$NOW\",\"docker\":false}"
  exit 0
fi

containers=""
for name in qm-orbit-pg qm-orbit-core orbit-pg orbit-api orbit-collector orbit-runner; do
  status="$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || echo missing)"
  if [ "$status" = exited ] || [ "$status" = created ]; then
    docker start "$name" >/dev/null 2>&1 && status=restarted
  fi
  containers="$containers\"$name\":\"$status\","
done

# 가장 오래 수집이 멈춘 허용 채널 기준. 수집 대상이 없으면 null 이다.
lag="$(docker exec orbit-pg psql -U orbit -d orbit -At -c "SELECT coalesce(round(extract(epoch FROM now() - min(last_success_at)))::text, 'null') FROM sync_state s JOIN channels c ON c.id = s.channel_id WHERE c.access_state = 'active'" 2>/dev/null || echo null)"
stale=false
if [ "$lag" != null ] && [ "$lag" -gt 1800 ]; then stale=true; fi

backup=fresh
last="$(ls -d "$ORBIT_HOME"/backups/*/ 2>/dev/null | grep -v '\.partial/$' | sort | tail -n 1)"
if [ -z "$last" ] || [ -n "$(find "$last" -maxdepth 0 -mmin +1440)" ]; then
  if "$ROOT/scripts/backup.sh" >/dev/null 2>&1; then backup=created; else backup=failed; fi
fi

write "{\"at\":\"$NOW\",\"docker\":true,\"containers\":{${containers%,}},\"collect_lag_seconds\":$lag,\"collect_stale\":$stale,\"backup\":\"$backup\"}"
