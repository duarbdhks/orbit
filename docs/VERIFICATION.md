# 검증 결과

2026-11-17 기준이다. "실환경"은 이 Mac에서 실제로 실행해 본 것, "Mock"은 가짜 Slack 서버나 모의 응답으로 테스트한 것, "미검증"은 사용자 인증이 필요해 실행하지 못한 것이다.

## 완료 기준

| 기준 | 구분 | 결과와 근거 |
|---|---|---|
| 1 비공개 저장소 | 실환경 | `gh api repos/duarbdhks/orbit --jq .private`가 `true` |
| 2 QM 로컬 실행 | 실환경 | `/healthz` 200 (18080, 18082). `qm-orbit-core`, `qm-orbit-pg` 실행 중 |
| 3 Codex 구독 인증 | 미검증 | ChatGPT device 로그인 필요. 모델 API 키 없이 기동하는 것까지 확인 |
| 4 Slack DM 응답 | 미검증 | QM 봇 Slack 앱 설치 필요 |
| 5 채널 조회 | Mock | 가짜 Slack 서버로 발견과 수집을 검증. 실제 조회는 `scripts/probe/slack.sh`로 한다 |
| 6 수집, 저장, 재시도 | Mock | `test/collector.test.ts` 10건. 재실행 시 행 동일, 과거 수집 재개, 3일 공백 복구, 수정과 삭제, 스레드, 429 재시도, 접근 상실, 보존 삭제 |
| 7 AI 분류와 브리핑 | 실환경 + 모의 응답 | 배포된 스택에 샘플 30건을 넣자 30초 안에 분류됐다(긴급 5, 브리핑 12, 보류 13). 분석 대기 17건에 모의 AI 응답을 제출해 지식 항목 6건과 permalink, "내 스레드" 초안이 든 브리핑을 받았다 (`scripts/probe/sample_e2e.mjs`). 모델이 만든 분석과 DM 전달은 미검증 |
| 8 Jev Router 정책과 비용 차단 | Mock | `test/jev.test.ts`, `test/router.test.ts`. 꺼짐, 예산 0, 키 없음, 예산 소진에서 fetch 0회. `off`, `shadow`, `active` 응답과 기록 |
| 9 CI 러너 online | 실환경 | `orbit-ci-mac online`. 컨테이너 `orbit-runner`, 호스트 마운트 없음 |
| 10 PR Gate | 실환경 | PR 1, 3~9의 `gate` 통과. 일부러 깨뜨린 PR 2는 lint와 test에서 실패 |
| 11 main 자동 배포 | 실환경 | launchd가 사람 손 없이 `20a5fbc`(16:04:37)와 `7863637`(16:10:12)을 배포. 병합 뒤 5분 안 |
| 12 롤백과 데이터 보존 | 실환경 | 아래 훈련 4건 |

## 배포 훈련

| 훈련 | 한 일 | 결과 |
|---|---|---|
| 헬스체크 실패 | 시작하자마자 죽는 API 커밋을 배포 | `rolled-back` 기록, 종료 코드 1, 이전 이미지로 복귀해 healthy. 12개 테이블 행 수와 `messages` 체크섬이 훈련 전과 같음 |
| 마이그레이션 실패 | 둘째 문장이 틀린 `002`를 배포 | 사본 리허설에서 걸려 `failed:rehearsal`. 같은 이미지로 운영 DB에 직접 적용해도 오류로 끝나고 첫 문장의 컬럼도 남지 않음(컬럼 86개, 체크섬 동일) |
| 일시적 실패 | mirror 주소를 닿지 않는 곳으로 바꾸고 3회 실행 | `transient:fetch` 3회, `state/failed`는 그대로(4줄), 3회째에 `state/blocked` 기록. 주소를 되돌리자 보류 기록이 지워짐 |
| 복원 | `scripts/restore_drill.sh` | Orbit DB 12개 테이블, QM DB 162개 테이블의 행 수가 운영 DB와 같음. coredata tar 항목 533개 |

첫 배포는 두 번 실패했고 둘 다 교체 전에 걸렸다. compose 파일의 YAML 오류(`failed:postgres`)와 릴리스 트리 권한(`failed:pending`)이다. 각각 PR 5와 PR 6으로 고쳤다.

## 그 밖에 측정한 것

- watchdog: `orbit-collector`를 멈추자 다음 실행에서 `restarted`로 올리고 `state/health.json`에 기록했다.
- 메모리: QM, Orbit, 러너 컨테이너 6개 합계 약 920MiB (Docker VM 7.75GiB).
- `npm run eval:router`: 실행 경로 41건 정확도 0.927, 메시지 경로 26건 정확도 1.0, AI 분석 제외 비율 0.385, 지연 p95 0.1ms 미만. 예시를 규칙과 같은 손으로 썼으므로 낙관적인 값이다. 실제 요청으로 다시 재야 한다.
- 추가 비용: 0원. 유료 API 키를 어디에도 넣지 않았고 Jev 호출은 0건이다(`jev_usage` 0행).

## 아직 재지 않은 것

- 긴급 알림 종단 지연(기준: 수집 지연 P95 330초, 종단 P95 450초). 실제 Slack과 QM webhook이 연결된 뒤 테스트 채널에 20건을 올려 잰다. 한계 요인은 수집 주기 300초다.
- 절전 복구와 재부팅 뒤 자동 시작. 시계가 3일 건너뛴 경우의 수집 복구는 테스트로만 확인했다.
- QM core의 amd64 에뮬레이션에서의 턴 지연.
- 채널 멘션 응답, 승인 후 게시, 주입 문구에 대한 모델의 반응.
