<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-17 | Updated: 2026-11-17 -->

# 운영·검증 스크립트

로컬 검증, Mac 배포·복구, QM 연결과 운영 상태 확인의 진입점이다.

## 주요 파일

| 파일 | 역할 |
|---|---|
| `ci_gate.sh` | 커밋된 REF를 임시 사본으로 검사하는 CI 공통 게이트 |
| `ci_runner.sh` | Docker 기반 GitHub Actions 셀프호스트 러너 등록·기동·제거 |
| `deploy.sh` | CI를 확인하고 이미지·마이그레이션·헬스체크를 거쳐 배포 |
| `backup.sh` | Orbit·QM DB와 QM 볼륨·상태를 백업하고 오래된 백업 삭제 |
| `restore_drill.sh` | 백업을 임시 DB에 복원해 운영 DB의 테이블·행 수와 비교 |
| `watchdog.sh` | 컨테이너 상태와 수집 지연 기록, 중지된 컨테이너 재시작, 백업 |
| `qm.sh` | `qm/`의 고정 버전 CLI를 외부 `qm.env`와 함께 실행 |
| `qm_register.sh` | QM 관리자 API에 Orbit MCP 서버 등록 |
| `status.sh`, `logs.sh` | 배포·컨테이너·러너 상태와 로그 조회 |
| `eval_router.ts` | fixture로 규칙 라우터 정확도·지연·예측 경로 비율 평가 |

## 하위 디렉터리

| 디렉터리 | 역할 |
|---|---|
| [mac/](mac/AGENTS.md) | launchd 설치와 주기 실행 진입점 |
| [probe/](probe/AGENTS.md) | 실제 Slack·QM·Orbit 연결 및 샘플 흐름 확인 |

## 작업과 검증

- `ci_gate.sh [REF]`는 기본 `HEAD`를 `git archive`한 사본만 검사하므로 미커밋 변경은 직접 검증한다. 셸 구문, 의존성 설치, 타입·lint·테스트, audit, QM check, gitleaks를 실행하며 Docker Compose가 있으면 설정도 확인한다. npm과 gitleaks 다운로드 등 네트워크 접근이 발생할 수 있다.
- 셸 수정은 해당 파일의 `bash -n`으로 구문을 확인한다. 라우터 평가 변경은 `npm run eval:router`와 `test/eval-router.test.ts`를 참고한다. 평가는 fixture의 `hold`·`simple` 비율을 계산하며 네트워크와 DB를 사용하지 않는다.
- 배포는 기본적으로 main 조상 커밋의 GitHub `gate` 성공을 요구한다. `ORBIT_DEPLOY_FORCE=1`은 게이트와 실패 기록 확인을 건너뛰며, 헬스 실패 시 이전 이미지를 다시 올려도 DB를 자동 복원하지 않는다. 마이그레이션 전 백업·사본 리허설과 `selfcheck`의 순서를 유지한다.
- `backup.sh`는 오래된 백업을 삭제하고 `qm-state.json`에 QM DB 비밀번호가 들어갈 수 있다. `restore_drill.sh`는 운영 DB를 읽고 같은 서버의 `orbit_drill`, `qm_drill` DB를 생성·삭제한다. `qm_register.sh`, `qm.sh`와 `ci_runner.sh`는 인자에 따라 실제 설정·서비스를 바꾼다.

## 의존 관계

- 내부: `compose.yaml`, `Dockerfile`, `qm/`, `fixtures/`, `src/`와 [운영·복구 문서](../docs/AGENTS.md)를 사용한다. [CI workflow](../.github/workflows/AGENTS.md)는 `ci_gate.sh`를 호출하고 배포기는 해당 `gate` 결과를 읽는다.
- 외부: Docker, GitHub·`gh`, Node·npm, Postgres, QM과 Slack에 의존한다. 운영 설정과 인증정보는 기본적으로 저장소 밖 `ORBIT_HOME`에 있다.

<!-- MANUAL: 수동 추가 내용은 재생성 시 보존한다. -->
