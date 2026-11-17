# 모듈: router (Decision Router와 Jev)

공통 지시는 `briefs/common.md`다. 먼저 읽는다.

- worktree: `/Users/yeumgw/develop/orbit-wt/router`
- item 파일: `/Users/yeumgw/develop/orbit/artifacts/graph-orchestrator/20261117-1530/items/router.json`
- 소유 파일: `src/jev.ts`, `src/router.ts`, `src/eval.ts`, `src/db/router.ts`, `fixtures/router-eval.json`, `test/jev.test.ts`, `test/router.test.ts`, `test/eval.test.ts`

## 하는 일

비용, 속도에 맞춰 판단 경로를 고른다. 기본은 무료 규칙이다. Jev(OpenRouter의 유료 판단 모델)는 명시적으로 켜고 예산을 줬을 때만 부른다. 기본값에서 유료 요청은 0건이어야 한다.

## 인터페이스 (이 이름과 모양을 지킨다)

```ts
// src/jev.ts
export const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODEL = "typesafe/jev-1.14";
export type JevQuestions = Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }>;
export interface JevResult { answers: Record<string, { choice: string; probabilities: Record<string, number> }>; costUsd: number; inputTokens: number }
export function createJev(db: Db, config: Config, fetchImpl?: typeof fetch): { decide(state: unknown, questions: JevQuestions, now?: Date): Promise<JevResult | null> };
export function confident(probabilities: Record<string, number>): boolean;   // 1위 0.6 이상이고 1위와 2위 차이 0.2 이상

// src/router.ts
export function tierOf(input: string): { tier: "simple" | "standard" | "complex"; reasons: string[]; flags: { parallel: boolean; web_search: boolean; more_analysis: boolean; cache_reuse: boolean } }; // 순수 함수
export function registerDecisions(app: FastifyInstance, db: Db, config: Config, jev: ReturnType<typeof createJev>): void;   // POST /decisions
export function createAdvise(db: Db, config: Config, jev: ReturnType<typeof createJev>): (message: Message, rules: Classification) => Promise<Classification>;

// src/eval.ts
export function evaluate<T>(examples: { input: T; expected: string }[], predict: (input: T) => string | Promise<string>): Promise<{ total: number; accuracy: number; p50_ms: number; p95_ms: number; by_label: Record<string, number> }>;
```

## Jev 클라이언트 (`createJev`)

- 다음 중 하나라도 해당하면 `fetch`를 부르지 않고 null을 돌려준다: `ORBIT_JEV_ENABLED`가 false, `ORBIT_JEV_DAILY_BUDGET_USD`가 0, `OPENROUTER_API_KEY`가 빈 값, 오늘(KST) `jev_usage.cost_usd`가 예산 이상.
- 요청: `POST JEV_URL`, `Authorization: Bearer <키>`, 본문 `{ model: JEV_MODEL, state, questions }`. 재시도하지 않는다. 10초 타임아웃. 리다이렉트를 따르지 않는다.
- 응답 검증(zod): `answers`가 질문 id와 정확히 같고, 각 답의 `type`이 `choice`, `probabilities`의 키가 `criteria`와 같고 값이 0~1, 합과 1의 차이가 0.05 이하, `choice`가 최대 확률 라벨이어야 한다. 어긋나면 null.
- 비용: 응답의 `usage.cost`(USD)를 쓰고, 없으면 `usage.input_tokens * 0.042e-6`. 성공이든 검증 실패든 HTTP 응답을 받았으면 `jev_usage`의 오늘(KST) 행에 호출 수, 비용, 토큰을 더한다. 네트워크 오류는 null.
- 키, 요청 본문, 응답 본문을 로그에 남기지 않는다.

## 실행 경로 라우팅 (`POST /decisions`)

QM의 decision rule이 `turn_start`에서 이 주소를 부른다. QM `decisions` 프로토콜이다.

