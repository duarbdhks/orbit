# QM 기술 검증 (PR0)

QM `@yc-software/qm@0.1.18`, core 이미지 `sha256:988ce509…`(amd64), 2026-11-17, Apple Silicon Mac, Docker Desktop 29.7.2 기준이다. "측정"은 실제 실행 결과이고 "미검증"은 사용자 인증이 필요해 실행하지 못한 것이다.

## 결과

| 번호 | 확인 | 결과 | 근거 |
|---|---|---|---|
| 1 | QM 기동 | 통과 (측정) | `/healthz`가 18080과 18082에서 200. 메모리는 core 354~498MiB, pg 68~81MiB |
| 2 | Codex 구독 단독 | 일부 통과 (측정) | 사람이 보낸 턴(웹, DM, 채널 멘션)은 개인 ChatGPT 구독으로 응답한다. cron, webhook, 서브에이전트 턴은 조직 기본 모델을 써서 실패한다. 조직 자격은 API 키(Anthropic, OpenAI, OpenRouter)나 `CODEX_AUTH_CREDENTIAL`인데, 뒤쪽은 에이전트 sandbox가 있어야 만들 수 있다 |
| 3a | 소켓 없는 구성 | 통과 (측정) | docker.sock 없이 DM 턴, cron과 webhook 생성, webhook 수신이 동작한다. 에이전트 `execute`와 QM 스킬은 쓸 수 없다 |
| 3b | Colima 격리 | 실행 안 함 | 3a의 턴 검증이 실패하면 진행한다 |
| 4 | 포트 노출 | 열려 있음 (측정) | QM이 API 포트 18080을 모든 인터페이스에 게시한다. 인증 없는 `/v1/models`는 401. 웹 18082는 `127.0.0.1`만 |
| 5 | Slack 조회 | 통과 (측정) | 채널 530개. 전체 목록 조회 117회, 429 9회, 약 12분. 대상 채널만 조회하면 채널당 1회다 |
| 6 | 사설 MCP와 대상 제한 | 통과 (측정) | `scripts/qm_register.sh`로 `attestActor` 등록. 주인의 DM 턴에서 orbit 도구로 수집 상태를 받아 왔다. 채널 멘션 턴에는 도구가 나가지 않아 봇이 "orbit 도구가 없습니다"라고 답했다. core 컨테이너 안에서 토큰 없는 호출은 401이다 (`scripts/probe/qm_reach.sh`) |
| 7 | decision rule | 미검증 | 규칙을 등록하지 않았다. Orbit 쪽 `/decisions`는 테스트로 검증했다 |
| 8 | cron과 webhook | 일부 통과 (측정) | DM 요청으로 cron 3개와 webhook 1개를 만들었다. webhook은 서명 없는 요청에 401, Orbit이 보낸 서명 요청은 받아 턴을 시작한다. 턴 자체는 2번 때문에 실패한다 |

## 계획을 바꾼 사실

- core는 `SANDBOX_BACKEND` 없이는 부팅하지 않는다. 오류는 "SANDBOX_BACKEND must be set explicitly in production"이다 (측정). docker 타깃에서 무료 backend는 `local`뿐이다.
- docker.sock 마운트는 `sandbox.backend`가 `local`일 때만 붙는다 (0.1.18 CLI 코드). 그래서 `env.core.SANDBOX_BACKEND=local`만 두고 `sandbox` 블록을 뺐다.
- 이 Mac에는 `/var/run/docker.sock`이 없다 (측정). 공식 local sandbox로 바꾸려면 `DOCKER_HOST`를 지정해야 한다.
- Docker Desktop은 게시 포트를 `0.0.0.0`에 묶는다. 네트워크 옵션 `host_binding_ipv4`는 효과가 없었다 (측정).
- 관리자 로그인 링크는 주소의 `#token=`을 같은 출처의 POST로 보내야 세션이 생긴다. `Origin` 헤더가 없으면 403이다 (측정).
- `attestActor` 등록에는 `catalog: true`, 공유 자격, bearer 인증이 함께 필요하다 (0.1.18 코드와 등록 성공으로 확인).
- QM은 Slack 사용자를 프로필 이메일로 식별한다. DM 턴의 주체는 Slack 이메일이고 웹 관리자 이메일과 다르면 다른 사람이다. 이미 생긴 사용자는 `ADMIN_GRANTS`만으로 관리자가 되지 않아 관리자 화면에서 올렸다 (측정).
- 개인 구독(AI access)은 사람이 보낸 턴에만 쓰인다. 예약 실행과 webhook 턴은 조직 자격을 쓴다 (0.1.18 코드와 실패 로그로 확인).
- Ambient reply 기본값은 "Reply when useful"이다. 봇을 초대한 채널의 모든 글을 읽고 답할 수 있어 "Only when mentioned"로 바꿨다.
- hmac-sha256 webhook의 secret은 모델이 만든다. sandbox가 없으면 만들다 실패하므로 secret을 직접 만들어 넘긴다.
- 실제 Slack은 마지막 페이지에서 `response_metadata`에 `next_cursor` 없이 `warnings`만 준다 (측정).

## 남은 검증 순서

1. 조직 모델 자격을 정한다. 그 뒤 cron 3개를 다시 켜고 긴급 알림 20건을 잰다.
2. `turn_start` 결정 규칙을 `observe`로 등록한다.
3. 승인한 초안만 게시되는지, 주입 문구가 게시를 일으키지 않는지 본다.
