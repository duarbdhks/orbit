<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-17 | Updated: 2026-11-17 -->

# GitHub Actions

main 대상 변경을 셀프호스트 러너의 공통 게이트로 검사한다.

## 주요 파일

| 파일 | 역할 |
|---|---|
| `ci.yml` | main push·PR과 수동 실행에서 `gate` 작업을 실행 |

## 작업과 검증

- `gate`는 `[self-hosted, orbit-ci-mac]`에서 checkout과 `.node-version` 설정 후 `scripts/ci_gate.sh`를 실행한다. 같은 ref의 이전 실행은 취소한다. 외부 fork PR의 `gate` 작업은 조건으로 건너뛴다.
- 체크 이름 `gate`는 `scripts/deploy.sh`가 main 커밋의 성공 여부를 조회하는 계약이다. 이름이나 게이트 호출을 바꾸면 배포기와 함께 확인한다. 게이트는 커밋된 REF의 사본을 검사하므로 미커밋 수정은 직접 검증한다.
- Actions는 커밋 SHA로 고정되고 checkout 자격정보는 유지하지 않는다. CI는 Docker 소켓·호스트 폴더를 마운트하지 않은 러너 컨테이너에서 실행된다. fork PR 승인 정책 등 저장소 설정과 `scripts/ci_runner.sh`의 공개 저장소 보호 조건도 함께 확인한다.

## 의존 관계

- 내부: [scripts/ci_gate.sh](../../scripts/ci_gate.sh), [scripts/ci_runner.sh](../../scripts/ci_runner.sh), [scripts/deploy.sh](../../scripts/deploy.sh), `.node-version`을 사용한다.
- 외부: GitHub Actions와 `orbit-ci-mac` 셀프호스트 러너, 게이트의 npm·gitleaks 다운로드에 의존한다.

<!-- MANUAL: 수동 추가 내용은 재생성 시 보존한다. -->
