export function nextPollDelay(input: {
  claimed: number;
  idleBatches: number;
  baseDelayMs: number;
}) {
  if (input.claimed > 0) return { delayMs: 250, idleBatches: 0 };
  const base = Math.max(50, Math.floor(input.baseDelayMs));
  const idle = Math.max(0, Math.floor(input.idleBatches));
  return {
    delayMs: Math.min(10_000, base * 2 ** Math.min(idle, 10)),
    idleBatches: idle + 1,
  };
}
