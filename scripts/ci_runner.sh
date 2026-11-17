#!/usr/bin/env bash
# CI용 셀프호스트 러너를 Mac의 Docker 컨테이너로 관리한다.
# 사용법: scripts/ci_runner.sh up|down|status
# PR 코드가 이 컨테이너에서 실행되므로 호스트 폴더, ~/.ssh, docker.sock을 마운트하지 않는다.
# shortcut: 컨테이너를 작업 사이에 재사용한다, 외부 기여자가 생기면 작업마다 새 컨테이너(ephemeral)로 바꾼다.
set -euo pipefail

NAME=orbit-runner
LABEL=orbit-ci-mac
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
REPO="$(git -C "$ROOT" remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')"
unset RUNNER_TOKEN

compose() {
  docker compose --project-name orbit-ci -f "$ROOT/compose.ci.yaml" "$@"
}

fail() {
  echo "ci_runner: $*" >&2
  exit 1
}

# 공개 저장소에 셀프호스트 러너를 붙이면 외부 PR 코드가 이 Mac에서 실행될 수 있다.
# 비공개이거나, 모든 외부 기여자의 포크 PR 실행에 승인이 필요할 때만 러너를 켠다.
guarded() {
  [ "$(gh api "repos/$REPO" --jq .private)" = true ] ||
    [ "$(gh api "repos/$REPO/actions/permissions/fork-pr-contributor-approval" --jq .approval_policy)" = all_external_contributors ]
}

registration() {
  local row
  row="$(gh api --paginate "repos/$REPO/actions/runners" --jq ".runners[] | select(.name == \"$LABEL\") | [.id, .busy, .status] | @tsv")"
  id= busy=false status=
  [ -n "$row" ] || return 0
  [[ "$row" != *$'\n'* ]] || fail "$LABEL 등록이 여러 개입니다. status로 확인하세요."
  IFS=$'\t' read -r id busy status <<< "$row"
  [[ "$id" =~ ^[0-9]+$ ]] || fail "GitHub runner ID를 확인하지 못했습니다."
  case "$busy:$status" in
    true:online|true:offline|false:online|false:offline) ;;
    *) fail "GitHub runner의 busy/status를 확인하지 못했습니다." ;;
  esac
}

idle() {
  registration
  [ "$busy" = false ] || fail "$LABEL busy=true 입니다. 컨테이너 제거·재생성·등록 변경을 중단합니다."
}

container_info() {
  local row
  row="$(docker container ls -a --filter "name=^/$NAME$" --format '{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}|{{.State}}')"
  IFS='|' read -r project service state <<< "$row"
}

disposable() {
  local info image
  info="$(docker container inspect -f '{{.Config.Image}}|{{len .Mounts}}' "$NAME")"
  image="$(compose config --images)"
  [ "$info" = "$image|0" ] || fail "$NAME 이미지 또는 마운트가 기존 CI 구성과 다릅니다. 백업 불필요 여부를 확인한 뒤 직접 처리하세요."
}

case "${1:-}" in
  up)
    guarded || { echo "ci_runner: $REPO 는 공개 저장소인데 포크 PR 승인 정책이 all_external_contributors 가 아닙니다." >&2; exit 2; }
    registration
    container_info
    if [ -n "$state" ] && { [ "$project" != orbit-ci ] || [ "$service" != runner ]; }; then
      idle
      fail "$NAME 은 orbit-ci Compose runner가 아닙니다. 자동 채택하지 않습니다. 상태를 확인하고 ci_runner.sh down 후 up으로 전환하세요."
    fi
    if [ "$state" != running ]; then
      idle
      case "$state" in
        ''|created|exited) compose up -d --no-recreate runner >/dev/null ;;
        *) fail "$NAME 상태가 $state 입니다. 상태를 확인한 뒤 다시 실행하세요." ;;
      esac
    fi
    configured="$(docker exec "$NAME" bash -c 'if [ -f .runner ]; then echo yes; else echo no; fi')"
    case "$configured" in yes|no) ;; *) fail "$NAME 등록 파일 상태를 확인하지 못했습니다." ;; esac
    if [ "$configured" = yes ] && [ -n "$id" ]; then
      echo "$NAME 이미 등록되어 실행 중입니다."
      exit 0
    fi
    idle
    if [ "$configured" = yes ]; then
      disposable
      idle
      [ -z "$id" ] || fail "GitHub 등록 상태가 바뀌었습니다. up을 다시 실행하세요."
      echo "ci_runner: GitHub 등록이 없고 고정 CI 이미지·마운트 0인 임시 runner를 재생성합니다."
      compose rm -s -f runner >/dev/null
      compose up -d --no-recreate runner >/dev/null
    fi
    idle
    token="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
    [ -n "$token" ] && [ "$token" != null ] || fail "등록 토큰을 받지 못했습니다."
    idle
    # 표준입력으로 전달해 Compose 설정, 컨테이너 환경과 호스트 명령줄에 토큰을 남기지 않는다.
    printf '%s\n' "$token" | docker exec -i "$NAME" bash -c \
      'IFS= read -r RUNNER_TOKEN; exec ./config.sh --unattended --url "$1" --token "$RUNNER_TOKEN" --name "$2" --labels "$2" --replace' \
      bash "https://github.com/$REPO" "$LABEL"
    unset token
    echo "$NAME 시작. 'scripts/ci_runner.sh status'로 online을 확인하세요."
    ;;
  down)
    idle
    container_info
    if [ -n "$state" ]; then
      [ -z "$project" ] || { [ "$project" = orbit-ci ] && [ "$service" = runner ]; } || fail "$NAME 은 다른 Compose 프로젝트 소속입니다."
      disposable
    fi
    idle
    [ -z "$id" ] || gh api -X DELETE "repos/$REPO/actions/runners/$id"
    if [ -n "$state" ] && [ -z "$project" ]; then
      docker rm -f "$NAME" >/dev/null
    fi
    compose down >/dev/null
    echo "$NAME 제거, GitHub 등록 해제"
    ;;
  status)
    container_info
    if [ -n "$state" ]; then
      echo "$NAME $state compose=${project:-standalone}"
    else
      echo "$NAME 컨테이너 없음"
    fi
    registration
    if [ -n "$id" ]; then
      echo "$LABEL $status busy=$busy"
    else
      echo "$LABEL GitHub 등록 없음"
    fi
    ;;
  *)
    echo "사용법: $0 up|down|status" >&2
    exit 2
    ;;
esac
