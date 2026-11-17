# Orbit

QM 위에서 동작하는 Slack 개인 AI 비서입니다. 접근 가능한 Slack 채널을 수집하고, 규칙과 AI로 분석한 뒤, DM으로 답하고 브리핑합니다.

로컬 Mac에서 Docker로 실행하며 추가 유료 서비스를 쓰지 않습니다.

| 문서 | 내용 |
|---|---|
| `docs/ARCHITECTURE.md` | 구성 요소, 데이터 흐름, QM과 붙는 지점 |
| `docs/LOCAL_RUN.md` | 설치, 사용자가 해야 하는 연결, 일상 명령 |
| `docs/DATA_POLICY.md` | 수집 범위, 보존과 삭제, 모델 전송 |
| `docs/RECOVERY.md` | 백업, 복원, 되돌리기 |
| `docs/VERIFICATION.md` | 완료 기준별 검증 결과와 미검증 항목 |
| `docs/SPIKE.md` | QM 기술 검증 결과 |
| `BACKLOG.md` | v1에서 하지 않은 것과 꺼내는 조건 |

개발 지침은 `AGENTS.md`에 있습니다. 커밋 전에 `scripts/ci_gate.sh`를 실행합니다.
