export const ROUTES = ["notify_now", "briefing", "hold"] as const;
export type Route = (typeof ROUTES)[number];

export const KINDS = [
  "progress",
  "decision",
  "schedule_change",
  "policy_change",
  "incident",
  "open_question",
  "risk",
] as const;
export type Kind = (typeof KINDS)[number];

export const DECISION_STATES = ["discussing", "confirmed", "changed", "withdrawn"] as const;
export type DecisionState = (typeof DECISION_STATES)[number];

export const ROUTER_MODES = ["off", "shadow", "active"] as const;
export type RouterMode = (typeof ROUTER_MODES)[number];

export interface Message {
  channel_id: string;
  ts: string;
  thread_ts: string | null;
  user_id: string | null;
  user_name: string | null;
  text: string;
  posted_at: Date;
}

export interface Classification {
  work_related: boolean;
  importance: 0 | 1 | 2 | 3;
  urgency: 0 | 1 | 2 | 3;
  is_new: boolean;
  conflicts: boolean;
  needs_research: boolean;
  awaits_owner: boolean;
  route: Route;
  reasons: string[];
}
