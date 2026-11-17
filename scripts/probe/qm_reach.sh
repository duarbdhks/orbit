#!/usr/bin/env bash
# QM core 컨테이너에서 Orbit API 로 가는 길을 확인한다: 이름 풀이, 네트워크, 토큰, 도구 목록.
# 사용법: scripts/probe/qm_reach.sh
# QM 의 MCP 클라이언트가 아니라 core 컨테이너의 node 로 직접 부른다. 턴 안에서의 호출은 Codex 로그인 뒤 DM 으로 확인한다.
set -euo pipefail

ORBIT_HOME="${ORBIT_HOME:-$HOME/Library/Application Support/Orbit}"
TOKEN="$(sed -n 's/^ORBIT_API_TOKEN=//p' "$ORBIT_HOME/env/orbit.env")"

docker exec -e "T=$TOKEN" qm-orbit-core node -e '
  const post = (headers, body) =>
    fetch("http://orbit-api:8787/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const call = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "collector_status", arguments: {} } };
  const auth = { authorization: "Bearer " + process.env.T };
  const [none, listed, anonymous] = await Promise.all([post({}, list), post(auth, list), post(auth, call)]);
  const tools = (await listed.json()).result.tools.map((t) => t.name);
  console.log("토큰 없음:", none.status, "/ 도구 목록:", listed.status, tools.length + "개", "/ actor 없는 호출:", anonymous.status);
  if (none.status !== 401 || tools.length !== 8 || anonymous.status !== 401) process.exit(1);
'
