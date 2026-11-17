import type { DecisionState, Kind } from "./types.ts";

export interface BriefingItem {
  kind: Kind;
  decision_state: DecisionState | null;
  title: string;
  summary: string;
  suggested_reply: string | null;
  awaits_owner: boolean;
  permalinks: string[];
}

export interface BriefingInput {
  kind: "daily" | "weekly";
  status: string;
  items: BriefingItem[];
}

const SECTIONS = {
  결론: "✅",
  "장애와 리스크": "⚠️",
  "일정과 정책 변경": "🗓️",
  진행: "📈",
  "미해결 질문": "❓",
  "내 스레드": "💬",
} as const;
const STATE: Record<DecisionState, string> = {
  discussing: "논의 중",
  confirmed: "확정",
  changed: "변경",
  withdrawn: "철회",
};

function section(item: BriefingItem): keyof typeof SECTIONS {
  if (item.awaits_owner || item.suggested_reply) return "내 스레드";
  if (item.kind === "decision") return item.decision_state === "discussing" ? "미해결 질문" : "결론";
  if (item.kind === "incident" || item.kind === "risk") return "장애와 리스크";
  if (item.kind === "schedule_change" || item.kind === "policy_change") return "일정과 정책 변경";
  if (item.kind === "progress") return "진행";
  return "미해결 질문";
}

export function composeBriefing(input: BriefingInput): string {
  const period = input.kind === "weekly" ? "주간" : "일간";
  if (input.items.length === 0) {
    return `📭 이번 ${period} 브리핑에 담을 항목이 없어요. ${input.status}`;
  }
  const awaiting = input.items.filter((item) => item.awaits_owner).length;
  const lines = [
    awaiting > 0
      ? `📬 이번 ${period} 브리핑에서 답장을 기다리는 항목은 ${awaiting}건이에요.`
      : `📋 이번 ${period} 브리핑에 담을 항목은 ${input.items.length}건이에요.`,
  ];
  for (const [name, emoji] of Object.entries(SECTIONS)) {
    const items = input.items.filter((item) => section(item) === name);
    if (items.length === 0) continue;
    lines.push("", `## ${emoji} ${name}`);
    for (const item of items) {
      const state = item.decision_state ? `[${STATE[item.decision_state]}] ` : "";
      lines.push(`- ${state}${item.title}: ${item.summary} ${item.permalinks.join(" ")}`.trimEnd());
      if (item.suggested_reply) lines.push(`  답장 초안: ${item.suggested_reply}`);
    }
  }
  lines.push("", "## 📡 수집 상태", input.status);
  return lines.join("\n");
}
