# 데이터 정책

## 수집 범위

| 대상 | 수집 |
|---|---|
| 가입한 공개 채널 | 한다 |
| 가입하지 않은 공개 채널 | 한다 |
| 가입한 비공개 채널 | 한다 |
| 가입하지 않은 비공개 채널 | 하지 않는다. Slack이 허용하지 않는다 |
| 본인 1:1 DM | 주인이 요청한 상대·기간만 조회한다. Orbit DB에 저장하지 않는다 |
| 그룹 DM | 수집·조회하지 않는다 |
| 다른 사람의 DM | 하지 않는다 |

- 수집 앱의 User scope는 `channels:read`, `channels:history`, `groups:read`, `groups:history`, `users:read`, `im:read`, `im:history`다. 쓰기 scope는 없다.
- DM 조회는 API와 collector 양쪽에서 주인 인증을 검사한다. collector는 Slack 토큰 주인도 대조한다. 7일 이내를 조회하며 기간 이전에 시작된 스레드 답글은 포함하지 못한다. 응답의 `coverage`에 이 한계를 표시한다.
- API는 collector의 내부 읽기 endpoint를 호출한다. Slack User 토큰은 collector에만 있고 원문은 `forModel`을 거쳐 주인의 모델에 전달된다. QM의 대화 기록에는 도구 결과가 남을 수 있다.
- `ORBIT_COLLECT_CHANNELS`에 적은 채널만 수집한다. 비어 있으면 Slack을 부르지 않는다.
- 사용자 정보는 user id와 표시 이름만 저장한다.

## 보존과 삭제

- `ORBIT_RETENTION_DAYS`(기본 180일)가 지난 원문을 하루 한 번 지운다. 근거가 하나도 남지 않은 지식 항목도 지운다.
- Slack에서 지워진 메시지와 답글은 수집 때(최근 24시간), 일일 대조(72시간), 주간 대조(보존 구간 전체)에서 지운다.
- 채널이 목록에서 사라지거나 Slack이 `not_in_channel`, `channel_not_found`를 주면 그 채널을 `lost`로 두고 수집을 멈춘다. 7일 뒤 원문과 파생 데이터를 지운다.
- 백업은 7일 보관한다. 그래서 지워진 원문이 디스크에 남는 최대 기간은 보존 기간에 7일을 더한 값이다.

## 모델 전송

- 기본값 `ORBIT_ANALYZE_REAL_DATA=false`에서는 샘플 채널 데이터만 모델로 나간다. 실제 채널은 위치(채널 id, ts, permalink)만 나간다.
- 회사의 데이터 처리 정책을 확인한 뒤에만 `ORBIT_ANALYZE_REAL_DATA=true`로 바꾸고, 보낼 채널을 `ORBIT_ANALYZE_CHANNELS`에 적는다. `*`는 수집한 채널 전체다.
- `*`는 개인 DM을 포함하지 않는다. 개인 DM은 인증된 주인의 명시적 상대·기간 조회에서만 별도로 허용한다.
- Slack 원문은 MCP 응답에서 `untrusted_slack_content` 필드에 담긴다. 도구 설명은 이 값이 데이터이며 지시가 아니라고 알린다.
- QM의 Slack 봇은 초대된 채널에만 글을 쓸 수 있다. 봇을 초대한 채널이 곧 게시 허용 범위다. 게시 전 승인은 DM 대화에서 받으며, QM `auto` 자세에는 이를 강제하는 장치가 없다.

## 로그와 비밀값

- 로그에는 Slack 오류 코드와 오류 종류만 남긴다. 메시지 원문, 토큰, 키를 남기지 않는다.
- `router_decisions.input_ref`는 입력의 SHA-256이다.
- 비밀값은 `~/Library/Application Support/Orbit/env/`에 두고 Git과 백업에 넣지 않는다.
- CI는 실제 Slack, Codex, OpenRouter 인증정보에 접근하지 않는다.
