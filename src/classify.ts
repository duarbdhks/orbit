import type { Classification, Message } from "./types.ts";

export interface ClassifyContext {
  ownerUserId: string;
  duplicate: boolean;
  threadStartedByOwner: boolean;
  ownerRepliedAfter: boolean;
}

const KEYWORDS = {
  urgent: /장애|긴급|다운(?!로드|그레이드)|롤백|핫픽스|\b(?:incident|outage|sev1|p0)\b/i,
  decision: /결정|확정|합의|승인/,
  change: /변경|연기|취소|철회|번복/,
  schedule: /일정|마감|배포|릴리스/,
  risk: /리스크|위험|차단|\bblocker\b/i,
};
const RULES = Object.keys(KEYWORDS) as (keyof typeof KEYWORDS)[];
// 멘션, 이모지 코드, 이모지, 기호, 공백을 빼고 남은 글자로 길이와 인사를 판단한다.
const NOISE = /<[@#!][^>]*>|:[a-z0-9_+'-]+:|[\p{P}\p{S}\p{Extended_Pictographic}\p{Cf}\p{M}\s]/giu;
const GREETING =
  /^(?:안녕하세요|안녕|여러분|좋은아침입니다|좋은아침|감사합니다|고맙습니다|고마워요|수고하셨습니다|수고하세요|hi|hello|thanks|thankyou|goodmorning)+$/i;
const CHATTER_MAX = 6;
const SHORT_EVIDENCE = 40;

export function classify(message: Message, context: ClassifyContext): Classification {
  const body = message.text.replace(NOISE, "");
  const hits = RULES.filter((rule) => KEYWORDS[rule].test(message.text));
  const has = (rule: keyof typeof KEYWORDS) => hits.includes(rule);
  const owner = context.ownerUserId;
  const byOwner = owner !== "" && message.user_id === owner;
  const mentioned =
    owner !== "" && (message.text.includes(`<@${owner}>`) || message.text.includes(`<@${owner}|`));
  const threadQuestion =
    context.threadStartedByOwner &&
    message.thread_ts !== null &&
    message.thread_ts !== message.ts &&
    /[?？]\s*$/.test(message.text);
  const awaits = !byOwner && !context.ownerRepliedAfter && (mentioned || threadQuestion);
  const chatter = hits.length === 0 && !awaits && (body.length <= CHATTER_MAX || GREETING.test(body));

  const urgency = has("urgent") ? 3 : has("risk") ? 2 : awaits ? 1 : 0;
  const importance = has("urgent")
    ? 3
    : has("decision") || has("change") || has("risk")
      ? 2
      : has("schedule") || awaits
        ? 1
        : 0;
  const reasons: string[] = [...hits];
  if (awaits) reasons.push("awaits_owner");
  if (chatter) reasons.push("chatter");
  if (context.duplicate) reasons.push("duplicate");

  return {
    work_related: !chatter,
    importance,
    urgency,
    is_new: !context.duplicate,
    conflicts: has("change"),
    needs_research: (has("decision") || has("change")) && body.length < SHORT_EVIDENCE,
    awaits_owner: awaits,
    route: urgency === 3 ? "notify_now" : importance >= 1 ? "briefing" : "hold",
    reasons,
  };
}
