import { waterPointAt, type WaterPoint } from '../scene/camera';

export interface PointerSample {
  now: number;
  clientX: number;
  clientY: number;
  water: WaterPoint | undefined;
}

export interface PointerConsumer {
  enter(sample: PointerSample): void;
  move(sample: PointerSample): void;
  leave(): void;
}

export function bindWaterPointer(canvas: HTMLCanvasElement, ...consumers: PointerConsumer[]) {
  const dispatch = (type: 'enter' | 'move') => (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const { clientX, clientY } = event;
    const sample = { now: performance.now(), clientX, clientY, water: waterPointAt(canvas, clientX, clientY) };
    for (const consumer of consumers) consumer[type](sample);
  };
  canvas.addEventListener('pointerenter', dispatch('enter'));
  canvas.addEventListener('pointermove', dispatch('move'));
  const leave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    for (const consumer of consumers) consumer.leave();
  };
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('pointercancel', leave);
}
