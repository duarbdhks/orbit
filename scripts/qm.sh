#!/usr/bin/env bash
# 버전 고정된 QM CLI를 Orbit 설정으로 실행한다.
# 사용법: scripts/qm.sh <qm 명령> [옵션]   예: scripts/qm.sh check | up | status | logs core | admin-login
# 비밀값은 저장소 밖 ${ORBIT_HOME}/env/qm.env 에서 읽는다.
set -euo pipefail

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
QM_DIR="$(cd "$(dirname "$0")/../qm" && pwd)"

[ -d "$QM_DIR/node_modules/@yc-software/qm" ] || npm ci --prefix "$QM_DIR" --no-audit --no-fund >/dev/null
cd "$QM_DIR"
exec npm exec qm -- "$@" --env-file "$ORBIT_HOME/env/qm.env"
