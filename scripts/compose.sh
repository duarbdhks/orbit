#!/usr/bin/env bash
# 현재 릴리스의 QM 환경과 두 env 파일을 사용해 운영 Compose를 실행한다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
export ORBIT_HOME
ORBIT_IMAGE_TAG="${ORBIT_IMAGE_TAG:-$(cat "$ORBIT_HOME/state/current")}"
export ORBIT_IMAGE_TAG
export QM_RUNTIME_DIR="${QM_RUNTIME_DIR:-$ORBIT_HOME/state/qm/$(cat "$ROOT/qm/package-lock.json" "$ROOT/qm/qm.config.jsonc" "$ROOT/scripts/qm_env.mjs" | shasum -a 256 | cut -d' ' -f1)}"

if [ "${1:-}" = prepare ]; then
  shift
  [ -d "$ROOT/qm/node_modules/@yc-software/qm" ] || npm ci --prefix "$ROOT/qm" --no-audit --no-fund >/dev/null
  exec node "$ROOT/scripts/qm_env.mjs" "$QM_RUNTIME_DIR" "$@"
fi

exec docker compose --env-file "$ORBIT_HOME/env/orbit.env" --env-file "$QM_RUNTIME_DIR/compose.env" \
  -p orbit -f "$ROOT/compose.yaml" "$@"
