#!/bin/bash
# Mac 에 Orbit 을 설치한다: 디렉터리, 비밀값 파일, 저장소 mirror, 첫 배포, launchd 작업 2개.
# 사용법: scripts/mac/service.sh install|uninstall|status   (install 은 다시 실행해도 같다)
# uninstall 은 launchd 작업만 내린다. 컨테이너와 데이터는 그대로 둔다.
set -euo pipefail
umask 077

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
export ORBIT_HOME
REPO="${ORBIT_REPO:-duarbdhks/orbit}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
AGENTS="$HOME/Library/LaunchAgents"
JOBS="deploy backup"

plist() {  # 작업 이름
  local interval=300
  [ "$1" != backup ] || interval=3600
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.yeumgw.orbit.$1</string>
  <key>ProgramArguments</key>
  <array>
    <string>$ORBIT_HOME/current/scripts/mac/orbit-$1</string>
  </array>
  <key>StartInterval</key><integer>$interval</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$ORBIT_HOME/state/launchd-$1.log</string>
  <key>StandardErrorPath</key><string>$ORBIT_HOME/state/launchd-$1.log</string>
</dict>
</plist>
EOF
}

case "${1:-}" in
  install)
    mkdir -p "$ORBIT_HOME"/{env,state,releases,backups} "$AGENTS"
    if [ ! -f "$ORBIT_HOME/env/orbit.env" ]; then
      {
        echo "ORBIT_PG_PASSWORD=$(openssl rand -hex 24)"
        echo "ORBIT_API_TOKEN=$(openssl rand -hex 32)"
        grep -E '^ORBIT_(OWNER_PRINCIPAL|OWNER_USER_ID|ANALYZE_REAL_DATA|ANALYZE_CHANNELS|QM_WEBHOOK_URL|QM_WEBHOOK_SECRET|ROUTER_MODE|JEV_ENABLED|JEV_DAILY_BUDGET_USD|SLACK_BASE_URL)=|^OPENROUTER_API_KEY=' "$ROOT/.env.example"
      } > "$ORBIT_HOME/env/orbit.env"
      echo "만듦: $ORBIT_HOME/env/orbit.env"
    fi
    if [ ! -f "$ORBIT_HOME/env/collector.env" ]; then
      grep -E '^(SLACK_USER_TOKEN|ORBIT_COLLECT_CHANNELS|ORBIT_BACKFILL_DAYS|ORBIT_RETENTION_DAYS)=' "$ROOT/.env.example" > "$ORBIT_HOME/env/collector.env"
      echo "만듦: $ORBIT_HOME/env/collector.env"
    fi
    if [ ! -d "$ORBIT_HOME/state/orbit.git" ]; then
      # 배포기는 ssh 키 대신 gh 의 토큰으로 fetch 한다. launchd 에서도 같은 자격으로 동작한다.
      git -c credential.helper='!gh auth git-credential' clone --quiet --mirror "https://github.com/$REPO.git" "$ORBIT_HOME/state/orbit.git"
      git --git-dir="$ORBIT_HOME/state/orbit.git" config credential.helper '!gh auth git-credential'
    fi
    launchctl bootout "gui/$(id -u)/com.yeumgw.orbit.watchdog" 2>/dev/null || true
    rm -f "$AGENTS/com.yeumgw.orbit.watchdog.plist"
    "$ROOT/scripts/deploy.sh"
    for job in $JOBS; do
      plist "$job" > "$AGENTS/com.yeumgw.orbit.$job.plist"
      launchctl bootout "gui/$(id -u)/com.yeumgw.orbit.$job" 2>/dev/null || true
      launchctl bootstrap "gui/$(id -u)" "$AGENTS/com.yeumgw.orbit.$job.plist"
    done
    echo "설치 완료. scripts/status.sh 로 확인하세요."
    ;;
  uninstall)
    for job in $JOBS watchdog; do
      launchctl bootout "gui/$(id -u)/com.yeumgw.orbit.$job" 2>/dev/null || true
      rm -f "$AGENTS/com.yeumgw.orbit.$job.plist"
    done
    echo "launchd 작업을 내렸습니다. 컨테이너와 데이터는 그대로입니다."
    ;;
  status)
    for job in $JOBS; do
      launchctl print "gui/$(id -u)/com.yeumgw.orbit.$job" 2>/dev/null | grep -E 'state =|last exit code' | sed "s/^/$job:/" || echo "$job: 설치 안 됨"
    done
    ;;
  *)
    echo "사용법: $0 install|uninstall|status" >&2
    exit 2
    ;;
esac
