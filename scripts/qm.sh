#!/usr/bin/env bash
# 버전 고정된 QM CLI를 Orbit 설정으로 실행한다.
# 사용법: scripts/qm.sh <qm 명령> [옵션]   예: scripts/qm.sh check | up | status | logs core | admin-login
# 비밀값은 저장소 밖 ${ORBIT_HOME}/env/qm.env 에서 읽는다.
set -euo pipefail

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
export ORBIT_HOME
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
QM_DIR="$ROOT/qm"

case "${1:-}" in
  up)
    [ "$#" = 1 ] || { echo "qm: up의 추가 옵션은 지원하지 않습니다." >&2; exit 2; }
    "$ROOT/scripts/compose.sh" prepare
    exec "$ROOT/scripts/compose.sh" up -d --wait --wait-timeout 120 qm-pg qm-core
    ;;
  down)
    [ "$#" = 1 ] || { echo "qm: down은 데이터 삭제 옵션을 받지 않습니다." >&2; exit 2; }
    exec "$ROOT/scripts/compose.sh" stop qm-core qm-pg
    ;;
esac

[ -d "$QM_DIR/node_modules/@yc-software/qm" ] || npm ci --prefix "$QM_DIR" --no-audit --no-fund >/dev/null
cd "$QM_DIR"
exec npm exec qm -- "$@" --env-file "$ORBIT_HOME/env/qm.env"
