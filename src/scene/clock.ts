export function createClock() {
  let elapsed = 0;
  let started = 0;
  let sampleStart = 0;
  let sampleFrames = 0;
  let quality = 1;
  const timeAt = (now: number) => elapsed + (started ? (now - started) / 1000 : 0);

  return {
    timeAt,
    get quality() { return quality; },
    tick(now: number) {
      if (!started) started = now;
      if (!sampleStart) sampleStart = now;
      return timeAt(now);
    },
    sample(now: number) {
      sampleFrames++;
      const duration = now - sampleStart;
      if (duration < 4000) return false;
      const fps = sampleFrames * 1000 / duration;
      sampleStart = now;
      sampleFrames = 0;
      if (fps >= 48 || quality <= 0.5) return false;
      quality = Math.max(0.5, quality - 0.15);
      return true;
    },
    stop(now: number) {
      elapsed = timeAt(now);
      started = 0;
      sampleStart = 0;
      sampleFrames = 0;
    }
  };
}
