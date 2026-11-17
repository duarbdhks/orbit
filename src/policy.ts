import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.ts";
import type { Message } from "./types.ts";

export type ModelMessage =
  | {
      channel_id: string;
      channel_name: string;
      ts: string;
      thread_ts: string | null;
      user_id: string | null;
      user_name: string | null;
      posted_at: string;
      permalink: string;
      untrusted_slack_content: string;
    }
  | { channel_id: string; ts: string; permalink: string; redacted: true };

export function authorized(authorization: string | undefined, config: Config): boolean {
  if (!config.ORBIT_API_TOKEN) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization ?? ""), digest(`Bearer ${config.ORBIT_API_TOKEN}`));
}

export function ownerCall(actor: unknown, config: Config): boolean {
  return config.ORBIT_OWNER_PRINCIPAL !== "" && actor === config.ORBIT_OWNER_PRINCIPAL;
}

type ModelChannel = { id: string; name: string; is_sample: boolean };
type OwnerDm = {
  id: string;
  name: string;
  kind: "owner_dm";
  owner_user_id: string;
  participant_user_id: string;
  principal: string;
};

/** 샘플 채널은 항상, 실제 채널은 실데이터 분석이 켜져 있고 채널 id 나 `*`(전체)를 명시했을 때만 모델로 보낸다. */
export function modelAllowed(channel: { id: string; is_sample: boolean }, config: Config): boolean {
  const allowed = config.ORBIT_ANALYZE_CHANNELS;
  return (
    channel.is_sample ||
    (config.ORBIT_ANALYZE_REAL_DATA &&
      !channel.id.startsWith("D") &&
      (allowed.includes("*") || allowed.includes(channel.id)))
  );
}

export function permalink(config: Config, channelId: string, ts: string, threadTs?: string | null): string {
  const link = `${config.ORBIT_SLACK_BASE_URL.replace(/\/+$/, "")}/archives/${channelId}/p${ts.replace(".", "")}`;
  return threadTs && threadTs !== ts ? `${link}?thread_ts=${threadTs}&cid=${channelId}` : link;
}

/** 모델로 나가는 메시지는 전부 이 함수를 지난다. 허용되지 않은 채널은 위치만 남긴다. */
export function forModel(row: Message, channel: ModelChannel | OwnerDm, config: Config): ModelMessage {
  const link = permalink(config, row.channel_id, row.ts, row.thread_ts);
  const allowed =
    "kind" in channel
      ? config.ORBIT_ANALYZE_REAL_DATA &&
        channel.id.startsWith("D") &&
        row.channel_id === channel.id &&
        config.ORBIT_OWNER_USER_ID !== "" &&
        channel.owner_user_id === config.ORBIT_OWNER_USER_ID &&
        channel.participant_user_id !== "" &&
        channel.participant_user_id !== channel.owner_user_id &&
        ownerCall(channel.principal, config)
      : modelAllowed(channel, config);
  if (!allowed) return { channel_id: row.channel_id, ts: row.ts, permalink: link, redacted: true };
  return {
    channel_id: row.channel_id,
    channel_name: channel.name,
    ts: row.ts,
    thread_ts: row.thread_ts,
    user_id: row.user_id,
    user_name: row.user_name,
    posted_at: row.posted_at.toISOString(),
    permalink: link,
    untrusted_slack_content: row.text,
  };
}
