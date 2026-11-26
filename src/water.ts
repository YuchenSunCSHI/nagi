import { createRenderer, loadWaterTextures, type Drop, type Wake } from './render/renderer';
import { waterPointAt, type WaterPoint } from './scene/camera';
import { createClock } from './scene/clock';
import { createFishSchool } from './scene/fish';
import { createLighting } from './scene/lighting';

const canvas = document.querySelector<HTMLCanvasElement>('#water')!;
const message = document.querySelector<HTMLElement>('#message')!;
const lightingButton = document.querySelector<HTMLButtonElement>('#lighting')!;
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const fish = createFishSchool();
const clock = createClock();
const lighting = createLighting();
const ripples: Wake[] = [];
const drops: Drop[] = [];
let renderer: ReturnType<typeof createRenderer> | undefined;
let images: HTMLImageElement[] | undefined;
let frame = 0;
let contextLost = false;

type TimedPoint = WaterPoint & { time: number };
type PointerPoint = TimedPoint & { now: number; clientX: number; clientY: number };
let lastPointer: PointerPoint | undefined;
let pointerPoint: PointerPoint | undefined;
let gesture: { distance: number; lastTime: number; isStroke: boolean; points: PointerPoint[] } | undefined;
let gestureTimer: number | undefined;
let activeStroke: Wake | undefined;
let previousStroke: Wake | undefined;
let strokeAnchor: PointerPoint | undefined;
let strokeDirection: WaterPoint | undefined;
let currentPath: object | undefined;
let lastRippleTime = 0;

function showError(text: string, error?: unknown) {
  if (error) console.error(error);
  lightingButton.disabled = true;
  message.textContent = text;
  message.hidden = false;
  cancelAnimationFrame(frame);
  frame = 0;
}

function initialize() {
  if (!images) return false;
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
  if (!gl) {
    showError('当前浏览器不支持 WebGL 2，无法显示水面。请尝试更新浏览器或启用硬件加速。');
    return false;
  }
  try {
    renderer = createRenderer(gl, images, fish.seeds);
    message.hidden = true;
    lightingButton.disabled = false;
    resize();
    return true;
  } catch (error) {
    showError('水面渲染初始化失败。请检查浏览器的 WebGL 支持和控制台错误信息。', error);
    return false;
  }
}

function resize() {
  if (!renderer || contextLost) return;
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  const pixelLimit = Math.sqrt(2500000 / (width * height));
  const scale = Math.min(pixelRatio * clock.quality, pixelLimit);
  const renderWidth = Math.max(1, Math.round(width * scale));
  const renderHeight = Math.max(1, Math.round(height * scale));
  if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
  }
  renderer.resize(canvas.width, canvas.height);
}

function draw(time: number) {
  while (ripples.length && time - ripples[0].endTime >= 1.8) ripples.shift();
  while (drops.length && time - drops[0].time >= 1.8) drops.shift();
  renderer?.draw(time, lighting.weights(performance.now(), motionPreference.matches), ripples, drops, fish.update(time));
}

function tick(now: number) {
  frame = 0;
  draw(clock.tick(now));
  if (clock.sample(now)) resize();
  frame = requestAnimationFrame(tick);
}

function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  clock.stop(performance.now());
}

function updatePlayback() {
  stop();
  resetGesture();
  pointerPoint = undefined;
  if (!renderer || contextLost || !message.hidden || document.hidden) return;
  resize();
  if (motionPreference.matches) {
    draw(clock.timeAt(performance.now()));
  } else {
    frame = requestAnimationFrame(tick);
  }
}

function pointerPosition(event: PointerEvent) {
  const point = waterPointAt(canvas, event.clientX, event.clientY);
  if (!point) return undefined;
  const now = performance.now();
  const time = clock.timeAt(now);
  return { ...point, time, now, clientX: event.clientX, clientY: event.clientY };
}


function resetGesture() {
  clearTimeout(gestureTimer);
  gesture = undefined;
  lastPointer = undefined;
  activeStroke = undefined;
  previousStroke = undefined;
  strokeAnchor = undefined;
  strokeDirection = undefined;
  currentPath = undefined;
}

function finishGesture() {
  if (gesture && pointerPoint && !gesture.isStroke && gesture.distance > 0) {
    const now = performance.now();
    const time = clock.timeAt(now);
    drops.push({ x: pointerPoint.x, z: pointerPoint.z, time, strength: 0.014 });
    if (drops.length > 10) drops.shift();
    fish.startle(pointerPoint, pointerPoint, 0.24, time);
  }
  resetGesture();
}

function midpoint(a: TimedPoint, b: TimedPoint) {
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, time: (a.time + b.time) / 2 };
}

function setStrokeEnd(stroke: Wake, point: TimedPoint) {
  stroke.endX = point.x;
  stroke.endZ = point.z;
  stroke.endTime = point.time;
}

