import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { forModel, modelAllowed, permalink } from "../src/policy.ts";
import type { Message } from "../src/types.ts";

const config = (env: Record<string, string> = {}) =>
  loadConfig({ DATABASE_URL: "postgres://x", ORBIT_SLACK_BASE_URL: "https://example.slack.com/", ...env });
const real = { id: "CREAL1", name: "secret-room", is_sample: false };
const sample = { id: "CSAMPLE1", name: "sample-product", is_sample: true };
const row: Message = {
  channel_id: "CREAL1",
  ts: "1794787260.000200",
  thread_ts: "1794787200.000100",
  user_id: "U1",
  user_name: "작성자",
  text: "원문입니다",
  posted_at: new Date("2026-11-16T00:01:00Z"),
};

test("샘플 채널은 늘 모델로 보내고 실제 채널은 실데이터 분석을 켜고 명시했을 때만 보낸다", () => {
  assert.equal(modelAllowed(sample, config()), true);
  assert.equal(modelAllowed(real, config()), false);
  assert.equal(modelAllowed(real, config({ ORBIT_ANALYZE_CHANNELS: "CREAL1" })), false);
  assert.equal(modelAllowed(real, config({ ORBIT_ANALYZE_REAL_DATA: "true" })), false);
  const on = config({ ORBIT_ANALYZE_REAL_DATA: "true", ORBIT_ANALYZE_CHANNELS: "COTHER, CREAL1" });
  assert.equal(modelAllowed(real, on), true);
});

test("permalink 는 워크스페이스 주소 아래 메시지 위치를 가리키고 답글이면 스레드를 붙인다", () => {
  assert.equal(
    permalink(config(), "C1", "1794787200.000100"),
    "https://example.slack.com/archives/C1/p1794787200000100",
  );
  assert.equal(
    permalink(config(), "C1", "1794787200.000100", "1794787200.000100"),
    "https://example.slack.com/archives/C1/p1794787200000100",
  );
  assert.equal(
    permalink(config(), "C1", "1794787260.000200", "1794787200.000100"),
    "https://example.slack.com/archives/C1/p1794787260000200?thread_ts=1794787200.000100&cid=C1",
  );
});

test("허용되지 않은 채널 메시지는 위치 네 필드만 모델로 나간다", () => {
  assert.deepEqual(forModel(row, real, config()), {
    channel_id: "CREAL1",
    ts: "1794787260.000200",
    permalink:
      "https://example.slack.com/archives/CREAL1/p1794787260000200?thread_ts=1794787200.000100&cid=CREAL1",
    redacted: true,
  });
});

test("허용된 채널 메시지는 원문을 untrusted_slack_content 로 담는다", () => {
  const on = config({ ORBIT_ANALYZE_REAL_DATA: "true", ORBIT_ANALYZE_CHANNELS: "CREAL1" });
  assert.deepEqual(forModel(row, real, on), {
    channel_id: "CREAL1",
    channel_name: "secret-room",
    ts: "1794787260.000200",
    thread_ts: "1794787200.000100",
    user_name: "작성자",
    posted_at: "2026-11-16T00:01:00.000Z",
    permalink:
      "https://example.slack.com/archives/CREAL1/p1794787260000200?thread_ts=1794787200.000100&cid=CREAL1",
    untrusted_slack_content: "원문입니다",
  });
});
