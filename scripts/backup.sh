#!/usr/bin/env bash
# Orbit DB, QM DB, QM 데이터 볼륨을 ${ORBIT_HOME}/backups/<시각>/ 에 백업하고 7일 지난 백업을 지운다.
# 사용법: scripts/backup.sh [--auto]   (마지막 줄에 백업 경로를 출력한다)
# env/ 의 비밀값은 백업하지 않는다. 비밀번호 관리자에 따로 보관한다.
set -euo pipefail
umask 077

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
DIR="$ORBIT_HOME/backups"
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }

if ! running orbit-pg || ! running qm-orbit-pg; then
  echo "backup: DB가 중지돼 있어 백업을 건너뜁니다. 기존 백업을 보존합니다." >&2
  [ "${1:-}" = --auto ] && exit 0
  exit 1
fi
mkdir -p "$DIR"
if [ "${1:-}" = --auto ]; then
  last="$(find "$DIR" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' 2>/dev/null | sort | tail -n 1)"
  if [ -n "$last" ] && [ -z "$(find "$last" -maxdepth 0 -mmin +1440)" ]; then exit 0; fi
fi
NAME="$(date +%Y%m%d-%H%M%S)-$$"
# 끝까지 쓴 백업만 .partial 없는 이름을 갖는다.
TMP="$DIR/$NAME.partial"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

docker exec orbit-pg pg_dump -U orbit -Fc orbit > "$TMP/orbit.dump"
docker exec qm-orbit-pg pg_dump -U postgres -Fc qm > "$TMP/qm.dump"
docker volume inspect qm-orbit-coredata >/dev/null
docker run --rm --entrypoint tar -v qm-orbit-coredata:/data:ro pgvector/pgvector:0.8.1-pg16 -C /data -cf - . > "$TMP/coredata.tar"
# QM CLI 가 여기에 QM Postgres 비밀번호를 둔다. 없으면 볼륨이 있어도 QM 을 다시 올릴 수 없다.
cp "${XDG_CONFIG_HOME:-$HOME/.config}/qm/deployments/orbit/state.json" "$TMP/qm-state.json"

mv "$TMP" "$DIR/$NAME"
find "$DIR" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +
echo "$DIR/$NAME"
