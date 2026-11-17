#!/usr/bin/env bash
# CI와 같은 검사를 커밋된 트리의 임시 사본에서 실행한다.
# 사용법: scripts/ci_gate.sh [REF]   (기본 HEAD, 커밋하지 않은 변경은 검사하지 않는다)
# CI의 gate 작업도 이 스크립트를 실행한다. 필요 도구: git, node, npm, curl, tar.
# 임시 사본에서 돌리므로 checkout의 .env와 실제 인증정보를 읽지 않는다.
set -uo pipefail

REF="${1:-HEAD}"
GITLEAKS_VERSION=8.30.1

for bin in git node npm curl tar; do
  command -v "$bin" >/dev/null || { echo "ci_gate: $bin 이(가) 필요합니다." >&2; exit 2; }
done

REPO="$(git rev-parse --show-toplevel)" || exit 2
SHA="$(git -C "$REPO" rev-parse --verify "$REF^{commit}")" || exit 2
git -C "$REPO" diff --quiet HEAD -- || echo "ci_gate: 경고 - 커밋하지 않은 변경은 검사하지 않습니다." >&2

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/orbit-gate.XXXXXX")" || exit 2
trap 'rm -rf "$ROOT"' EXIT
SRC="$ROOT/src"
mkdir -p "$SRC" "$ROOT/logs"
git -C "$REPO" archive "$SHA" | tar -x -C "$SRC" || exit 2
cd "$SRC" || exit 2

[ "v$(cat .node-version)" = "$(node -v)" ] || { echo "ci_gate: Node $(cat .node-version) 이 필요합니다 (현재 $(node -v))." >&2; exit 2; }
unset DATABASE_URL SLACK_USER_TOKEN SLACK_BOT_TOKEN SLACK_APP_TOKEN OPENROUTER_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY

FAILED=""
step() {
  local name="$1" start=$SECONDS
  shift
  if "$@" > "$ROOT/logs/$name.log" 2>&1; then
    printf 'ok    %-10s %4ss\n' "$name" "$((SECONDS - start))"
  else
    printf 'FAIL  %-10s %4ss\n' "$name" "$((SECONDS - start))"
    tail -n 40 "$ROOT/logs/$name.log" | sed 's/^/      /'
    FAILED="$FAILED $name"
  fi
}

gitleaks_scan() {
  local os arch dir name url
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) return 1 ;; esac
  case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; x86_64 | amd64) arch=x64 ;; *) return 1 ;; esac
  dir="${XDG_CACHE_HOME:-$HOME/.cache}/orbit-gate/gitleaks-$GITLEAKS_VERSION-$os-$arch"
  if [ ! -x "$dir/gitleaks" ]; then
    name="gitleaks_${GITLEAKS_VERSION}_${os}_${arch}.tar.gz"
    url="https://github.com/gitleaks/gitleaks/releases/download/v$GITLEAKS_VERSION"
    mkdir -p "$dir" || return 1
    curl -sSfL -o "$dir/$name" "$url/$name" || return 1
    curl -sSfL "$url/gitleaks_${GITLEAKS_VERSION}_checksums.txt" | grep " $name\$" > "$dir/sum" || return 1
    if command -v sha256sum >/dev/null; then
      (cd "$dir" && sha256sum -c sum) || return 1
    else
      (cd "$dir" && shasum -a 256 -c sum) || return 1
    fi
    tar -xzf "$dir/$name" -C "$dir" gitleaks || return 1
  fi
  "$dir/gitleaks" detect --no-git --redact -c .gitleaks.toml --exit-code 1 -s .
}

echo "ci_gate: $SHA"
# gitleaks는 의존성과 테스트 산출물이 생기기 전의 트리를 본다.
step gitleaks gitleaks_scan
step deps npm ci --no-audit --no-fund
step typecheck npm run -s typecheck
step lint npm run -s lint
step test npm test
step audit npm audit --audit-level=high

if [ -n "$FAILED" ]; then
  echo "ci_gate: 실패 -$FAILED"
  exit 1
fi
echo "ci_gate: 통과"
