import { setLakeAudible } from '../audio/sound';
import { setLakeVisible } from '../water';
import { createLighting } from './lighting';

const picker = document.querySelector<HTMLElement>('.scene-picker')!;
const toggle = document.querySelector<HTMLButtonElement>('#scene-toggle')!;
const options = document.querySelector<HTMLElement>('#scene-options')!;
const status = document.querySelector<HTMLElement>('#scene-status')!;
const canvas = document.querySelector<HTMLCanvasElement>('#mountain')!;
const sound = document.querySelector<HTMLButtonElement>('#sound')!;
const soundError = document.querySelector<HTMLElement>('#sound-error')!;
const lightingControls = document.querySelector<HTMLFieldSetElement>('#lighting')!;
const radios = [...lightingControls.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const light = createLighting();
const labels: Record<string, string> = { day: '金色晨光下的雪山', sunset: '夕阳下的雪山', night: '月光下的雪山' };
let mountain: ReturnType<typeof import('../render/mountain').createMountain> | undefined;
let lakePhase = 'day';
let mountainPhase = 'day';
let animation = 0;
let loading = false;
let requested: 'lake' | 'mountain' = 'lake';

function open(expanded: boolean) {
  options.hidden = !expanded;
  toggle.setAttribute('aria-expanded', String(expanded));
}

function report(text = '') {
  status.textContent = text;
  status.hidden = !text;
}

function selectScene(isMountain: boolean) {
  if (isMountain && canvas.hidden) lakePhase = radios.find(radio => radio.checked)?.value ?? 'day';
  canvas.hidden = !isMountain;
  sound.hidden = isMountain;
  soundError.toggleAttribute('inert', isMountain);
  setLakeAudible(!isMountain);
  setLakeVisible(!isMountain);
  if (isMountain) lightingControls.disabled = false;
  for (const radio of radios) radio.checked = radio.value === (isMountain ? mountainPhase : lakePhase);
  for (const option of options.querySelectorAll<HTMLButtonElement>('[data-scenery]')) {
    option.setAttribute('aria-pressed', String(option.dataset.scenery === (isMountain ? 'mountain' : 'lake')));
  }
  cancelAnimationFrame(animation);
  if (isMountain) mountain?.draw(light.weights(performance.now(), motion.matches));
}

async function chooseMountain() {
  requested = 'mountain';
  if (mountain) {
    selectScene(true);
    report();
    return;
  }
  if (loading) {
    report('正在加载日照金山…');
    return;
  }
  loading = true;
  report('正在加载日照金山…');
  try {
    const { createMountain } = await import('../render/mountain');
    mountain = createMountain(canvas);
    if (requested === 'mountain') {
      selectScene(true);
      report();
    }
  } catch (error) {
    console.error('Unable to load the mountain scene', error);
    if (requested === 'mountain') report('日照金山未能加载，请重新选择以重试。');
  } finally {
    loading = false;
  }
}

toggle.addEventListener('click', () => open(options.hidden));
options.addEventListener('click', event => {
  if (!(event.target instanceof HTMLButtonElement)) return;
  const scene = event.target.dataset.scenery;
  if (scene !== 'lake' && scene !== 'mountain') return;
  open(false);
  toggle.focus();
  if (scene === 'mountain') {
    void chooseMountain();
  } else {
    requested = 'lake';
    if (!canvas.hidden) selectScene(false);
    report();
  }
});
picker.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !options.hidden) {
    open(false);
    toggle.focus();
  }
});
document.addEventListener('pointerdown', event => {
  if (event.target instanceof Node && !picker.contains(event.target)) open(false);
});

lightingControls.addEventListener('change', event => {
  const radio = event.target;
  if (canvas.hidden || !(radio instanceof HTMLInputElement) || !radio.checked) return;
  mountainPhase = radio.value;
  canvas.setAttribute('aria-label', labels[mountainPhase]);
  const start = performance.now();
  light.select(mountainPhase, start, motion.matches);
  cancelAnimationFrame(animation);
  const draw = (now: number) => {
    mountain?.draw(light.weights(now, motion.matches));
    if (!motion.matches && now - start < 1800) animation = requestAnimationFrame(draw);
  };
  draw(start);
});
window.addEventListener('resize', () => {
  if (!canvas.hidden) mountain?.draw(light.weights(performance.now(), motion.matches));
});
motion.addEventListener('change', () => {
  if (motion.matches) light.snap();
  if (!canvas.hidden) mountain?.draw(light.weights(performance.now(), motion.matches));
});
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  mountain = undefined;
  requested = 'lake';
  if (!canvas.hidden) selectScene(false);
  report('雪山渲染中断，请重新选择日照金山。');
});