function appendStroke(point: PointerPoint) {
  if (!lastPointer || !currentPath) return;
  const dx = point.x - lastPointer.x;
  const dz = point.z - lastPointer.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.015) return;
  const direction = { x: dx / distance, z: dz / distance };
  const turning = strokeDirection
    && direction.x * strokeDirection.x + direction.z * strokeDirection.z < 0.75;
  if (!activeStroke) {
    const control = midpoint(lastPointer, point);
    activeStroke = {
      x: lastPointer.x, z: lastPointer.z, time: Math.max(lastPointer.time, point.time - 1.8),
      controlX: control.x, controlZ: control.z, endX: point.x, endZ: point.z,
      endTime: point.time, strength: 0.014, path: currentPath
    };
    ripples.push(activeStroke);
    if (ripples.length > 20) ripples.shift();
    lastRippleTime = point.now;
  } else if (point.now - lastRippleTime >= 90 || (turning && point.now - lastRippleTime >= 20)) {
    const join = midpoint(lastPointer, point);
    activeStroke.controlX = lastPointer.x;
    activeStroke.controlZ = lastPointer.z;
    setStrokeEnd(activeStroke, join);
    previousStroke = activeStroke;
    strokeAnchor = lastPointer;
    const control = midpoint(join, point);
    activeStroke = {
      x: join.x, z: join.z, time: join.time, controlX: control.x, controlZ: control.z,
      endX: point.x, endZ: point.z, endTime: point.time, strength: 0.014, path: currentPath
    };
    ripples.push(activeStroke);
    if (ripples.length > 20) ripples.shift();
    lastRippleTime = point.now;
  } else {
    if (previousStroke && strokeAnchor) {
      const join = midpoint(strokeAnchor, point);
      setStrokeEnd(previousStroke, join);
      activeStroke.x = join.x;
      activeStroke.z = join.z;
      activeStroke.time = join.time;
    }
    const control = midpoint(activeStroke, point);
    activeStroke.controlX = control.x;
    activeStroke.controlZ = control.z;
    setStrokeEnd(activeStroke, point);
  }
  strokeDirection = direction;
  lastPointer = point;
}

canvas.addEventListener('pointerenter', (event) => {
  if (event.pointerType === 'mouse') pointerPoint = pointerPosition(event);
});
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse' || motionPreference.matches || !renderer || contextLost
    || !message.hidden || document.hidden) return;
  const point = pointerPosition(event);
  if (!point) {
    finishGesture();
    pointerPoint = undefined;
    return;
  }
  if (!pointerPoint) {
    pointerPoint = point;
    return;
  }
  if (gesture && point.now - gesture.lastTime >= 220) finishGesture();
  const previousPoint = pointerPoint;
  const distance = Math.hypot(point.clientX - pointerPoint.clientX, point.clientY - pointerPoint.clientY);
  if (distance === 0) return;
  if (!gesture) {
    gesture = { distance: 0, lastTime: point.now, isStroke: false, points: [pointerPoint] };
    lastPointer = pointerPoint;
    currentPath = {};
  }
  gesture.distance += distance;
  gesture.lastTime = point.now;
  pointerPoint = point;
  clearTimeout(gestureTimer);
  gestureTimer = setTimeout(finishGesture, 220);
  if (gesture.isStroke) {
    appendStroke(point);
    fish.startle(previousPoint, point, 0.6, point.time);
  } else if (gesture.distance > 15) {
    gesture.isStroke = true;
    for (const previous of gesture.points.slice(1)) appendStroke(previous);
    appendStroke(point);
    const points = [...gesture.points, point];
    for (let i = 1; i < points.length; i++) fish.startle(points[i - 1], points[i], 0.6, point.time);
    gesture.points = [];
  } else {
    const previous = gesture.points[gesture.points.length - 1];
    if (Math.hypot(point.clientX - previous.clientX, point.clientY - previous.clientY) >= 2) {
      gesture.points.push(point);
    }
  }
});
canvas.addEventListener('pointerleave', (event) => {
  if (event.pointerType !== 'mouse') return;
  finishGesture();
  pointerPoint = undefined;
});

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  contextLost = true;
  stop();
  resetGesture();
  pointerPoint = undefined;
  showError('图形渲染暂时中断，正在等待浏览器恢复。');
});
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  if (initialize()) updatePlayback();
});
window.addEventListener('resize', updatePlayback);
document.addEventListener('visibilitychange', updatePlayback);
motionPreference.addEventListener('change', () => {
  if (motionPreference.matches) {
    lighting.snap();
    ripples.length = 0;
    drops.length = 0;
  }
  updatePlayback();
});
lightingButton.addEventListener('click', () => {
  const { mode, next } = lighting.advance(performance.now(), motionPreference.matches);
  lightingButton.textContent = `${mode.label} → ${next.label}`;
  lightingButton.dataset.phase = mode.phase;
  lightingButton.setAttribute('aria-label', `当前${mode.label}，切换到${next.label}`);
  canvas.setAttribute('aria-label', mode.canvasLabel);
  updatePlayback();
});


message.textContent = '正在加载水下素材…';
message.hidden = false;
loadWaterTextures().then(loaded => {
  images = loaded;
  if (initialize()) updatePlayback();
}, error => {
  showError('水下素材加载失败，请检查资源文件和浏览器控制台。', error);
});
