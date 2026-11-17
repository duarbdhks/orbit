// 규칙 라우터의 정확도, 지연, AI 호출을 줄이는 비율을 라벨 붙은 예시로 잰다.
// 사용법: npm run eval:router   (네트워크와 DB 를 쓰지 않는다. Jev 는 shadow 기록으로 따로 비교한다.)
import { readFile } from "node:fs/promises";
import { classify } from "../src/classify.ts";
import { evaluate } from "../src/eval.ts";
import { tierOf } from "../src/router.ts";

type Examples = { input: string; expected: string }[];
const load = async (name: string) =>
  JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

export async function evalRouter() {
  const examples = await load("router-eval.json");
  const runtime = await evaluate(examples.runtime as Examples, (input) => tierOf(input).tier);
  const runtime_choices = await evaluate(examples.runtime_choices as Examples, (input) => tierOf(input).runtime);
  const routes = await evaluate((await load("classify-eval.json")) as Examples, (text) => {
    const message = { channel_id: "C", ts: "1.0", thread_ts: null, user_id: "U", user_name: null, text, posted_at: new Date() };
    const context = { ownerUserId: "UOWNER", duplicate: false, threadStartedByOwner: false, ownerRepliedAfter: false };
    return classify(message, context).route;
  });
  return {
    runtime,
    runtime_choices,
    classify: routes,
    // hold 로 분류된 메시지는 AI 분석으로 넘어가지 않는다. simple 로 분류된 요청은 낮은 effort 로 간다.
    analysis_skipped: (routes.by_label.hold ?? 0) / routes.total,
    low_effort_turns: (runtime.by_label.simple ?? 0) / runtime.total,
  };
}

if (import.meta.main) console.log(JSON.stringify(await evalRouter(), null, 2));
