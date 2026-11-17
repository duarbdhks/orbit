#!/usr/bin/env bash
# main 의 커밋을 로컬에 배포한다. CI gate 가 success 인 커밋만 올린다.
# 사용법: scripts/deploy.sh [--auto | status]
#   --auto   launchd 가 300초마다 부른다. 할 일이 없으면 조용히 끝난다.
#   status   현재 배포, main, 실패와 보류 기록, 최근 로그를 보여 준다.
# 수동 실행에서만: ORBIT_DEPLOY_REF=<브랜치|커밋> 으로 main 이 아닌 커밋을,
#   ORBIT_DEPLOY_FORCE=1 로 gate 확인과 실패 기록을 건너뛰고 올린다. 다음 자동 배포가 main 으로 되돌린다.
# 상태는 ${ORBIT_HOME}/state 에 둔다: current, failed, blocked, attempts, log.
set -euo pipefail
umask 077

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
export ORBIT_HOME
REPO="${ORBIT_REPO:-duarbdhks/orbit}"
STATE="$ORBIT_HOME/state"
MIRROR="$STATE/orbit.git"
RELEASES="$ORBIT_HOME/releases"
ENV_FILE="$ORBIT_HOME/env/orbit.env"

AUTO=0
REF=main
FORCE=0
if [ "${1:-}" = "--auto" ]; then
  AUTO=1
else
  REF="${ORBIT_DEPLOY_REF:-main}"
  FORCE="${ORBIT_DEPLOY_FORCE:-0}"
fi
SHA=""
CUR="$(cat "$STATE/current" 2>/dev/null || true)"

g() { git --git-dir="$MIRROR" "$@"; }
short() { printf '%.7s' "${1:-none}"; }
say() { if [ "$AUTO" = 0 ]; then echo "$@"; fi; }
log() { printf '%s %s->%s %s\n' "$(date '+%F %T')" "$(short "$CUR")" "$(short "$SHA")" "$1" >> "$STATE/log"; }
compose() {  # 태그, compose 인자...
  local tag="$1"
  shift
  if [ -x "$RELEASES/$tag/scripts/compose.sh" ]; then
    ORBIT_IMAGE_TAG="$tag" "$RELEASES/$tag/scripts/compose.sh" "$@"
    return
  fi
  ORBIT_IMAGE_TAG="$tag" docker compose --env-file "$ENV_FILE" -p orbit -f "$RELEASES/$tag/compose.yaml" "$@"
}
app() {  # 태그, DB 이름, 명령...
  local tag="$1" db="$2"
  shift 2
  docker run --rm --network orbit_default --env-file "$ENV_FILE" \
    -e "DATABASE_URL=postgres://orbit:$PG_PASSWORD@orbit-pg:5432/$db" "orbit:$tag" node src/main.ts "$@"
}

if [ "${1:-}" = status ]; then
  echo "current: ${CUR:-none}"
  echo "main:    $(g rev-parse --verify --quiet refs/heads/main || echo unknown) (마지막 fetch 기준)"
  if [ -s "$STATE/failed" ]; then echo "failed:"; tail -n 3 "$STATE/failed"; fi
  if [ -s "$STATE/blocked" ]; then echo "blocked:"; tail -n 3 "$STATE/blocked"; fi
  tail -n 8 "$STATE/log" 2>/dev/null || true
  exit 0
fi

[ -d "$MIRROR" ] && [ -f "$ENV_FILE" ] || { echo "deploy: 먼저 scripts/mac/service.sh install 을 실행하세요." >&2; exit 2; }

if [ "$AUTO" = 1 ] && [ -n "$CUR" ]; then
  running="$(docker ps -q --filter label=com.docker.compose.project=orbit)" || exit 1
  [ -n "$running" ] || exit 0
fi

LOCK="$STATE/deploy.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if kill -0 "$(cat "$LOCK/pid" 2>/dev/null)" 2>/dev/null; then
    say "다른 배포가 진행 중입니다."
    exit 0
  fi
  # 이전 실행이 죽으면서 남긴 잠금이다.
  rm -rf "$LOCK"
  mkdir "$LOCK"
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

