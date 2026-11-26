const modes = [
  { phase: 'day', canvasLabel: '阳光下缓缓流动的河面', weights: [1, 0, 0] },
  { phase: 'sunset', canvasLabel: '夕阳下缓缓流动的河面', weights: [0, 1, 0] },
  { phase: 'night', canvasLabel: '月光下缓缓流动的河面', weights: [0, 0, 1] }
];

export function createLighting() {
  let index = 0;
  let from = modes[0].weights;
  let started = 0;
  const weights = (now: number, reduced: boolean) => {
    const target = modes[index].weights;
    if (reduced) return target;
    const progress = Math.min(1, Math.max(0, (now - started) / 1800));
    const smooth = progress * progress * (3 - 2 * progress);
    return target.map((value, i) => from[i] + (value - from[i]) * smooth);
  };
  return {
    weights,
    snap() { from = modes[index].weights; },
    select(phase: string, now: number, reduced: boolean) {
      const next = modes.findIndex(mode => mode.phase === phase);
      if (next < 0) throw new RangeError(`Unknown lighting phase: ${phase}`);
      from = weights(now, reduced);
      index = next;
      const mode = modes[index];
      if (reduced) from = mode.weights;
      started = now;
      return mode;
    }
  };
}
