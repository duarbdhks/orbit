#!/usr/bin/env bash
# QM 에 Orbit MCP 서버를 등록한다. 다시 실행해도 같다.
# 사용법: scripts/qm_register.sh
# 관리자 로그인 링크로 세션을 얻어 관리자 API 를 부른다. 쿠키는 끝나면 지우는 임시 파일에만 둔다.
# attestActor 로 등록하므로 QM 은 주인의 개인 대화에서만 도구를 내주고 x-qm-actor 로 호출자를 알려 준다.
set -euo pipefail
umask 077

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
WEB="${ORBIT_QM_WEB:-http://localhost:18082}"
TOKEN="$(sed -n 's/^ORBIT_API_TOKEN=//p' "$ORBIT_HOME/env/orbit.env")"
[ -n "$TOKEN" ] || { echo "qm_register: env/orbit.env 에 ORBIT_API_TOKEN 이 없습니다." >&2; exit 2; }

JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

link="$("$ROOT/scripts/qm.sh" admin-login | grep -o "$WEB[^ ]*" | head -n 1)"
[ -n "$link" ] || { echo "qm_register: 관리자 로그인 링크를 받지 못했습니다." >&2; exit 1; }
# 로그인 페이지는 주소의 # 뒤 토큰을 같은 출처의 POST 로 보낸다. 같은 요청을 그대로 만든다.
curl -sSf -L -o /dev/null -c "$JAR" -H "Origin: $WEB" --data-urlencode "token=${link#*#token=}" "$WEB/auth/admin-login"

api() { curl -sSf -b "$JAR" -H "Origin: $WEB" -H 'content-type: application/json' "$@"; }

api -X PUT "$WEB/api/admin/mcp-servers/orbit" --data @- > /dev/null <<EOF
{"name":"Orbit","url":"http://orbit-api:8787/mcp","auth":"bearer","bearerToken":"$TOKEN","catalog":true,"attestActor":true,"approval":"none","enabled":true}
EOF
api "$WEB/api/admin/mcp-servers" | node -e '
  const { servers, tools } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  for (const s of servers) console.log(`${s.id} enabled=${s.enabled} attestActor=${s.attestActor} url=${s.url}`);
  console.log(`도구 ${tools.length}개: ${tools.map((t) => t.name ?? t.tool ?? "?").join(", ")}`);
'
