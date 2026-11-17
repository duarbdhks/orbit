#!/usr/bin/env bash
# 로그를 본다.
# 사용법: scripts/logs.sh deploy [줄 수] | <컨테이너 이름> [docker logs 옵션]
#   컨테이너: qm-orbit-core qm-orbit-pg orbit-api orbit-collector orbit-pg orbit-runner
set -euo pipefail

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"

case "${1:-}" in
  "")
    sed -n '2,4p' "$0" >&2
    exit 2
    ;;
  deploy)
    tail -n "${2:-50}" "$ORBIT_HOME/state/log"
    ;;
  *)
    name="$1"
    shift
    docker logs --tail 100 "$@" "$name"
    ;;
esac
