# 복구

배포기는 운영 DB를 백업으로 자동 복원하지 않는다. 마이그레이션 실패는 트랜잭션 롤백으로, 헬스체크 실패는 이전 이미지로 끝난다. 아래는 사람이 판단해서 하는 복구다.

## 백업에 들어 있는 것

`scripts/backup.sh`가 `~/Library/Application Support/Orbit/backups/<시각>/`에 쓴다. launchd의 `com.yeumgw.orbit.backup`이 1시간마다 확인해 하루 한 번 실행하고, 배포기는 마이그레이션과 QM 변경 전에 실행한다. 두 DB가 모두 실행 중일 때만 완전한 백업을 만들고 7일 지난 백업을 지운다. DB 중지 중에는 기존 백업을 보존한다.

| 파일 | 내용 |
|---|---|
| `orbit.dump` | Orbit DB (`pg_dump -Fc`) |
| `qm.dump` | QM DB. 세션, 기억, cron, MCP 등록, 암호화된 로그인 |
| `coredata.tar` | QM 데이터 볼륨 `qm-orbit-coredata` |
| `qm-state.json` | QM CLI 상태. QM Postgres 비밀번호가 들어 있다 |

`env/`의 비밀값은 백업에 없다. 비밀번호 관리자에 따로 보관한다. `qm.env`의 `CONNECTOR_SECRET_KEY`를 잃으면 QM에 저장된 로그인을 다시 해야 한다.

## 백업이 복원되는지 확인하기

```bash
scripts/restore_drill.sh
```

가장 최근 백업을 임시 DB에 복원해 테이블 목록과 행 수를 운영 DB와 비교한다. 운영 DB는 건드리지 않는다.

## Orbit DB를 백업 시점으로 되돌리기

백업 뒤에 만든 분류, 지식 항목, 브리핑 기록, 라우터 기록을 잃는다. 원문은 Slack에 남아 있는 한 다시 수집된다.

```bash
scripts/mac/service.sh uninstall
docker stop orbit-api orbit-collector
docker exec orbit-pg psql -U orbit -d postgres -c "ALTER DATABASE orbit RENAME TO orbit_broken" -c "CREATE DATABASE orbit"
docker exec -i orbit-pg pg_restore -U orbit -d orbit --no-owner --exit-on-error < "<백업 디렉터리>/orbit.dump"
docker start orbit-api orbit-collector
scripts/mac/service.sh install
```

수집기는 복원된 `sync_state`부터 이어서 수집한다. 분류가 없는 메시지는 30초 안에 다시 분류된다. 확인이 끝나면 `orbit_broken`을 지운다.

## 특정 커밋으로 되돌리기

```bash
ORBIT_DEPLOY_REF=<커밋> scripts/deploy.sh
```

main에 있는 커밋만 받는다. 다음 자동 배포가 다시 main의 최신 커밋을 올리므로, 오래 유지하려면 main을 revert 한다.

## 실패로 기록된 커밋 다시 올리기

`state/failed`에 있는 커밋은 자동으로 다시 올리지 않는다. 원인을 고친 새 커밋을 main에 올리는 것이 기본이다. 같은 커밋을 다시 시도하려면 `ORBIT_DEPLOY_FORCE=1 scripts/deploy.sh`를 쓴다. gate 확인도 건너뛰므로 주의한다.

## QM 버전을 올렸다가 되돌리기

배포기는 QM 설정이나 운영 Compose가 바뀌면 백업을 뜨고 새 고정 이미지로 Compose를 갱신한다. 헬스체크에 실패하면 이전 릴리스의 Compose로 되돌린다. 이전 버전 core가 새 QM 스키마에서 뜨지 않으면 `qm.dump`로 QM DB를 되돌려야 하고, 백업 뒤의 QM 대화와 기억을 잃는다.

```bash
docker stop qm-orbit-core
docker exec qm-orbit-pg psql -U postgres -d postgres -c "ALTER DATABASE qm RENAME TO qm_broken" -c "CREATE DATABASE qm"
docker exec -i qm-orbit-pg pg_restore -U postgres -d qm --no-owner --exit-on-error < "<백업 디렉터리>/qm.dump"
scripts/qm.sh up
```
