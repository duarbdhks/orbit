import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { SQL } from "../src/db/research.ts";
import type { Db } from "../src/db.ts";
import { selfcheck } from "../src/db.ts";
import { classifyPass } from "../src/research.ts";
import { loadSample } from "../src/sample.ts";
import { testDb } from "./helpers.ts";

const config = (env: Record<string, string> = {}) =>
  loadConfig({
    DATABASE_URL: "postgres://unused",
    ORBIT_OWNER_USER_ID: "USAMPLE0",
    ORBIT_SLACK_BASE_URL: "https://example.slack.com",
    ...env,
  });
const WEBHOOK = {
  ORBIT_QM_WEBHOOK_URL: "http://qm.test/hooks/orbit",
  ORBIT_QM_WEBHOOK_SECRET: "webhook-secret",
};

async function seed(
  db: Db,
  channel: { id: string; sample: boolean },
  messages: [string, string][],
  postedAt = new Date(),
) {
  await db.query(
    "INSERT INTO channels (id, name, kind, is_member, is_sample) VALUES ($1, $1, 'public', true, $2)",
    [channel.id, channel.sample],
  );
  for (const [ts, text] of messages) {
    await db.query(
      "INSERT INTO messages (channel_id, ts, user_id, text, posted_at, source) VALUES ($1, $2, 'U1', $3, $4, 'incremental')",
      [channel.id, ts, text, postedAt],
    );
  }
}

function recorder(statuses: number[]) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: String(init?.body),
    });
    return new Response(null, { status: statuses.shift() ?? 200 });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

test("research SQL 은 모두 지금 스키마에서 준비된다", async () => {
  const { db } = await testDb();
  await selfcheck(db, SQL);
  await db.end();
});

