const modes = [
  { label: '白天', phase: 'day', canvasLabel: '阳光下缓缓流动的河面', weights: [1, 0, 0] },
  { label: '傍晚', phase: 'sunset', canvasLabel: '夕阳下缓缓流动的河面', weights: [0, 1, 0] },
  { label: '夜晚', phase: 'night', canvasLabel: '月光下缓缓流动的河面', weights: [0, 0, 1] }
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
    advance(now: number, reduced: boolean) {
      from = weights(now, reduced);
      index = (index + 1) % modes.length;
      const mode = modes[index];
      if (reduced) from = mode.weights;
      started = now;
      return { mode, next: modes[(index + 1) % modes.length] };
    }
  };
}