- 인증: `Authorization: Bearer <ORBIT_API_TOKEN>`(시간 일정 비교). 아니거나 설정값이 비면 401.
- 요청: `{ model: string, input: string, questions: [{ type: "choice", name: string, instructions: string, choices: [{ value: string, description: string }] }] }`.
- 응답: `{ answers: [{ name, type: "choice", choice, probabilities: [{ value, probability }] }] }`. 질문마다 답 하나, 확률 합 1.
- 규칙 판단: `tierOf(input)`. 인사나 짧은 조회는 `simple`, 조사, 비교, 분석, 충돌, 검증, 원인 같은 말이 있거나 긴 요청은 `complex`, 나머지는 `standard`. 질문의 `choices`에 그 값이 있으면 거기에 확률 0.9를 주고 나머지에 0.1을 고르게 나눈다. 없으면 `standard`, 그것도 없으면 첫 선택지에 준다.
- `flags`(병렬, 웹 검색, 추가 분석, 캐시 재사용)는 키워드로 판단해 기록만 한다.
- `ORBIT_ROUTER_MODE`:
  - `off`: 규칙만 쓴다. Jev를 부르지 않는다.
  - `shadow`: 규칙 결과를 돌려준다. Jev도 물어 그 답을 `router_decisions.shadow`에 남긴다(Jev가 null이면 shadow도 null).
  - `active`: Jev 답이 `confident`면 Jev의 확률을 돌려주고 `source = 'jev'`, 아니면 규칙 결과.
- 호출마다 `router_decisions`에 한 행: `kind = 'runtime'`, `mode`, `source`, `input_ref`(입력의 SHA-256 hex, 원문 금지), `decision`(tier와 flags), `shadow`, `reasons`, `latency_ms`, `cost_usd`, `input_tokens`.

## 분류 조언 (`createAdvise`)

- 규칙 분류 결과 `rules`를 받아 최종 `Classification`을 돌려준다. `off`면 `rules` 그대로이고 기록도 하지 않는다.
- `shadow`와 `active`에서는 Jev에 `route` 질문 하나(선택지 `notify_now`, `briefing`, `hold`, 각 뜻을 criteria로)를 묻는다. state는 메시지 본문과 채널 id다. Jev가 null이면 `rules` 그대로다.
- `shadow`: `rules`를 돌려주고 Jev 답을 `shadow`에 남긴다. `active`: `confident`면 `route`만 Jev 값으로 바꾸고 `reasons`에 `jev`를 더한다.
- `router_decisions`에 `kind = 'classify'`로 기록한다. `input_ref`는 `<channel_id>:<ts>`다.

## 평가 (`evaluate`, `fixtures/router-eval.json`)

- `fixtures/router-eval.json`: `{ "runtime": [{ "input": "...", "expected": "simple|standard|complex" }] }`, 한국어 요청 40건 안팎.
- `evaluate`는 예시마다 `predict`를 재서 정확도, 지연 p50과 p95, 라벨별 예측 수를 돌려준다.

## 테스트 (`fetch`는 주입한 가짜를 쓴다. 실제 네트워크 금지)

- 비용 차단: 꺼짐, 예산 0, 키 없음, 예산 소진 각각에서 가짜 fetch가 한 번도 불리지 않는다. 켜고 예산과 키가 있으면 한 번 불리고 `jev_usage`가 오른다.
- 잘못된 응답(모르는 라벨, 확률 합 어긋남, choice가 최대가 아님, HTTP 500)은 null이고 규칙 결과로 간다.
- `confident` 경계값.
- `/decisions`: 토큰 없으면 401. `off`, `shadow`, `active` 각각의 응답과 `router_decisions` 행. `shadow`에서 Jev 답이 달라도 응답은 규칙 결과다. 선택지에 tier 이름이 없을 때의 처리.
- `createAdvise`: 세 모드의 반환값과 기록.
- `evaluate(runtime 예시, tierOf)`의 정확도가 0.8 이상이다.
- `selfcheck(db, SQL)`이 통과한다.
