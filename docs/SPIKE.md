# QM 기술 검증 (PR0)

QM `@yc-software/qm@0.1.18`, core 이미지 `sha256:988ce509…`(amd64), 2026-11-17, Apple Silicon Mac, Docker Desktop 29.7.2 기준이다. "측정"은 실제 실행 결과이고 "미검증"은 사용자 인증이 필요해 실행하지 못한 것이다.

## 결과

| 번호 | 확인 | 결과 | 근거 |
|---|---|---|---|
| 1 | QM 기동 | 통과 (측정) | `/healthz`가 18080과 18082에서 200. 메모리는 core 354~498MiB, pg 68~81MiB |
| 2 | Codex 구독 단독 | 미검증 | ChatGPT device 로그인이 필요하다. 모델 API 키 없이 뜨는 것까지 확인했다. 관리자 API가 anthropic, openai, openrouter를 모두 `absent`로 보고한다 (측정) |
| 3a | 소켓 없는 구성 | 일부 통과 | `docker inspect qm-orbit-core`의 마운트는 `qm-orbit-coredata` 하나다. docker.sock 없음 (측정). DM 턴, cron, webhook은 미검증 |
| 3b | Colima 격리 | 실행 안 함 | 3a의 턴 검증이 실패하면 진행한다 |
| 4 | 포트 노출 | 열려 있음 (측정) | API 포트 18080이 `0.0.0.0`에 묶여 LAN IP로 200이 나온다. 인증 없는 `/v1/models`는 401. 웹 18082는 `127.0.0.1`만. macOS 방화벽은 꺼져 있다 |
| 5 | Slack 조회 | 미검증 | 수집용 토큰이 없다. `scripts/probe/slack.sh`를 준비했다 |
| 6 | 사설 MCP와 대상 제한 | 일부 통과 | `scripts/qm_register.sh`로 `attestActor` 등록 성공, QM이 카탈로그 도구 `orbit`를 보고한다 (측정). core 컨테이너에서 Orbit API로의 경로는 `scripts/probe/qm_reach.sh`로 확인한다. 턴 안에서의 호출과 채널 멘션에서의 미제공은 미검증 |
| 7 | decision rule | 미검증 | 규칙 등록과 호출은 모델이 연결된 뒤 확인한다. Orbit 쪽 `/decisions`는 테스트로 검증했다 |
| 8 | cron과 webhook | 미검증 | QM이 턴 안에서 만든다 |

## 계획을 바꾼 사실

- core는 `SANDBOX_BACKEND` 없이는 부팅하지 않는다. 오류는 "SANDBOX_BACKEND must be set explicitly in production"이다 (측정). docker 타깃에서 무료 backend는 `local`뿐이다.
- docker.sock 마운트는 `sandbox.backend`가 `local`일 때만 붙는다 (0.1.18 CLI 코드). 그래서 `env.core.SANDBOX_BACKEND=local`만 두고 `sandbox` 블록을 뺐다.
- 이 Mac에는 `/var/run/docker.sock`이 없다 (측정). 공식 local sandbox로 바꾸려면 `DOCKER_HOST`를 지정해야 한다.
- Docker Desktop은 게시 포트를 `0.0.0.0`에 묶는다. 네트워크 옵션 `host_binding_ipv4`는 효과가 없었다 (측정).
- 관리자 로그인 링크는 주소의 `#token=`을 같은 출처의 POST로 보내야 세션이 생긴다. `Origin` 헤더가 없으면 403이다 (측정).
- `attestActor` 등록에는 `catalog: true`, 공유 자격, bearer 인증이 함께 필요하다 (0.1.18 코드와 등록 성공으로 확인).

## 남은 검증 순서

1. ChatGPT device 로그인 뒤 웹 UI에서 한 턴을 돌린다. 2번과 3a의 턴 조건이 여기서 갈린다.
2. 같은 대화에서 "orbit 도구로 수집 상태를 알려 줘"를 요청한다. 6번이 갈린다. 401이면 `ORBIT_OWNER_PRINCIPAL`을 맞춘다.
3. Slack 앱 두 개를 설치한 뒤 `scripts/probe/slack.sh`와 DM 왕복을 확인한다.
4. DM에서 cron과 webhook을 만들고(`docs/LOCAL_RUN.md`) 7번과 8번을 확인한다.
5. 3a가 실패하면 3b(Colima)를 진행하고, 그것도 실패하면 멈추고 결정을 받는다.
