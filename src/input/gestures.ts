import type { WaterPoint } from '../scene/camera';
import type { PointerConsumer, PointerSample } from './pointer';

export type TimedPoint = WaterPoint & { time: number };
export type StrokePoint = TimedPoint & { now: number; clientX: number; clientY: number };

interface GestureEffects {
  drop(point: TimedPoint): void;
  start(point: StrokePoint): void;
  extend(point: StrokePoint): void;
  disturb(from: StrokePoint, to: StrokePoint, time: number): void;
  end(): void;
}

export function createGestures(timeAt: (now: number) => number, enabled: () => boolean, effects: GestureEffects) {
  let point: StrokePoint | undefined;
  let gesture: { distance: number; lastTime: number; stroke: boolean; points: StrokePoint[] } | undefined;
  let timer: number | undefined;
  const project = ({ water, now, clientX, clientY }: PointerSample) =>
    water ? { ...water, now, clientX, clientY, time: timeAt(now) } : undefined;
  const reset = () => {
    clearTimeout(timer);
    gesture = undefined;
    effects.end();
  };
  const finish = () => {
    if (gesture && point && !gesture.stroke && gesture.distance > 0) {
      effects.drop({ x: point.x, z: point.z, time: timeAt(performance.now()) });
    }
    reset();
  };
  const pointer: PointerConsumer = {
    enter(sample) { point = project(sample); },
    move(sample) {
      if (!enabled()) return;
      const next = project(sample);
      if (!next) {
        finish();
        point = undefined;
        return;
      }
      if (!point) {
        point = next;
        return;
      }
      if (gesture && next.now - gesture.lastTime >= 220) finish();
      const previous = point;
      const distance = Math.hypot(next.clientX - previous.clientX, next.clientY - previous.clientY);
      if (!distance) return;
      gesture ??= { distance: 0, lastTime: next.now, stroke: false, points: [previous] };
      gesture.distance += distance;
      gesture.lastTime = next.now;
      point = next;
      clearTimeout(timer);
      timer = window.setTimeout(finish, 220);
      if (gesture.stroke) {
        effects.extend(next);
        effects.disturb(previous, next, next.time);
      } else if (gesture.distance > 15) {
        gesture.stroke = true;
        const points = [...gesture.points, next];
        effects.start(points[0]);
        for (const current of points.slice(1)) effects.extend(current);
        for (let i = 1; i < points.length; i++) effects.disturb(points[i - 1], points[i], next.time);
        gesture.points = [];
      } else {
        const buffered = gesture.points[gesture.points.length - 1];
        if (Math.hypot(next.clientX - buffered.clientX, next.clientY - buffered.clientY) >= 2) {
          gesture.points.push(next);
        }
      }
    },
    leave() {
      finish();
      point = undefined;
    }
  };
  return {
    pointer,
    reset() {
      reset();
      point = undefined;
    }
  };
}
