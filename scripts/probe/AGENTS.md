<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-17 | Updated: 2026-11-17 -->

# 운영 probe

실행 중인 Slack·QM·Orbit 환경의 연결과 샘플 분석 흐름을 확인한다.

## 주요 파일

| 파일 | 역할 |
|---|---|
| `slack.sh` | 수집용 User 토큰으로 채널 유형별 수 또는 지정 채널 history와 429 횟수 확인 |
| `qm_reach.sh` | QM core 컨테이너에서 Orbit MCP 인증·도구 목록 확인 |
| `sample_e2e.mjs` | 샘플 분류 뒤 모의 분석을 제출하고 브리핑·수집 상태 확인 |

## 작업과 검증

- `slack.sh`는 실제 Slack API를 호출한다. 채널 인자 없이 페이지를 순회하고 429에 30초 대기하며, 채널을 지정하면 history를 20회 호출한다. 메시지 본문 대신 집계·상태를 출력한다.
- `qm_reach.sh`는 컨테이너에서 MCP를 직접 호출해 토큰 없는 요청과 actor 없는 도구 호출의 401, 도구 8개를 확인한다. QM 대화 턴에서의 도구 호출 검증은 아니다.
- `sample_e2e.mjs`의 선행 `sample` 명령은 DB에 샘플을 넣고, 스크립트의 `submit_analysis`는 모의 지식과 분석 완료 상태를 저장한다. `claim_unanalyzed`에는 채널 필터가 없어 모델 전송이 허용된 실제 채널도 조회할 수 있으며 `list_knowledge`가 실제 미전달 지식을 출력할 수 있다.
- 셸 probe의 구문은 `bash -n`으로 확인한다. 실제 서비스에 접속하거나 상태를 쓰는 probe 결과는 로컬 모의 테스트와 구분한다. 측정 범위는 [SPIKE.md](../../docs/SPIKE.md)와 [VERIFICATION.md](../../docs/VERIFICATION.md)를 참조한다.

## 의존 관계

- 내부: `sample_e2e.mjs`는 `fixtures/ai-responses.json`, Orbit MCP의 `claim_unanalyzed`, `submit_analysis`, `list_knowledge`, `collector_status`를 사용한다.
- 외부: Slack API, 실행 중인 Docker의 `qm-orbit-core`·`orbit-api`, `ORBIT_HOME`의 토큰과 주인 식별 설정에 의존한다.

<!-- MANUAL: 수동 추가 내용은 재생성 시 보존한다. -->
