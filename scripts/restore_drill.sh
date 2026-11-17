#!/usr/bin/env bash
# 백업을 임시 DB에 복원해 보고 운영 DB와 테이블별 행 수를 비교한다. 운영 DB는 건드리지 않는다.
# 사용법: scripts/restore_drill.sh [백업 디렉터리]   (기본: 가장 최근 백업)
set -euo pipefail

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
BACKUP="${1:-$(ls -d "$ORBIT_HOME"/backups/*/ 2>/dev/null | grep -v '\.partial/$' | sort | tail -n 1)}"
[ -n "$BACKUP" ] && [ -d "$BACKUP" ] || { echo "restore_drill: 백업이 없습니다." >&2; exit 2; }

COUNTS="SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"

FAILED=0
drill() {  # 컨테이너, DB 사용자, 운영 DB 이름, 덤프 파일
  local container="$1" user="$2" db="$3" dump="$4" scratch="${3}_drill" live restored
  [ -f "$dump" ] || { echo "$db: 덤프 없음, 건너뜀"; return; }
  docker exec "$container" psql -U "$user" -d postgres -q -c "DROP DATABASE IF EXISTS $scratch" -c "CREATE DATABASE $scratch"
  if docker exec -i "$container" pg_restore -U "$user" -d "$scratch" --no-owner --exit-on-error < "$dump"; then
    live="$(docker exec "$container" psql -U "$user" -d "$db" -At -c "$COUNTS")"
    restored="$(docker exec "$container" psql -U "$user" -d "$scratch" -At -c "$COUNTS")"
    if [ "$(cut -d' ' -f1 <<<"$live")" != "$(cut -d' ' -f1 <<<"$restored")" ]; then
      echo "$db: FAIL 테이블 목록이 운영 DB와 다릅니다."
      FAILED=1
    elif [ "$live" = "$restored" ]; then
      echo "$db: 복원 성공, $(wc -l <<<"$restored" | tr -d ' ')개 테이블의 행 수가 운영 DB와 같습니다."
    else
      # 백업 뒤에 쓰인 행만큼은 달라질 수 있다.
      echo "$db: 복원 성공, 행 수가 다른 테이블 (운영 / 복원):"
      diff <(echo "$live") <(echo "$restored") | grep '^[<>]' || true
    fi
  else
    echo "$db: FAIL 복원 실패"
    FAILED=1
  fi
  docker exec "$container" psql -U "$user" -d postgres -q -c "DROP DATABASE IF EXISTS $scratch"
}

echo "restore_drill: $BACKUP"
drill orbit-pg orbit orbit "$BACKUP/orbit.dump"
drill qm-orbit-pg postgres qm "$BACKUP/qm.dump"
if [ -f "$BACKUP/coredata.tar" ]; then
  echo "coredata: tar 항목 $(tar -tf "$BACKUP/coredata.tar" | wc -l | tr -d ' ')개"
fi
exit "$FAILED"