transient() {  # 네트워크나 외부 서비스 문제. 커밋을 실패로 기록하지 않고 다음 주기에 다시 한다.
  local key="${SHA:-fetch}" n=1
  if [ "$(cut -d' ' -f1 "$STATE/attempts" 2>/dev/null)" = "$key" ]; then n=$(($(cut -d' ' -f2 "$STATE/attempts") + 1)); fi
  echo "$key $n" > "$STATE/attempts"
  log "transient:$1 ($n)"
  if [ "$n" -eq 3 ]; then echo "$(date '+%F %T') $key $1" >> "$STATE/blocked"; fi
  say "일시적 실패($1). 다음 실행에서 다시 시도합니다."
  exit 0
}
fail() {  # 이 커밋의 문제. 같은 커밋을 다시 올리지 않는다.
  echo "$SHA" >> "$STATE/failed"
  log "failed:$1"
  echo "deploy: 실패($1) $(short "$SHA"). 현재 배포는 $(short "$CUR") 그대로입니다." >&2
  exit 1
}

g fetch --quiet --prune origin 2>/dev/null || transient fetch
# fetch 가 다시 되면 fetch 실패로 남긴 보류 기록을 지운다.
if [ "$(cut -d' ' -f1 "$STATE/attempts" 2>/dev/null)" = fetch ]; then rm -f "$STATE/attempts" "$STATE/blocked"; fi
SHA="$(g rev-parse --verify --quiet "$REF^{commit}")" || { echo "deploy: 커밋을 찾지 못했습니다: $REF" >&2; exit 2; }
if [ "$SHA" = "$CUR" ] && [ "$FORCE" != 1 ]; then
  say "이미 배포된 커밋입니다: $SHA"
  exit 0
fi
if [ "$FORCE" != 1 ]; then
  if grep -qx "$SHA" "$STATE/failed" 2>/dev/null; then
    say "실패로 기록된 커밋입니다: $SHA"
    exit 0
  fi
  g merge-base --is-ancestor "$SHA" refs/heads/main || { echo "deploy: main 에 없는 커밋입니다: $SHA" >&2; exit 2; }
  gate="$(gh api "repos/$REPO/commits/$SHA/check-runs" --jq '[.check_runs[] | select(.name == "gate")] | sort_by(.started_at) | last | .conclusion // "pending"')" || transient ci-status
  if [ "$gate" != success ]; then
    say "gate 가 success 가 아닙니다($gate): $SHA"
    exit 0
  fi
fi

REL="$RELEASES/$SHA"
rm -rf "$REL"
mkdir -p "$REL"
# 이미지 안의 node 사용자가 읽을 수 있어야 한다. 이 스크립트의 umask 077 로 풀면 root 만 읽는 파일이 COPY 된다.
(umask 022 && g archive "$SHA" | tar -x -C "$REL")

docker pull -q "$(sed -n 's/^FROM //p' "$REL/Dockerfile" | head -n 1)" >/dev/null 2>&1 || transient base-image
if ! docker build -q -t "orbit:$SHA" "$REL" > "$STATE/build.log" 2>&1; then
  curl -sf -m 10 -o /dev/null https://registry.npmjs.org/-/ping || transient npm-registry
  fail build
fi

PG_PASSWORD="$(sed -n 's/^ORBIT_PG_PASSWORD=//p' "$ENV_FILE")"
if [ -x "$REL/scripts/compose.sh" ]; then
  if [ -z "$CUR" ]; then
    compose "$SHA" prepare --init > "$STATE/qm.log" 2>&1 || fail qm-config
  else
    compose "$SHA" prepare > "$STATE/qm.log" 2>&1 || fail qm-config
  fi
fi
docker network inspect qm-orbit >/dev/null 2>&1 || docker network create qm-orbit >/dev/null
db_services=(orbit-pg)
[ ! -x "$REL/scripts/compose.sh" ] || db_services+=(qm-pg)
compose "$SHA" up -d --wait --wait-timeout 90 "${db_services[@]}" >/dev/null 2>&1 || fail postgres