test("분류되지 않은 메시지만 분류하고 긴급 메시지마다 알림을 하나 만든다", async () => {
  const { db } = await testDb();
  await seed(db, { id: "C1", sample: false }, [
    ["1794787200.000100", "결제 서버 장애로 주문이 실패합니다"],
    ["1794787260.000100", "배포 일정은 금요일 오후입니다"],
    ["1794787320.000100", "ㅋㅋㅋ"],
  ]);
  await classifyPass(db, config());
  await classifyPass(db, config());
  const rows = await db.query("SELECT ts, route, source FROM classifications ORDER BY ts");
  assert.deepEqual(
    rows.rows.map((r) => [r.route, r.source]),
    [
      ["notify_now", "rules"],
      ["briefing", "rules"],
      ["hold", "rules"],
    ],
  );
  const alerts = await db.query("SELECT ts FROM alerts");
  assert.deepEqual(alerts.rows, [{ ts: "1794787200.000100" }]);

  // 과거 수집으로 들어온 오래된 긴급 메시지는 분류만 하고 알리지 않는다.
  await seed(
    db,
    { id: "C2", sample: false },
    [["1794700000.000100", "어제 결제 서버 장애가 있었습니다"]],
    new Date(Date.now() - 2 * 3_600_000),
  );
  await classifyPass(db, config());
  const old = await db.query("SELECT route FROM classifications WHERE channel_id = 'C2'");
  assert.deepEqual(old.rows, [{ route: "notify_now" }]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM alerts")).rows[0].n, 1);
  await db.end();
});

test("advise 는 모델 전송이 허용된 채널에만 쓰고 바꾼 결과는 jev 출처로 저장한다", async () => {
  const { db } = await testDb();
  await seed(db, { id: "CSAMPLE9", sample: true }, [["1794787200.000100", "배포 일정은 금요일 오후입니다"]]);
  await seed(db, { id: "CREAL1", sample: false }, [["1794787200.000200", "배포 일정은 금요일 오후입니다"]]);
  const advised: string[] = [];
  await classifyPass(db, config(), {
    advise: async (message, rules) => {
      advised.push(message.channel_id);
      return { ...rules, importance: 0, route: "hold" };
    },
  });
  assert.deepEqual(advised, ["CSAMPLE9"]);
  const rows = await db.query("SELECT channel_id, route, source FROM classifications ORDER BY channel_id");
  assert.deepEqual(rows.rows, [
    { channel_id: "CREAL1", route: "briefing", source: "rules" },
    { channel_id: "CSAMPLE9", route: "hold", source: "jev" },
  ]);
  await db.end();
});

test("분류하는 사이 지워진 메시지는 건너뛰고 나머지를 계속 분류한다", async () => {
  const { db } = await testDb();
  await seed(db, { id: "CSAMPLE9", sample: true }, [
    ["1794787200.000100", "배포 일정은 금요일 오후입니다"],
    ["1794787260.000100", "회의는 3시입니다"],
  ]);
  await classifyPass(db, config(), {
    advise: async (_message, rules) => {
      await db.query("DELETE FROM messages WHERE ts = '1794787200.000100'");
      return rules;
    },
  });
  const rows = await db.query("SELECT ts FROM classifications");
  assert.deepEqual(rows.rows, [{ ts: "1794787260.000100" }]);
  await db.end();
});

test("webhook 은 본문 HMAC 서명을 붙이고 실패한 알림은 다음 pass 가 다시 보낸다", async () => {
  const { db } = await testDb();
  await seed(db, { id: "C1", sample: false }, [["1794787200.000100", "결제 서버 장애로 주문이 실패합니다"]]);
  const { calls, fetch } = recorder([500, 200]);
  await classifyPass(db, config(WEBHOOK), { fetch });
  assert.equal(calls.length, 1);
  assert.equal((await db.query("SELECT webhook_sent_at FROM alerts")).rows[0].webhook_sent_at, null);

  await classifyPass(db, config(WEBHOOK), { fetch });
  await classifyPass(db, config(WEBHOOK), { fetch });
  assert.equal(calls.length, 2);
  const alert = (await db.query("SELECT id, webhook_sent_at FROM alerts")).rows[0];
  assert.ok(alert.webhook_sent_at instanceof Date);
  for (const call of calls) {
    assert.equal(call.url, WEBHOOK.ORBIT_QM_WEBHOOK_URL);
    assert.deepEqual(JSON.parse(call.body), {
      alert_id: alert.id,
      permalink: "https://example.slack.com/archives/C1/p1794787200000100",
    });
    assert.equal(call.headers["content-type"], "application/json");
    const hmac = createHmac("sha256", WEBHOOK.ORBIT_QM_WEBHOOK_SECRET).update(call.body).digest("hex");
    assert.equal(call.headers["x-signature"], `sha256=${hmac}`);
  }
  await db.end();
});

test("webhook URL 이 비어 있으면 알림을 만들기만 하고 보내지 않는다", async () => {
  const { db } = await testDb();
  await seed(db, { id: "C1", sample: false }, [["1794787200.000100", "결제 서버 장애로 주문이 실패합니다"]]);
  const { calls, fetch } = recorder([]);
  await classifyPass(db, config(), { fetch });
  assert.equal(calls.length, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM alerts")).rows[0].n, 1);
  await db.end();
});

test("샘플은 세 샘플 채널에 들어가고 여러 번 불러도 결과가 같다", async () => {
  const { db } = await testDb();
  await loadSample(db);
  const snapshot = () =>
    db.query(
      "SELECT ch.id, ch.is_sample, count(m.ts)::int AS n FROM channels ch LEFT JOIN messages m ON m.channel_id = ch.id GROUP BY ch.id ORDER BY ch.id",
    );
  const first = (await snapshot()).rows;
  await loadSample(db);
  assert.deepEqual((await snapshot()).rows, first);
  assert.deepEqual(
    first.map((r) => [r.id, r.is_sample]),
    [
      ["CSAMPLE1", true],
      ["CSAMPLE2", true],
      ["CSAMPLE3", true],
    ],
  );
  assert.equal(
    first.reduce((sum, r) => sum + r.n, 0),
    30,
  );
  await db.end();
});
