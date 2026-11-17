import { readFile } from "node:fs/promises";
import { SQL } from "./db/research.ts";
import type { Db } from "./db.ts";

interface Sample {
  channels: { id: string; name: string }[];
  messages: {
    channel_id: string;
    ts: string;
    thread_ts?: string;
    user_id: string;
    user_name: string;
    text: string;
  }[];
}

/** 지어낸 샘플 대화를 is_sample 채널로 넣는다. 이미 있는 행은 건드리지 않아 여러 번 불러도 결과가 같다. */
export async function loadSample(db: Db): Promise<void> {
  const file = new URL("../fixtures/sample-slack.json", import.meta.url);
  const sample = JSON.parse(await readFile(file, "utf8")) as Sample;
  for (const ch of sample.channels) await db.query(SQL.insertSampleChannel, [ch.id, ch.name]);
  for (const m of sample.messages) {
    await db.query(SQL.insertSampleMessage, [
      m.channel_id,
      m.ts,
      m.thread_ts ?? null,
      m.user_id,
      m.user_name,
      m.text,
      new Date(Number(m.ts) * 1000),
    ]);
  }
}
