# 구조

Orbit은 QM 옆에서 Slack 메시지를 수집하고 분류해, QM 에이전트가 조사하고 브리핑할 재료를 제공한다. QM은 대화와 에이전트 실행을, Orbit은 업무 데이터와 판단을 맡는다.

## 흐름

```text
Slack API ──(User 토큰, 읽기 전용)──> orbit-collector ──> orbit-pg
                                                           │
                              orbit-api (30초마다 규칙 분류) ┤
                                 │  POST /mcp        조사, 분석 제출, 브리핑 기록
                                 │  POST /decisions  실행 경로 판단
                                 │  webhook          긴급 알림 (alert_id 와 permalink 만)
                                 ▼
Slack DM <──(Bot 토큰, Socket Mode)── QM core (Codex 구독) ──> qm-orbit-pg
```

## 컨테이너

| 컨테이너 | 하는 일 | 갖는 비밀값 |
|---|---|---|
| `qm-orbit-core` | Slack 대화, 에이전트 턴, cron, 기억 | Slack Bot 토큰, Codex 로그인 |
| `qm-orbit-pg` | QM 세션, 기억, 설정 | |
| `orbit-collector` | 채널 발견, 수집, 대조, 보존 삭제 | Slack User 토큰 |
| `orbit-api` | 분류, MCP 도구, 라우터, 긴급 알림 | API 토큰, webhook 서명 키, OpenRouter 키(선택) |
| `orbit-pg` | 원문과 업무 지식 | |
| `orbit-runner` | GitHub Actions CI | 없음. 호스트 폴더와 docker.sock 을 마운트하지 않는다. 공개 저장소라 PR 생성은 Collaborators only, 포크 PR 실행은 승인 필수로 둔다 |

Orbit 컨테이너와 QM 컨테이너는 Docker 네트워크 `qm-orbit`에서 만난다. `orbit-pg`는 그 네트워크에 붙지 않는다. Orbit은 호스트 포트를 열지 않는다.

## QM을 고치지 않고 붙이는 지점

- `qm/`은 `@yc-software/qm`을 정확한 버전으로 고정한 배포 디렉터리다. 올릴 때는 `qm/package.json`만 바꾸는 PR을 따로 낸다.
- MCP: `scripts/qm_register.sh`가 `http://orbit-api:8787/mcp`를 `attestActor`로 등록한다. QM은 주인의 개인 대화에서만 도구를 내주고 `x-qm-actor`로 호출자를 알려 준다. Orbit은 그 값이 `ORBIT_OWNER_PRINCIPAL`일 때만 `tools/call`에 답한다.
- 사설 주소 허용: `qm.config.jsonc`의 `PRIVATE_NETWORK_ALLOWED_ORIGINS`.
- 실행 경로: QM decision rule(`turn_start`)이 `POST /decisions`를 부른다.
- 긴급 알림: QM webhook(`hmac-sha256`)을 Orbit이 호출한다.
- sandbox: core는 `SANDBOX_BACKEND` 없이는 뜨지 않는다. `env.core.SANDBOX_BACKEND=local`만 두고 `sandbox` 블록을 빼서 core에 docker.sock을 주지 않는다. 그래서 에이전트의 `execute`와 QM 스킬은 쓰지 않는다. Orbit의 지침은 cron과 webhook의 `task`, MCP 도구 설명에 둔다.

## 데이터

- 원문: `channels`, `messages`, `sync_state`(채널마다 수집이 끝난 구간 하나).
- 분석: `classifications`(규칙), `knowledge_items`와 `knowledge_evidence`(AI 제출물과 근거 permalink), `briefings`, `alerts`.
- 운영: `collector_hourly`, `router_decisions`, `jev_usage`.
- 스키마는 `migrations/`에 추가만 한다. 한 배포의 마이그레이션은 트랜잭션 하나로 적용한다.

## 모델로 나가는 데이터

`src/policy.ts`의 `forModel` 하나가 MCP 응답의 모든 메시지를 만든다. 샘플 채널은 항상, 실제 채널은 `ORBIT_ANALYZE_REAL_DATA=true`이고 `ORBIT_ANALYZE_CHANNELS`에 있을 때만 원문이 나간다. 그 밖에는 `channel_id`, `ts`, `permalink`, `redacted`만 나간다. webhook 본문은 `alert_id`와 `permalink`뿐이다. Jev로 가는 본문도 같은 기준을 지난다.

## Decision Router

- 메시지 분류(`src/classify.ts`): 규칙이 관련성, 중요도, 긴급도, 신규, 충돌, 추가 조사, 주인 응답 대기, 경로(`notify_now`, `briefing`, `hold`)를 정한다. `hold`는 AI 분석으로 넘어가지 않는다.
- 실행 경로(`src/router.ts`): 요청 문장으로 `simple`, `standard`, `complex`를 고른다. 모델과 effort는 QM decision rule의 선택지에 적고, QM이 자기 모델 카탈로그와 대조한다.
- `ORBIT_ROUTER_MODE`: `off`는 규칙만, `shadow`는 규칙 결과를 쓰고 Jev 답을 기록만, `active`는 Jev가 1위 0.6 이상이고 2위와 0.2 이상 차이 날 때만 Jev 결과를 쓴다.
- Jev 요청은 `ORBIT_JEV_ENABLED=true`, 예산 0 초과, 키 있음, 오늘 사용액이 예산 미만일 때만 나간다. 기본값에서는 0건이다.

## 배포

launchd 작업 `com.yeumgw.orbit.deploy`가 300초마다 `scripts/deploy.sh --auto`를 실행한다. CI check-run `gate`가 success인 main 커밋만 올린다. 순서는 이미지 빌드, (마이그레이션이 있으면) 백업과 사본 리허설과 적용, `selfcheck`, 교체, 헬스체크다. 헬스체크가 실패하면 이전 이미지로 되돌린다. CI 러너는 배포 권한을 갖지 않는다.
