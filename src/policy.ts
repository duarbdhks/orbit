import type { Config } from "./config.ts";
import type { Message } from "./types.ts";

export type ModelMessage =
  | {
      channel_id: string;
      channel_name: string;
      ts: string;
      thread_ts: string | null;
      user_name: string | null;
      posted_at: string;
      permalink: string;
      untrusted_slack_content: string;
    }
  | { channel_id: string; ts: string; permalink: string; redacted: true };

/** 샘플 채널은 항상, 실제 채널은 실데이터 분석이 켜져 있고 채널 id 를 명시했을 때만 모델로 보낸다. */
export function modelAllowed(channel: { id: string; is_sample: boolean }, config: Config): boolean {
  return (
    channel.is_sample ||
    (config.ORBIT_ANALYZE_REAL_DATA && config.ORBIT_ANALYZE_CHANNELS.includes(channel.id))
  );
}

export function permalink(config: Config, channelId: string, ts: string, threadTs?: string | null): string {
  const link = `${config.ORBIT_SLACK_BASE_URL.replace(/\/+$/, "")}/archives/${channelId}/p${ts.replace(".", "")}`;
  return threadTs && threadTs !== ts ? `${link}?thread_ts=${threadTs}&cid=${channelId}` : link;
}

/** 모델로 나가는 메시지는 전부 이 함수를 지난다. 허용되지 않은 채널은 위치만 남긴다. */
export function forModel(
  row: Message,
  channel: { id: string; name: string; is_sample: boolean },
  config: Config,
): ModelMessage {
  const link = permalink(config, row.channel_id, row.ts, row.thread_ts);
  if (!modelAllowed(channel, config))
    return { channel_id: row.channel_id, ts: row.ts, permalink: link, redacted: true };
  return {
    channel_id: row.channel_id,
    channel_name: channel.name,
    ts: row.ts,
    thread_ts: row.thread_ts,
    user_name: row.user_name,
    posted_at: row.posted_at.toISOString(),
    permalink: link,
    untrusted_slack_content: row.text,
  };
}
