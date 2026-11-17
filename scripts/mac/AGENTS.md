<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-17 | Updated: 2026-11-17 -->

# Mac launchd 연동

배포기와 watchdog을 Mac 로그인 세션에서 주기적으로 실행한다.

## 주요 파일

| 파일 | 역할 |
|---|---|
| `service.sh` | 환경 파일·mirror·첫 배포를 준비하고 launchd 작업 설치·제거·조회 |
| `agent.sh` | Node·Docker·`gh` 경로를 설정하고 배포기 또는 watchdog 실행 |
| `orbit-deploy` | launchd가 실행하는 배포 진입점 |
| `orbit-watchdog` | launchd가 실행하는 watchdog 진입점 |

## 작업과 검증

- `service.sh install`은 `com.yeumgw.orbit.deploy`와 `com.yeumgw.orbit.watchdog` plist를 생성한다. 둘 다 `RunAtLoad`와 300초 주기를 사용하고 `ORBIT_HOME/current/scripts/mac/`의 진입점을 가리킨다. `current`는 성공한 배포가 갱신하는 링크다.
- `agent.sh`는 `.node-version`에 맞는 nvm 경로를 사용한다. Docker가 준비되지 않으면 Docker Desktop을 열고 종료하며, 다음 주기에 다시 실행된다.
- `install`은 파일·비밀값·Git mirror·배포·launchd 상태를 바꾼다. `uninstall`은 launchd 작업과 plist만 제거하고 컨테이너와 데이터는 둔다. 셸 변경은 `bash -n`으로 구문을 확인하고 실제 설치·재시작 여부는 별도로 구분한다.
- `ci_gate.sh`의 Mac 셸 검사 대상은 `scripts/mac/*.sh`와 `scripts/mac/orbit-*`다. 새 실행 파일이 이 패턴에 포함되는지 확인한다.

## 의존 관계

- 내부: `service.sh`는 `.env.example`과 `scripts/deploy.sh`를, 두 진입점은 `agent.sh`와 `scripts/deploy.sh` 또는 `scripts/watchdog.sh`를 사용한다. 설치 순서와 복구는 [LOCAL_RUN.md](../../docs/LOCAL_RUN.md), [RECOVERY.md](../../docs/RECOVERY.md)를 참조한다.
- 외부: macOS launchd, Docker Desktop, GitHub 인증 `gh`, Git과 `.node-version`의 Node가 필요하다. 배포기는 GitHub Actions의 `gate` 결과에도 의존한다.

<!-- MANUAL: 수동 추가 내용은 재생성 시 보존한다. -->