if [ -n "$CUR" ] && ! g diff --quiet "$CUR" "$SHA" -- qm compose.yaml scripts/qm_env.mjs; then
  "$REL/scripts/backup.sh" >/dev/null || fail qm-backup
fi

rehearse() {  # 방금 뜬 백업의 사본에 마이그레이션을 먼저 적용하고, 새 코드와 지금 코드가 그 스키마에서 도는지 본다.
  local dump="$1/orbit.dump"
  docker exec orbit-pg psql -U orbit -d postgres -q -c "DROP DATABASE IF EXISTS orbit_rehearsal" -c "CREATE DATABASE orbit_rehearsal" &&
    docker exec -i orbit-pg pg_restore -U orbit -d orbit_rehearsal --no-owner --exit-on-error < "$dump" &&
    app "$SHA" orbit_rehearsal migrate > /dev/null &&
    app "$SHA" orbit_rehearsal selfcheck &&
    { [ -z "$CUR" ] || app "$CUR" orbit_rehearsal selfcheck; } &&
    docker exec orbit-pg psql -U orbit -d postgres -q -c "DROP DATABASE orbit_rehearsal"
}

pending="$(app "$SHA" orbit migrate --pending)" || fail pending
if [ -n "$pending" ]; then
  backup="$("$REL/scripts/backup.sh" | tail -n 1)" || fail backup
  rehearse "$backup" > "$STATE/rehearsal.log" 2>&1 || fail rehearsal
  # 실패하면 Postgres 가 트랜잭션을 되돌린다. 운영 DB 를 백업으로 덮어쓰지 않는다.
  app "$SHA" orbit migrate > /dev/null 2>> "$STATE/rehearsal.log" || fail migrate
fi
# 마이그레이션이 없는 배포에서도 새 코드의 SQL 이 운영 스키마와 맞는지 교체 전에 본다.
app "$SHA" orbit selfcheck > "$STATE/selfcheck.log" 2>&1 || fail selfcheck

healthy() {  # 90초 안에 healthy 가 되고, 그 뒤 20초 동안 재시작 없이 유지된다.
  local before
  compose "$1" up -d --wait --wait-timeout 90 >/dev/null 2>&1 || return 1
  before="$(docker inspect -f '{{.Name}} {{.RestartCount}}' $(compose "$1" ps -q))"
  sleep 20
  [ "$before" = "$(docker inspect -f '{{.Name}} {{.RestartCount}}' $(compose "$1" ps -q))" ] &&
    [ -z "$(compose "$1" ps -q --status exited --status restarting --status dead)" ]
}

say "교체: $(short "$CUR") -> $(short "$SHA")"
if healthy "$SHA"; then
  printf '%s\n' "$SHA" > "$STATE/current.tmp"
  mv "$STATE/current.tmp" "$STATE/current"
  ln -sfn "$REL" "$ORBIT_HOME/current"
  rm -f "$STATE/attempts" "$STATE/blocked"
  log ok
  for old in "$RELEASES"/*; do
    tag="$(basename "$old")"
    if [ "$tag" != "$SHA" ] && [ "$tag" != "$CUR" ]; then
      rm -rf "$old"
      docker image rm "orbit:$tag" >/dev/null 2>&1 || true
    fi
  done
  say "배포 완료: $SHA"
  exit 0
fi

echo "$SHA" >> "$STATE/failed"
if [ -z "$CUR" ]; then
  log failed:health
  echo "deploy: 첫 배포의 헬스체크가 실패했습니다. scripts/logs.sh orbit-api 를 확인하세요." >&2
  exit 1
fi
echo "deploy: 헬스체크 실패. $(short "$CUR") 로 되돌립니다." >&2
if healthy "$CUR"; then
  log rolled-back
  exit 1
fi
log rollback-failed
echo "deploy: 되돌리기도 실패했습니다. scripts/status.sh 를 확인하세요." >&2
exit 2
