<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-17 | Updated: 2026-11-17 -->

# 샘플과 평가 입력

가상의 Slack 대화와 AI 응답, 규칙 분류기와 runtime 라우터의 정답 예시를 보관한다.

## 주요 파일

| 파일 | 역할 |
|---|---|
| `sample-slack.json` | 채널 3개와 메시지 30개; 스레드, 중복, 장애, 결정 변경, 주입 문구 포함 |
| `ai-responses.json` | 샘플 메시지를 근거로 한 `valid`, `schema_violation`, `injection` 분석 제출물 |
| `classify-eval.json` | 메시지 `input`과 예상 route `notify_now`·`briefing`·`hold` 쌍 |
| `router-eval.json` | `runtime` 요청과 예상 tier `simple`·`standard`·`complex` 쌍 |

## 작업과 검증

- `src/sample.ts`가 샘플 채널과 메시지를 적재한다. `ai-responses.json`의 `evidence`·`analyzed`는 샘플의 `channel_id`와 `ts`를 참조하므로 식별자나 스레드를 바꾸면 `mcp.test.ts`, `briefing.test.ts`, `research.test.ts`의 고정 기대값도 확인한다. `schema_violation`과 `injection`은 각각 거부와 데이터 취급을 검증하는 의도적인 사례다.
- `npm run eval:router`는 DB나 네트워크 없이 두 평가 파일을 실행한다. classify 평가는 소유자 `UOWNER`, 작성자 `U`, 중복·스레드 관련 조건 모두 `false`인 고정 맥락을 사용한다.
- 결과의 `accuracy`는 예상 라벨과 일치한 비율이고, `by_label`은 예측 라벨별 개수다. `p50_ms`·`p95_ms`는 예시별 실행 시간의 nearest-rank 백분위다. `analysis_skipped`와 `low_effort_turns`는 각각 예측된 `hold`와 `simple` 비율이며 실제 AI 호출 수나 비용 측정값은 아니다.
- 평가 예시를 바꾸면 `npm test -- test/eval.test.ts test/eval-router.test.ts`로 정확도와 예시 수 기준을 확인한다. 샘플이나 AI 응답을 바꾸면 관련 MCP·브리핑·샘플 적재 테스트도 확인한다.

## 의존 관계

- 내부: `src/sample.ts`와 `test/`가 샘플을, `scripts/eval_router.ts`가 `src/eval.ts`, `src/classify.ts`, `src/router.ts`를 통해 평가 예시를 사용한다. `scripts/probe/sample_e2e.mjs`도 `valid` 응답을 사용하지만 실행 중인 Orbit API에 제출하는 운영 probe다.
- 외부: fixture 자체는 JSON이며, 평가 스크립트는 외부 서비스에 요청하지 않는다.

<!-- MANUAL: 수동 추가 내용은 재생성 시 보존한다. -->
