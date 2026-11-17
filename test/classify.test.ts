import assert from "node:assert/strict";
import { test } from "node:test";
import { type ClassifyContext, classify } from "../src/classify.ts";
import type { Message } from "../src/types.ts";

const OWNER = "UOWNER";
const base: ClassifyContext = {
  ownerUserId: OWNER,
  duplicate: false,
  threadStartedByOwner: false,
  ownerRepliedAfter: false,
};
const msg = (text: string, extra: Partial<Message> = {}): Message => ({
  channel_id: "C1",
  ts: "1794787500.000100",
  thread_ts: null,
  user_id: "UOTHER",
  user_name: "다른사람",
  text,
  posted_at: new Date("2026-11-16T00:05:00Z"),
  ...extra,
});
const reply = { thread_ts: "1794787200.000100" };

test("긴급 키워드가 있으면 긴급도 3으로 바로 알린다", () => {
  for (const text of ["결제 서버 장애로 주문이 실패합니다", "checkout outage, sev1 선언합니다"]) {
    const c = classify(msg(text), base);
    assert.equal(c.urgency, 3);
    assert.equal(c.route, "notify_now");
    assert.ok(c.reasons.includes("urgent"));
  }
});

test("다운로드는 다운 장애로 보지 않는다", () => {
  assert.notEqual(classify(msg("설치 파일 다운로드 링크입니다"), base).route, "notify_now");
});

test("결정 키워드가 있으면 브리핑으로 보낸다", () => {
  const c = classify(
    msg("다음 분기 가격 정책은 디자인 리뷰에서 B안으로 합의했고 이번 주에 문서를 정리해서 공유합니다"),
    base,
  );
  assert.equal(c.route, "briefing");
  assert.deepEqual(c.reasons, ["decision"]);
  assert.equal(c.needs_research, false);
});

test("변경 키워드는 충돌로 표시한다", () => {
  const c = classify(
    msg("어제 정한 회의 시간을 오후 세 시로 변경합니다. 참석자 모두 일정 다시 확인 부탁드립니다"),
    base,
  );
  assert.equal(c.conflicts, true);
  assert.equal(c.route, "briefing");
});

test("일정 키워드만 있으면 브리핑으로 보낸다", () => {
  const c = classify(msg("앱 심사 제출 마감은 다음 주 화요일 오전입니다"), base);
  assert.deepEqual(c.reasons, ["schedule"]);
  assert.equal(c.route, "briefing");
  assert.equal(c.conflicts, false);
});

test("리스크 키워드는 브리핑으로 보낸다", () => {
  const c = classify(msg("인증서 갱신이 늦어지면 blocker 가 됩니다"), base);
  assert.ok(c.reasons.includes("risk"));
  assert.equal(c.route, "briefing");
});

test("근거가 짧은 결정이나 변경은 추가 조사가 필요하다", () => {
  assert.equal(classify(msg("정산 개편 승인 났습니다."), base).needs_research, true);
  assert.equal(classify(msg("일정 연기됨"), base).needs_research, true);
});

test("인사, 이모지뿐인 글, 아주 짧은 잡담은 업무가 아니고 보류한다", () => {
  for (const text of ["안녕하세요!", "좋은 아침입니다~", ":tada: :tada:", "🎉🎉", "ㅋㅋㅋ", "점심 뭐 먹죠"]) {
    const c = classify(msg(text), base);
    assert.equal(c.work_related, false, text);
    assert.equal(c.route, "hold", text);
  }
});

test("키워드가 없는 업무 글은 업무로 보되 보류한다", () => {
  const c = classify(msg("모니터링 대시보드 링크를 다시 공유합니다."), base);
  assert.equal(c.work_related, true);
  assert.equal(c.route, "hold");
});

test("중복 메시지는 새 소식이 아니다", () => {
  assert.equal(classify(msg("배포 완료했습니다"), { ...base, duplicate: true }).is_new, false);
  assert.equal(classify(msg("배포 완료했습니다"), base).is_new, true);
});

test("주인을 부르거나 주인이 시작한 스레드에서 묻고 답이 없으면 주인을 기다린다", () => {
  assert.equal(classify(msg(`<@${OWNER}> 이 건 확인 부탁드립니다`), base).awaits_owner, true);
  const question = msg("2차 범위에 영상도 넣을까요?", reply);
  const c = classify(question, { ...base, threadStartedByOwner: true });
  assert.equal(c.awaits_owner, true);
  assert.equal(c.route, "briefing");
});

test("주인이 쓴 글, 주인이 이미 답한 글, 남의 스레드 질문은 주인을 기다리지 않는다", () => {
  const owner = { ...base, threadStartedByOwner: true };
  assert.equal(classify(msg(`<@${OWNER}> 메모`, { user_id: OWNER }), base).awaits_owner, false);
  assert.equal(
    classify(msg(`<@${OWNER}> 확인 부탁드려요?`), { ...base, ownerRepliedAfter: true }).awaits_owner,
    false,
  );
  assert.equal(classify(msg("영상도 넣을까요?", reply), base).awaits_owner, false);
  assert.equal(classify(msg("영상은 넣기로 했습니다", reply), owner).awaits_owner, false);
  assert.equal(classify(msg("이건 어떨까요?"), owner).awaits_owner, false);
});

test("분류 사유에는 규칙 이름만 들어간다", () => {
  const names = new Set([
    "urgent",
    "decision",
    "change",
    "schedule",
    "risk",
    "awaits_owner",
    "chatter",
    "duplicate",
  ]);
  const c = classify(msg(`<@${OWNER}> 장애 롤백 결정, 배포 일정 변경, 리스크 있음`), {
    ...base,
    duplicate: true,
  });
  assert.ok(c.reasons.length > 0);
  for (const reason of c.reasons) assert.ok(names.has(reason), reason);
});
