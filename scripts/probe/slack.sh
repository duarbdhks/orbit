#!/usr/bin/env bash
# 수집용 Slack User 토큰으로 무엇이 보이는지 확인한다. 메시지 본문은 출력하지 않는다.
# 사용법: scripts/probe/slack.sh [채널 id]
#   인자 없이: 유형별 채널 수.  채널 id: 그 채널 history 가 읽히는지와 연속 20회 호출의 429 수.
set -euo pipefail

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
TOKEN="$(sed -n 's/^SLACK_USER_TOKEN=//p' "$ORBIT_HOME/env/collector.env")"
[ -n "$TOKEN" ] || { echo "slack probe: env/collector.env 에 SLACK_USER_TOKEN 이 없습니다." >&2; exit 2; }

slack() {  # 메서드, form 인자...
  local method="$1"
  shift
  curl -sS -o "$OUT" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$@" "https://slack.com/api/$method"
}
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

if [ $# -eq 0 ]; then
  cursor=""
  : > "$OUT.all"
  while :; do
    code="$(slack conversations.list -d types=public_channel,private_channel -d exclude_archived=true -d limit=200 -d "cursor=$cursor")"
    # shortcut: Retry-After 를 읽지 않고 30초를 쉰다, 프로브가 느려 불편하면 헤더 값을 쓴다. 채널 530개에서 약 12분 걸렸다.
    if [ "$code" = 429 ]; then sleep 30; continue; fi
    node -e '
      const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      if (!j.ok) { console.error("slack: " + j.error); process.exit(1); }
      for (const c of j.channels) console.log((c.is_private ? "private" : "public") + " " + (c.is_member ? "member" : "non-member"));
      console.error(j.response_metadata?.next_cursor ?? "");
    ' "$OUT" >> "$OUT.all" 2> "$OUT.cursor" || { cat "$OUT.cursor" >&2; exit 1; }
    cursor="$(cat "$OUT.cursor")"
    [ -n "$cursor" ] || break
  done
  sort "$OUT.all" | uniq -c
  rm -f "$OUT.all" "$OUT.cursor"
  exit 0
fi

limited=0
for _ in $(seq 20); do
  code="$(slack conversations.history -d "channel=$1" -d limit=1)"
  if [ "$code" = 429 ]; then limited=$((limited + 1)); fi
done
node -e '
  const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  console.log("history ok=" + j.ok + (j.ok ? " messages=" + j.messages.length : " error=" + j.error));
' "$OUT"
echo "연속 20회 중 429: $limited"
