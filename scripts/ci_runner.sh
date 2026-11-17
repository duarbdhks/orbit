#!/usr/bin/env bash
# CI용 셀프호스트 러너를 Mac의 Docker 컨테이너로 관리한다.
# 사용법: scripts/ci_runner.sh up|down|status
# PR 코드가 이 컨테이너에서 실행되므로 호스트 폴더, ~/.ssh, docker.sock을 마운트하지 않는다.
# shortcut: 컨테이너를 작업 사이에 재사용한다, 외부 기여자가 생기면 작업마다 새 컨테이너(ephemeral)로 바꾼다.
set -euo pipefail

NAME=orbit-runner
LABEL=orbit-ci-mac
# actions-runner, Ubuntu 24.04 arm64. ZUSIK 러너와 같은 이미지다.
IMAGE=ghcr.io/actions/actions-runner@sha256:759a1d94a15b05941aba5196974ff43fe15b4cbba29b694b35cbc32a1166b232
REPO="$(git remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')"

# 공개 저장소에 셀프호스트 러너를 붙이면 외부 PR 코드가 이 Mac에서 실행될 수 있다.
# 비공개이거나, 모든 외부 기여자의 포크 PR 실행에 승인이 필요할 때만 러너를 켠다.
guarded() {
  [ "$(gh api "repos/$REPO" --jq .private)" = true ] ||
    [ "$(gh api "repos/$REPO/actions/permissions/fork-pr-contributor-approval" --jq .approval_policy)" = all_external_contributors ]
}

runner_id() {
  gh api "repos/$REPO/actions/runners" --jq ".runners[] | select(.name == \"$LABEL\") | .id"
}

case "${1:-}" in
  up)
    guarded || { echo "ci_runner: $REPO 는 공개 저장소인데 포크 PR 승인 정책이 all_external_contributors 가 아닙니다." >&2; exit 2; }
    if docker container inspect "$NAME" >/dev/null 2>&1; then
      docker start "$NAME" >/dev/null
    else
      # 등록 토큰은 1시간 뒤 만료된다. 명령줄에 남지 않게 환경 변수로만 넘긴다.
      token="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
      [ -n "$token" ] || { echo "ci_runner: 등록 토큰을 받지 못했습니다." >&2; exit 1; }
      RUNNER_TOKEN="$token" REPO_URL="https://github.com/$REPO" RUNNER_NAME="$LABEL" \
        docker run -d --name "$NAME" --restart unless-stopped --cpus 3 --memory 3g \
          -e RUNNER_TOKEN -e REPO_URL -e RUNNER_NAME "$IMAGE" \
          bash -c '[ -f .runner ] || ./config.sh --unattended --url "$REPO_URL" --token "$RUNNER_TOKEN" --name "$RUNNER_NAME" --labels "$RUNNER_NAME" --replace; exec ./run.sh' >/dev/null
    fi
    echo "$NAME 시작. 'scripts/ci_runner.sh status'로 online을 확인하세요."
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    id="$(runner_id)"
    [ -z "$id" ] || gh api -X DELETE "repos/$REPO/actions/runners/$id"
    echo "$NAME 제거, GitHub 등록 해제"
    ;;
  status)
    docker container inspect -f '{{.Name}} {{.State.Status}} restart={{.RestartCount}}' "$NAME" 2>/dev/null || echo "$NAME 컨테이너 없음"
    gh api "repos/$REPO/actions/runners" --jq ".runners[] | select(.name == \"$LABEL\") | \"\(.name) \(.status) busy=\(.busy)\""
    ;;
  *)
    echo "사용법: $0 up|down|status" >&2
    exit 2
    ;;
esac
