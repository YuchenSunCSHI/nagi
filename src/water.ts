import { createRenderer, loadWaterTextures, type Drop, type TextureGroup, type Wake } from './render/renderer';
import type { WaterPoint } from './scene/camera';
import { createClock } from './scene/clock';
import { createFishSchool } from './scene/fish';
import { createLighting } from './scene/lighting';
import { prefetchSound, soundPointer } from './audio/sound';
import { bindWaterPointer } from './input/pointer';
import { createGestures, type StrokePoint, type TimedPoint } from './input/gestures';

const canvas = document.querySelector<HTMLCanvasElement>('#water')!;
const message = document.querySelector<HTMLElement>('#message')!;
const lightingControls = document.querySelector<HTMLFieldSetElement>('#lighting')!;
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const fish = createFishSchool();
const clock = createClock();
const lighting = createLighting();
const ripples: Wake[] = [];
const drops: Drop[] = [];
let renderer: ReturnType<typeof createRenderer> | undefined;
const images: Partial<Record<TextureGroup, HTMLImageElement[]>> = {};
const textureGroups = ['bed', 'fish'] as const;
let assetsScheduled = false;
let frame = 0;
let contextLost = false;

let lastPointer: StrokePoint | undefined;
let activeStroke: Wake | undefined;
let previousStroke: Wake | undefined;
let strokeAnchor: StrokePoint | undefined;
let strokeDirection: WaterPoint | undefined;
let currentPath: object | undefined;
let lastRippleTime = 0;

function showError(text: string, error?: unknown) {
  if (error) console.error(error);
  if (!canvas.hidden) lightingControls.disabled = true;
  message.textContent = text;
  message.hidden = false;
  cancelAnimationFrame(frame);
  frame = 0;
}

function initialize() {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
  if (!gl) {
    showError('当前浏览器不支持 WebGL 2，无法显示水面。请尝试更新浏览器或启用硬件加速。');
    return false;
  }
  try {
    renderer = createRenderer(gl, fish.seeds);
    for (const group of textureGroups) uploadTextures(group);
    message.hidden = true;
    if (!canvas.hidden) lightingControls.disabled = false;
    resize();
    return true;
  } catch (error) {
    showError('水面渲染初始化失败。请检查浏览器的 WebGL 支持和控制台错误信息。', error);
    return false;
  }
}

function uploadTextures(group: TextureGroup) {
  const loaded = images[group];
  if (!renderer || contextLost || !loaded) return;
  try {
    renderer.setTextures(group, loaded);
  } catch (error) {
    console.warn(`Unable to upload water ${group} textures`, error);
  }
}

async function loadSceneAssets() {
  await Promise.all(textureGroups.map(async group => {
    try {
      images[group] = await loadWaterTextures(group);
      uploadTextures(group);
      if (renderer && !canvas.hidden && !contextLost && motionPreference.matches && !document.hidden) {
        draw(clock.timeAt(performance.now()));
      }
    } catch (error) {
      console.warn(`Unable to load water ${group} textures`, error);
    }
  }));
  prefetchSound();
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
  if (renderer && !assetsScheduled) {
    assetsScheduled = true;
    setTimeout(() => void loadSceneAssets(), 0);
  }
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
  gestures.reset();
  if (!renderer || canvas.hidden || contextLost || !message.hidden || document.hidden) return;
  resize();
  if (motionPreference.matches) {
    draw(clock.timeAt(performance.now()));
  } else {
    frame = requestAnimationFrame(tick);
  }
}

function endStroke() {
  lastPointer = undefined;
  activeStroke = undefined;
  previousStroke = undefined;
  strokeAnchor = undefined;
  strokeDirection = undefined;
  currentPath = undefined;
}

function midpoint(a: TimedPoint, b: TimedPoint) {
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, time: (a.time + b.time) / 2 };
}

function setStrokeEnd(stroke: Wake, point: TimedPoint) {
  stroke.endX = point.x;
  stroke.endZ = point.z;
  stroke.endTime = point.time;
}

function appendStroke(point: StrokePoint) {
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

const gestures = createGestures(clock.timeAt,
  () => !canvas.hidden && !motionPreference.matches && Boolean(renderer) && !contextLost && message.hidden && !document.hidden,
  {
    drop(point) {
      drops.push({ ...point, strength: 0.014 });
      if (drops.length > 10) drops.shift();
      fish.startle(point, point, 0.24, point.time);
    },
    start(point) {
      lastPointer = point;
      currentPath = {};
    },
    extend: appendStroke,
    disturb(from, to, time) {
      fish.startle(from, to, 0.6, time);
    },
    end: endStroke
  });
bindWaterPointer(canvas, gestures.pointer, soundPointer);

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('tuning') === '1') {
  void import('./dev/tuning').then(({ mountTuningPanel }) => mountTuningPanel(() => {
    gestures.reset();
    if (renderer && !canvas.hidden && !contextLost && message.hidden && motionPreference.matches && !document.hidden) {
      draw(clock.timeAt(performance.now()));
    }
  })).catch(error => console.error('Unable to load water tuning controls', error));
}

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  contextLost = true;
  stop();
  gestures.reset();
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
lightingControls.addEventListener('change', (event) => {
  if (canvas.hidden) return;
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.checked) return;
  const mode = lighting.select(input.value, performance.now(), motionPreference.matches);
  canvas.setAttribute('aria-label', mode.canvasLabel);
  updatePlayback();
});

export function setLakeVisible(visible: boolean) {
  canvas.hidden = !visible;
  if (visible) lightingControls.disabled = !renderer || contextLost || !message.hidden;
  updatePlayback();
}

if (initialize()) updatePlayback();
