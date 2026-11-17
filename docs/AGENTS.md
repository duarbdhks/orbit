<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-17 | Updated: 2026-11-17 -->

# 운영·설계 문서

Orbit의 구조, 실행·복구 방법, 데이터 정책과 당시 검증 근거를 모은다.

## 주요 파일

| 파일 | 역할 |
|---|---|
| `ARCHITECTURE.md` | QM·Orbit 경계, 데이터 흐름, 라우팅과 배포 구조 |
| `DATA_POLICY.md` | Slack 수집·보존·삭제와 모델 전송·비밀값 정책 |
| `LOCAL_RUN.md` | Mac 설치, 계정 연결, launchd와 일상 운영 절차 |
| `RECOVERY.md` | 백업 내용, 복원 훈련, DB·커밋·QM 복구 절차 |
| `SPIKE.md` | QM 0.1.18 기술 검증의 측정 결과와 미검증 항목 |
| `VERIFICATION.md` | 2026-11-17 실환경·Mock 결과와 배포 훈련·남은 검증 |

## 작업과 검증

- 동작·명령을 바꿀 때 해당 `src/`, `scripts/`, 설정과 대조하고 관련 문서 링크를 확인한다. 복구 명령은 운영 DB·컨테이너를 변경하므로 문서 확인과 실제 실행을 구분한다.
- 검증 기록은 날짜·환경과 실환경, 모의 응답, 미검증의 구분을 유지한다. `VERIFICATION.md`의 샘플 분석은 모의 응답이며 모델 분석과 DM 전달은 미검증이다. 긴급 알림 20건의 지연, 절전·재부팅 복구, 승인 후 게시와 cron 실행 등도 당시 미검증으로 기록돼 있다.
- `SPIKE.md`는 DM에서 MCP 도구 호출을 측정했지만 채널 멘션에서는 도구가 나오지 않았고, decision rule은 미검증으로 기록한다. 과거 결과를 현재 운영 상태로 단정하지 않는다.

## 의존 관계

- 내부: 구현은 `src/`, 테스트와 사례는 `test/`, `fixtures/`, 실행·복구는 [scripts/](../scripts/AGENTS.md)를 참조한다.
- 외부: QM, Slack, GitHub Actions, Docker와 선택적인 OpenRouter 연동의 관찰·설정을 다룬다.

<!-- MANUAL: 수동 추가 내용은 재생성 시 보존한다. -->
