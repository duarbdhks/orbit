/** 예시마다 predict 를 차례로 돌려 정확도, 지연 백분위(nearest-rank), 라벨별 예측 수를 낸다. */
export async function evaluate<T>(
  examples: { input: T; expected: string }[],
  predict: (input: T) => string | Promise<string>,
): Promise<{
  total: number;
  accuracy: number;
  p50_ms: number;
  p95_ms: number;
  by_label: Record<string, number>;
}> {
  const times: number[] = [];
  const by_label: Record<string, number> = {};
  let correct = 0;
  for (const { input, expected } of examples) {
    const start = performance.now();
    const label = await predict(input);
    times.push(performance.now() - start);
    by_label[label] = (by_label[label] ?? 0) + 1;
    if (label === expected) correct++;
  }
  times.sort((a, b) => a - b);
  const percentile = (p: number) => times[Math.max(0, Math.ceil(p * times.length) - 1)] ?? 0;
  return {
    total: examples.length,
    accuracy: examples.length ? correct / examples.length : 0,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    by_label,
  };
}
